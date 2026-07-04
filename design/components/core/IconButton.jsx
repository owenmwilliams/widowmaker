import React from "react";

/**
 * Nexus Moves — IconButton. Circular / rounded-square icon-only control.
 * Tones: default (neutral surface), accent (solid), quiet (accent tint), plain.
 */
export function IconButton({
  children,
  tone = "default",
  size = 44,
  round = "circle",
  disabled = false,
  "aria-label": ariaLabel,
  onClick,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);

  const tones = {
    default: { background: hover ? "var(--surface-hover)" : "var(--surface-card)", color: "var(--text-primary)" },
    accent: { background: hover ? "var(--accent-hover)" : "var(--accent)", color: "#fff" },
    quiet: { background: hover ? "var(--accent-quiet-2)" : "var(--accent-quiet)", color: "var(--accent)" },
    plain: { background: hover ? "var(--surface-hover)" : "transparent", color: "var(--text-secondary)" },
  };

  return (
    <button
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: size, height: size, flex: "none", padding: 0, border: "none",
        borderRadius: round === "circle" ? "999px" : "var(--r-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transform: press && !disabled ? "scale(0.92)" : "scale(1)",
        transition: "transform var(--dur-fast) var(--ease-standard), background var(--dur-base)",
        WebkitTapHighlightColor: "transparent",
        ...(tones[tone] || tones.default), ...style,
      }}
      {...rest}
    >
      <span style={{ display: "inline-flex", width: Math.round(size * 0.45), height: Math.round(size * 0.45) }}>{children}</span>
    </button>
  );
}
