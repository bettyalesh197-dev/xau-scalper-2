// netlify/functions/signal.js
//
// Serveur intermédiaire entre le front et l'API OANDA v20.
// Garde le token OANDA côté serveur (jamais exposé au navigateur),
// calcule les indicateurs (RSI, ATR, EMA, zones S/R) et renvoie soit un
// signal d'entrée avec SL + 2 TP, soit `null` si aucune configuration
// valide n'est présente sur la dernière bougie.
//
// Variables d'environnement à définir sur Netlify :
//   OANDA_API_KEY   -> ton token d'accès (compte practice/démo)
//   OANDA_ENV       -> "practice" (défaut) ou "live"
//   INSTRUMENT      -> "XAU_USD" (défaut)
//
// Dépendance recommandée (facultative grâce au chargement dynamique ci-dessous) :
//   npm install @netlify/blobs

const INSTRUMENT = process.env.INSTRUMENT || "XAU_USD";
const GRANULARITY = "M1"; // bougies 1 minute, adapté au scalping
const CANDLE_COUNT = 300;
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const EMA_FAST_PERIOD = 50;
const EMA_SLOW_PERIOD = 200;
const PIVOT_LOOKBACK = 3; // bougies de chaque côté pour valider un pivot
const SR_TOLERANCE_ATR = 0.25; // distance max (en multiples d'ATR) au niveau S/R
const RSI_OVERSOLD = 35;
const RSI_OVERBOUGHT = 65;

// --- Anti-rafale / anti-répétition ---
const COOLDOWN_MS = 10 * 60 * 1000; // 10 min entre deux signaux, toutes directions confondues
const SAME_DIRECTION_BLOCK_MS = 20 * 60 * 1000; // 20 min avant de réémettre le même sens

// --- Filtre de tendance ---
const TREND_ATR_THRESHOLD = 1.5;

function oandaBaseUrl() {
  return process.env.OANDA_ENV === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
}

