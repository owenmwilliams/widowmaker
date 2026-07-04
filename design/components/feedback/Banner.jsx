import React from "react";

/**
 * Nexus Moves — Banner. Inline informational callout.
 * tones: warning (cream/amber, the honest nudge), success, info, danger.
 */
export function Banner({ children, tone = "warning", icon = null, title = null, style = {} }) {
  const tones = {
    warning: { background: "var(--warning-surface)", color: "var(--warning-ink)", iconColor: "var(--warning)" },
    success: { background: "var(--success-quiet)", color: "var(--success)", iconColor: "var(--success)" },
    info: { background: "var(--accent-quiet)", color: "var(--accent)", iconColor: "var(--accent)" },
    danger: { background: "var(--danger-quiet)", color: "var(--danger)", iconColor: "var(--danger)" },
  };
  const t = tones[tone] || tones.warning;
  const defaultIcon = (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  );
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      background: t.background, color: t.color,
      borderRadius: "var(--r-lg)", padding: "15px 17px",
      fontFamily: "var(--font-ui)", fontSize: 15, lineHeight: 1.42, fontWeight: 500,
      ...style,
    }}>
      <span style={{ display: "inline-flex", width: 22, height: 22, flex: "none", color: t.iconColor, marginTop: 1 }}>
        {icon || defaultIcon}
      </span>
      <div>
        {title && <div style={{ fontWeight: 700, marginBottom: 3 }}>{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}
