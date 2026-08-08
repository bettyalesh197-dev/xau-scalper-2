import React from "react";

export default function SignalCard({ signal }) {
  if (!signal) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyDot} />
        <div>
          <div style={styles.emptyTitle}>Aucune configuration valide</div>
          <div style={styles.emptySub}>
            En attente d'un rebond sur support/résistance confirmé par le RSI.
          </div>
        </div>
      </div>
    );
  }

  const isBuy = signal.side === "BUY";
  const tone = isBuy ? "var(--buy)" : "var(--sell)";
  const bg = isBuy ? "var(--buy-bg)" : "var(--sell-bg)";

  return (
    <div style={{ ...styles.card, borderColor: tone, background: bg }}>
      <div style={styles.headRow}>
        <span style={{ ...styles.side, color: tone }}>{signal.side}</span>
        <span style={styles.time}>{formatTime(signal.time)}</span>
      </div>
      <div style={styles.reason}>{signal.reason}</div>

      <div style={styles.levels}>
        <Level label="Entrée" value={signal.entry} />
        <Level label="Stop Loss" value={signal.sl} tone="sell" />
        <Level label="TP1" value={signal.tp1} tone="buy" />
        <Level label="TP2" value={signal.tp2} tone="buy" />
      </div>
    </div>
  );
}

function Level({ label, value, tone }) {
  const color = tone === "buy" ? "var(--buy)" : tone === "sell" ? "var(--sell)" : "var(--text)";
  return (
    <div style={styles.level}>
      <span style={styles.levelLabel}>{label}</span>
      <span style={{ ...styles.levelValue, color }}>{value?.toFixed(2)}</span>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const styles = {
  card: { border: "1px solid", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  side: { fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, letterSpacing: "0.05em" },
  time: { fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" },
  reason: { fontSize: 13, color: "var(--text-muted)" },
  levels: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  level: { display: "flex", flexDirection: "column", gap: 2 },
  levelLabel: { fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" },
  levelValue: { fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600 },
  empty: { display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 14, padding: 16 },
  emptyDot: { width: 8, height: 8, borderRadius: "50%", background: "var(--gold-dim)", flexShrink: 0 },
  emptyTitle: { fontSize: 14, fontWeight: 600 },
  emptySub: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 }
};
