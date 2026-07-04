import React from "react";

/**
 * Nexus Moves — Chip. Inline selectable/removable token (filters, rooms, tabs).
 * For the full-width assistant action buttons use SuggestionButton instead.
 */
export function Chip({ children, selected = false, icon = null, onClick, onRemove, style = {} }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        height: 36, padding: "0 14px", borderRadius: "var(--r-pill)",
        fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 600,
        cursor: "pointer", WebkitTapHighlightColor: "transparent",
        border: selected ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
        background: selected ? "var(--accent-quiet)" : (hover ? "var(--surface-hover)" : "transparent"),
        color: selected ? "var(--accent)" : "var(--text-primary)",
        transition: "background var(--dur-base), border-color var(--dur-base)",
        ...style,
      }}
    >
      {icon && <span style={{ display: "inline-flex", width: 15, height: 15 }}>{icon}</span>}
      {children}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(e); }}
          style={{ display: "inline-flex", marginLeft: 2, opacity: 0.7, fontSize: 16, lineHeight: 1 }}
        >×</span>
      )}
    </button>
  );
}
