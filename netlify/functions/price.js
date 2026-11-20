// netlify/functions/price.js
//
// Petite fonction légère : renvoie le prix live bid/ask d'OANDA.
// Utilise les bougies S5 (5 secondes), donc pas besoin d'OANDA_ACCOUNT_ID.
// Mêmes variables d'environnement que signal.js.

const INSTRUMENT = process.env.INSTRUMENT || "XAU_USD";

function oandaBaseUrl() {
  return process.env.OANDA_ENV === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
}

export default async function handler() {
  try {
    if (!process.env.OANDA_API_KEY) {
      return new Response(JSON.stringify({ error: "OANDA_API_KEY manquant." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    const url = `${oandaBaseUrl()}/v3/instruments/${INSTRUMENT}/candles?granularity=S5&count=2&price=BA`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.OANDA_API_KEY}` }
    });
    if (!res.ok) {
      throw new Error(`OANDA ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const c = data.candles[data.candles.length - 1];
    if (!c || !c.bid || !c.ask) throw new Error("Prix indisponible.");

    const bid = parseFloat(c.bid.c);
    const ask = parseFloat(c.ask.c);
    return new Response(
      JSON.stringify({
        bid,
        ask,
        spread: Number((ask - bid).toFixed(2)),
        time: c.time
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export const config = { path: "/.netlify/functions/price" };
