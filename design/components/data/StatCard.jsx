import React from "react";

/**
 * Nexus Moves — StatCard. Dashboard metric tile: icon chip, big value, label, sublabel.
 */
export function StatCard({ icon = null, value, label, sublabel = null, tone = "accent", style = {} }) {
  const tones = {
    accent: "var(--accent)",
    cyan: "var(--cyan-500)",
    beacon: "var(--beacon-500)",
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
  };
  const c = tones[tone] || tones.accent;
  return (
    <div style={{
      background: "var(--surface-card)", border: "1px solid var(--border)",
      borderRadius: "var(--r-lg)", padding: 20, boxShadow: "var(--shadow-sm)",
      display: "flex", flexDirection: "column", gap: 12, ...style,
    }}>
      {icon && (
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 40, height: 40, borderRadius: "var(--r-md)",
          background: "color-mix(in oklab, " + c + " 14%, transparent)", color: c,
        }}>
          <span style={{ display: "inline-flex", width: 22, height: 22 }}>{icon}</span>
        </span>
      )}
      <div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)", lineHeight: 1 }}>{value}</div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginTop: 8 }}>{label}</div>
        {sublabel && <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-tertiary)", marginTop: 2 }}>{sublabel}</div>}
      </div>
    </div>
  );
}
