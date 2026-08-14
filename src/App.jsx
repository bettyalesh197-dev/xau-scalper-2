import React, { useEffect, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
  ReferenceLine
} from "recharts";
import SignalCard from "./components/SignalCard.jsx";
import StatBadge from "./components/StatBadge.jsx";

const POLL_MS = 10000;
const ENDPOINT = "/.netlify/functions/signal";
const MAX_FILTERED_HISTORY = 20;

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastPrice, setLastPrice] = useState(null);
  const [tick, setTick] = useState(null); // "up" | "down" | null
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [showFiltered, setShowFiltered] = useState(false);
  const [counts, setCounts] = useState({ emitted: 0, filtered: 0 });
  const prevPriceRef = useRef(null);
  const lastFilteredKeyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(ENDPOINT);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "Erreur inconnue");
          return;
        }
        setError(null);
        setData(json);

        const price = json.indicators?.price;
        if (price != null) {
          if (prevPriceRef.current != null) {
            setTick(price > prevPriceRef.current ? "up" : price < prevPriceRef.current ? "down" : null);
          }
          prevPriceRef.current = price;
          setLastPrice(price);
        }

        if (json.signal) {
          setCounts((c) => ({ ...c, emitted: c.emitted + 1 }));
        }

        if (json.filtered) {
          // Évite de compter/afficher plusieurs fois le même signal filtré
          // s'il reste actif sur plusieurs cycles de poll consécutifs.
          const key = `${json.indicators?.time}-${json.filtered.side}-${json.filtered.reason}`;
          if (lastFilteredKeyRef.current !== key) {
            lastFilteredKeyRef.current = key;
            setCounts((c) => ({ ...c, filtered: c.filtered + 1 }));
            setFilteredHistory((h) =>
              [
                {
                  time: json.indicators?.time,
                  side: json.filtered.side,
                  reason: json.filtered.reason
                },
                ...h
              ].slice(0, MAX_FILTERED_HISTORY)
            );
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const trending = data?.indicators?.trending;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Scalping · Signaux temps réel</div>
          <h1 style={styles.title}>XAU/USD</h1>
        </div>
        <div style={styles.priceBlock}>
          <span
            style={{
              ...styles.price,
              color: tick === "up" ? "var(--buy)" : tick === "down" ? "var(--sell)" : "var(--text)"
            }}
          >
            {lastPrice != null ? lastPrice.toFixed(2) : "—"}
          </span>
          <span style={styles.priceUnit}>USD</span>
        </div>
      </header>

      {error && <div style={styles.error}>⚠ {error}</div>}

      {trending && (
        <div style={styles.trendBanner}>
          ⏸ Marché en tendance forte — signaux de retournement suspendus
          {data.indicators?.emaSpreadInAtr != null && (
            <span style={styles.trendDetail}> (écart EMA : {data.indicators.emaSpreadInAtr}x ATR)</span>
          )}
        </div>
      )}

      {data && (
        <>
          <div style={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={data.candles}>
                <defs>
                  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={["dataMin", "dataMax"]} hide />
                {data.indicators?.nearestSupport && (
                  <ReferenceLine y={data.indicators.nearestSupport} stroke="var(--buy)" strokeDasharray="3 3" />
                )}
                {data.indicators?.nearestResistance && (
                  <ReferenceLine y={data.indicators.nearestResistance} stroke="var(--sell)" strokeDasharray="3 3" />
                )}
                <Area type="monotone" dataKey="close" stroke="var(--gold)" strokeWidth={1.5} fill="url(#fill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={styles.statsRow}>
            <StatBadge label="RSI (14)" value={data.indicators?.rsi} />
            <StatBadge label="ATR (14)" value={data.indicators?.atr} />
            <StatBadge label="Support" value={data.indicators?.nearestSupport?.toFixed(2)} tone="buy" />
            <StatBadge label="Résistance" value={data.indicators?.nearestResistance?.toFixed(2)} tone="sell" />
          </div>

          <SignalCard signal={data.signal} />

          <div style={styles.filteredSection}>
            <button
              type="button"
              onClick={() => setShowFiltered((s) => !s)}
              style={styles.filteredToggle}
            >
              <span>
                Signaux filtrés{" "}
                <span style={styles.countPill}>
                  {counts.filtered} filtrés · {counts.emitted} émis
                </span>
              </span>
              <span>{showFiltered ? "▲" : "▼"}</span>
            </button>

            {showFiltered && (
              <div style={styles.filteredList}>
                {filteredHistory.length === 0 && (
                  <div style={styles.filteredEmpty}>Aucun signal filtré pour l'instant.</div>
                )}
                {filteredHistory.map((f, i) => (
                  <div key={i} style={styles.filteredItem}>
                    <span
                      style={{
                        ...styles.filteredSide,
                        color: f.side === "BUY" ? "var(--buy)" : "var(--sell)"
                      }}
                    >
                      {f.side}
                    </span>
                    <span style={styles.filteredReason}>{f.reason}</span>
                    <span style={styles.filteredTime}>
                      {f.time ? new Date(f.time).toLocaleTimeString() : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!data && !error && <div style={styles.loading}>Connexion au flux OANDA…</div>}

      <footer style={styles.footer}>
        Bougies M1 · rafraîchi toutes les {POLL_MS / 1000}s · Compte practice OANDA — pas d'exécution automatique.
      </footer>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100%",
    maxWidth: 480,
    margin: "0 auto",
    padding: "24px 16px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 20
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end"
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)"
  },
  title: {
    margin: "4px 0 0",
    fontSize: 26,
    fontFamily: "var(--font-mono)",
    color: "var(--gold)",
    letterSpacing: "0.02em"
  },
  priceBlock: {
    textAlign: "right"
  },
  price: {
    fontFamily: "var(--font-mono)",
    fontSize: 32,
    fontWeight: 600,
    transition: "color 300ms ease"
  },
  priceUnit: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginLeft: 4
  },
  chartWrap: {
    background: "var(--panel)",
    border: "1px solid var(--panel-border)",
    borderRadius: 12,
    padding: "8px 4px"
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10
  },
  trendBanner: {
    background: "var(--panel)",
    border: "1px solid var(--gold)",
    color: "var(--gold)",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 12,
    lineHeight: 1.4
  },
  trendDetail: {
    color: "var(--text-muted)"
  },
  loading: {
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
    fontSize: 14
  },
  error: {
    background: "var(--sell-bg)",
    border: "1px solid var(--sell)",
    color: "var(--sell)",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13
  },
  filteredSection: {
    border: "1px solid var(--panel-border)",
    borderRadius: 12,
    overflow: "hidden"
  },
  filteredToggle: {
    width: "100%",
    background: "var(--panel)",
    border: "none",
    color: "var(--text)",
    padding: "10px 12px",
    fontSize: 13,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer"
  },
  countPill: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginLeft: 6
  },
  filteredList: {
    display: "flex",
    flexDirection: "column",
    maxHeight: 220,
    overflowY: "auto"
  },
  filteredEmpty: {
    padding: "10px 12px",
    fontSize: 12,
    color: "var(--text-muted)"
  },
  filteredItem: {
    display: "grid",
    gridTemplateColumns: "50px 1fr auto",
    gap: 8,
    padding: "8px 12px",
    fontSize: 12,
    borderTop: "1px solid var(--panel-border)"
  },
  filteredSide: {
    fontWeight: 700,
    fontFamily: "var(--font-mono)"
  },
  filteredReason: {
    color: "var(--text-muted)"
  },
  filteredTime: {
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)"
  },
  footer: {
    marginTop: 8,
    fontSize: 11,
    color: "var(--text-muted)",
    textAlign: "center",
    lineHeight: 1.5
  }
};
