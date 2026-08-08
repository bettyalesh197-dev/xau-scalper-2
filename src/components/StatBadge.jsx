import React from "react";

export default function StatBadge({ label, value, tone }) {
  const color =
    tone === "buy" ? "var(--buy)" : tone === "sell" ? "var(--sell)" : "var(--text)";

  return (
    <div style={styles.badge}>
      <span style={styles.label}>{label}</span>
      <span style={{ ...styles.value, color }}>{value ?? "—"}</span>
    </div>
  );
}

const styles = {
  badge: { background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" },
  value: { fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600 }
};