async function fetchCandles() {
  const url = `${oandaBaseUrl()}/v3/instruments/${INSTRUMENT}/candles?granularity=${GRANULARITY}&count=${CANDLE_COUNT}&price=M`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.OANDA_API_KEY}` }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OANDA ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.candles
    .filter((c) => c.complete)
    .map((c) => ({
      time: c.time,
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c)
    }));
}

function computeRSI(candles, period) {
  const closes = candles.map((c) => c.close);
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeATR(candles, period) {
  const trueRanges = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trueRanges.push(tr);
  }
  return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}

// EMA classique calculée sur toute la série disponible pour être stable,
// on ne retourne que la dernière valeur.
function computeEMA(candles, period) {
  const closes = candles.map((c) => c.close);
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// Détecte les pivots (swing highs / swing lows) pour construire des
// zones de support/résistance simples à partir de l'historique récent.
function findSRLevels(candles) {
  const highs = [];
  const lows = [];
  for (let i = PIVOT_LOOKBACK; i < candles.length - PIVOT_LOOKBACK; i++) {
    const window = candles.slice(i - PIVOT_LOOKBACK, i + PIVOT_LOOKBACK + 1);
    const cur = candles[i];
    if (cur.high === Math.max(...window.map((c) => c.high))) highs.push(cur.high);
    if (cur.low === Math.min(...window.map((c) => c.low))) lows.push(cur.low);
  }
  return { resistances: highs, supports: lows };
}

function nearestLevel(levels, price) {
  if (!levels.length) return null;
  return levels.reduce((best, lvl) =>
    Math.abs(lvl - price) < Math.abs(best - price) ? lvl : best
  );
}

// --- Gestion de l'état persistant (cooldown / anti-répétition) ---

// Chargement dynamique : si @netlify/blobs n'est pas installé (package
// manquant dans package.json / node_modules), on ne fait pas planter toute
// la fonction. On dégrade juste en mode "sans cooldown persistant".
async function loadBlobStore() {
  try {
    const mod = await import("@netlify/blobs");
    return mod.getStore("scalping-state");
  } catch (err) {
    console.warn("Netlify Blobs indisponible (package manquant ou non configuré) :", err.message);
    return null;
  }
}

async function getState() {
  try {
    const store = await loadBlobStore();
    if (!store) return null;
    const raw = await store.get(INSTRUMENT, { type: "json" });
    return raw || null;
  } catch (err) {
    console.warn("Lecture de l'état impossible :", err.message);
    return null;
  }
}

async function saveState(state) {
  try {
    const store = await loadBlobStore();
    if (!store) return;
    await store.set(INSTRUMENT, JSON.stringify(state));
  } catch (err) {
    console.warn("Impossible d'écrire l'état dans Netlify Blobs :", err.message);
  }
}

function isBlockedByCooldown(state, now) {
  if (!state || !state.lastSignalTime) return { blocked: false };
  const elapsed = now - state.lastSignalTime;
  if (elapsed < COOLDOWN_MS) {
    return {
      blocked: true,
      reason: `Cooldown actif (${Math.round((COOLDOWN_MS - elapsed) / 1000)}s restantes)`
    };
  }
  return { blocked: false };
}

function isBlockedBySameDirection(state, side, now) {
  if (!state || !state.lastSignalTime || state.lastSignalSide !== side) {
    return { blocked: false };
  }
  const elapsed = now - state.lastSignalTime;
  if (elapsed < SAME_DIRECTION_BLOCK_MS) {
    return {
      blocked: true,
      reason: `Même direction (${side}) émise il y a moins de ${Math.round(
        SAME_DIRECTION_BLOCK_MS / 60000
      )} min`
    };
  }
  return { blocked: false };
}

function buildSignal(candles, state, now) {
  const last = candles[candles.length - 1];
  const price = last.close;
  const rsi = computeRSI(candles, RSI_PERIOD);
  const atr = computeATR(candles, ATR_PERIOD);
  const emaFast = computeEMA(candles, EMA_FAST_PERIOD);
  const emaSlow = computeEMA(candles, EMA_SLOW_PERIOD);
  const { resistances, supports } = findSRLevels(candles.slice(0, -1));

  const support = nearestLevel(supports, price);
  const resistance = nearestLevel(resistances, price);

  let trending = false;
  let emaSpreadInAtr = null;
  if (emaFast !== null && emaSlow !== null && atr > 0) {
    emaSpreadInAtr = Math.abs(emaFast - emaSlow) / atr;
    trending = emaSpreadInAtr >= TREND_ATR_THRESHOLD;
  }

  let side = null;
  let candidateReason = null;

  if (
    support !== null &&
    Math.abs(price - support) <= atr * SR_TOLERANCE_ATR &&
    rsi <= RSI_OVERSOLD
  ) {
    side = "BUY";
    candidateReason = "Rebond sur support + RSI survendu";
  }

  if (
    resistance !== null &&
    Math.abs(price - resistance) <= atr * SR_TOLERANCE_ATR &&
    rsi >= RSI_OVERBOUGHT
  ) {
    side = "SELL";
    candidateReason = "Rejet sur résistance + RSI suracheté";
  }

  const indicators = {
    price,
    rsi: Number(rsi.toFixed(2)),
    atr: Number(atr.toFixed(3)),
    emaFast: emaFast !== null ? Number(emaFast.toFixed(2)) : null,
    emaSlow: emaSlow !== null ? Number(emaSlow.toFixed(2)) : null,
    emaSpreadInAtr: emaSpreadInAtr !== null ? Number(emaSpreadInAtr.toFixed(2)) : null,
    trending,
    nearestSupport: support,
    nearestResistance: resistance,
    time: last.time
  };

  if (!side) {
    return { signal: null, indicators, filtered: null };
  }

  if (trending) {
    return {
      signal: null,
      indicators,
      filtered: {
        side,
        reason: `Signal ignoré : marché en tendance forte (écart EMA = ${emaSpreadInAtr.toFixed(
          2
        )}x ATR)`
      }
    };
  }

  const cooldownCheck = isBlockedByCooldown(state, now);
  if (cooldownCheck.blocked) {
    return { signal: null, indicators, filtered: { side, reason: cooldownCheck.reason } };
  }

  const sameDirCheck = isBlockedBySameDirection(state, side, now);
  if (sameDirCheck.blocked) {
    return { signal: null, indicators, filtered: { side, reason: sameDirCheck.reason } };
  }

  const direction = side === "BUY" ? 1 : -1;
  const entry = price;
  const sl = entry - direction * atr;
  const tp1 = entry + direction * atr;
  const tp2 = entry + direction * atr * 2;

  return {
    signal: {
      side,
      entry: Number(entry.toFixed(2)),
      sl: Number(sl.toFixed(2)),
      tp1: Number(tp1.toFixed(2)),
      tp2: Number(tp2.toFixed(2)),
      reason: candidateReason,
      time: last.time
    },
    indicators,
    filtered: null
  };
}

export default async function handler() {
  try {
    if (!process.env.OANDA_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OANDA_API_KEY manquant côté serveur." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const candles = await fetchCandles();
    const MIN_CORE_CANDLES = Math.max(RSI_PERIOD, ATR_PERIOD) + PIVOT_LOOKBACK + 1;
    if (candles.length < MIN_CORE_CANDLES) {
      return new Response(
        JSON.stringify({ error: "Pas assez de bougies reçues d'OANDA." }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    // L'EMA200 (filtre de tendance) est un bonus : si OANDA renvoie
    // momentanément un peu moins de bougies que nécessaire pour elle,
    // on continue sans bloquer toute la fonction — computeEMA renverra
    // simplement null et le filtre de tendance sera ignoré pour ce cycle.

    const now = Date.now();
    const state = await getState();
    const result = buildSignal(candles, state, now);

    if (result.signal) {
      await saveState({
        lastSignalTime: now,
        lastSignalSide: result.signal.side
      });
    }

    return new Response(
      JSON.stringify({
        instrument: INSTRUMENT,
        granularity: GRANULARITY,
        candles: candles.slice(-60),
        ...result
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export const config = { path: "/.netlify/functions/signal" };
