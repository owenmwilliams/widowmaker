import React from "react";

/**
 * Nexus Moves — SuggestionButton. The assistant's proposed next actions.
 * variant="block" → full-width accent-tinted row (mobile). variant="outline" → pill (desktop).
 */
export function SuggestionButton({ children, icon = null, variant = "block", onClick, style = {} }) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const block = variant === "block";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 12,
        width: block ? "100%" : "auto",
        justifyContent: block ? "flex-start" : "center",
        padding: block ? "16px 18px" : "11px 18px",
        borderRadius: block ? "var(--r-lg)" : "var(--r-pill)",
        fontFamily: "var(--font-ui)", fontSize: block ? 17 : 15, fontWeight: 700,
        letterSpacing: "-0.01em", cursor: "pointer", textAlign: "left",
        color: "var(--accent)",
        background: block
          ? (hover ? "var(--accent-quiet-2)" : "var(--accent-quiet)")
          : (hover ? "var(--accent-quiet)" : "transparent"),
        border: block ? "none" : "1.5px solid var(--border)",
        transform: press ? "scale(0.985)" : "scale(1)",
        transition: "transform var(--dur-fast) var(--ease-standard), background var(--dur-base)",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      {icon && <span style={{ display: "inline-flex", width: 20, height: 20, flex: "none" }}>{icon}</span>}
      {children}
    </button>
  );
}
