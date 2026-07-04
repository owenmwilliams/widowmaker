import React from "react";

/**
 * Nexus Moves — ChecklistItem. A "Next steps" row with an accent ring / check.
 */
export function ChecklistItem({ children, checked = false, onToggle, style = {} }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "flex-start", gap: 14, width: "100%",
        background: "transparent", border: "none", padding: "10px 0",
        cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 24, flex: "none", marginTop: 1, borderRadius: "999px",
        border: checked ? "none" : "2px solid var(--accent)",
        background: checked ? "var(--accent)" : "transparent",
      }}>
        {checked && (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        )}
      </span>
      <span style={{
        fontFamily: "var(--font-ui)", fontSize: 17, lineHeight: 1.4,
        fontWeight: 500,
        color: checked ? "var(--text-tertiary)" : "var(--text-primary)",
        textDecoration: checked ? "line-through" : "none",
      }}>{children}</span>
    </button>
  );
}
