import React from "react";

/**
 * Nexus Moves — Badge. Small status/label token.
 * Tones: neutral, accent, success, warning, danger, beacon.
 */
export function Badge({ children, tone = "neutral", icon = null, style = {} }) {
  const tones = {
    neutral: { background: "var(--surface-hover)", color: "var(--text-secondary)" },
    accent: { background: "var(--accent-quiet)", color: "var(--accent)" },
    success: { background: "var(--success-quiet)", color: "var(--success)" },
    warning: { background: "color-mix(in oklab, var(--warning) 18%, transparent)", color: "var(--warning)" },
    danger: { background: "var(--danger-quiet)", color: "var(--danger)" },
    beacon: { background: "color-mix(in oklab, var(--beacon-500) 18%, transparent)", color: "var(--beacon-500)" },
  };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: "var(--r-pill)",
      fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700,
      letterSpacing: "-0.005em", lineHeight: 1.4, whiteSpace: "nowrap",
      ...(tones[tone] || tones.neutral), ...style,
    }}>
      {icon && <span style={{ display: "inline-flex", width: 13, height: 13 }}>{icon}</span>}
      {children}
    </span>
  );
}
