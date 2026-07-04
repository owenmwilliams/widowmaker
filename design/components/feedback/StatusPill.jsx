import React from "react";

/**
 * Nexus Moves — StatusPill. A centered inline status marker in the chat stream
 * (e.g. "Items reviewed · 8 added"). Not a badge — this is a conversational divider.
 */
export function StatusPill({ children, tone = "success", icon = null, style = {} }) {
  const tones = {
    success: { color: "var(--success)", ring: "var(--success)" },
    accent: { color: "var(--accent)", ring: "var(--accent)" },
    neutral: { color: "var(--text-secondary)", ring: "var(--text-tertiary)" },
  };
  const t = tones[tone] || tones.success;
  const defaultIcon = (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      alignSelf: "center", padding: "8px 16px",
      background: "var(--surface-card)", borderRadius: "var(--r-pill)",
      fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, color: t.color,
      ...style,
    }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18, borderRadius: "999px",
        border: "1.5px solid " + t.ring, padding: 2,
      }}>{icon || defaultIcon}</span>
      {children}
    </span>
  );
}
