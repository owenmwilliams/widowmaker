import React from "react";

/**
 * Nexus Moves — Button
 * Variants: primary (solid Nexus Blue), shimmer (signature gradient, hero/AI),
 * secondary (quiet accent fill), ghost (transparent), danger.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  disabled = false,
  icon = null,
  iconRight = null,
  onClick,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);

  const sizes = {
    sm: { padding: "0 14px", height: 36, font: 14, radius: "var(--r-md)", gap: 7 },
    md: { padding: "0 20px", height: 48, font: 16, radius: "var(--r-md)", gap: 9 },
    lg: { padding: "0 26px", height: 56, font: 17, radius: "var(--r-lg)", gap: 10 },
  };
  const s = sizes[size] || sizes.md;

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: s.gap,
    height: s.height,
    padding: s.padding,
    width: fullWidth ? "100%" : "auto",
    borderRadius: s.radius,
    fontFamily: "var(--font-ui)",
    fontSize: s.font,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transform: press && !disabled ? "scale(0.97)" : "scale(1)",
    transition: "transform var(--dur-fast) var(--ease-standard), background var(--dur-base), box-shadow var(--dur-base)",
    position: "relative",
    overflow: "hidden",
    WebkitTapHighlightColor: "transparent",
  };

  const variants = {
    primary: {
      background: hover ? "var(--accent-hover)" : "var(--accent)",
      color: "var(--on-accent)",
      boxShadow: hover ? "var(--glow-accent)" : "none",
    },
    shimmer: {
      background: "var(--shimmer)",
      color: "#fff",
      boxShadow: hover ? "var(--glow-shimmer)" : "none",
    },
    secondary: {
      background: hover ? "var(--accent-quiet-2)" : "var(--accent-quiet)",
      color: "var(--accent)",
    },
    ghost: {
      background: hover ? "var(--surface-hover)" : "transparent",
      color: "var(--text-primary)",
    },
    danger: {
      background: hover ? "var(--red-600)" : "var(--danger)",
      color: "#fff",
    },
  };

  return (
    <button
      style={{ ...base, ...(variants[variant] || variants.primary), ...style }}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      {...rest}
    >
      {variant === "shimmer" && (
        <span style={{
          position: "absolute", inset: 0, width: "45%",
          background: "linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)",
          animation: "nx-shimmer-sweep var(--shimmer-sweep) var(--ease-standard) infinite",
          pointerEvents: "none",
        }} />
      )}
      {icon && <span style={{ display: "inline-flex", width: s.font + 2, height: s.font + 2 }}>{icon}</span>}
      {children}
      {iconRight && <span style={{ display: "inline-flex", width: s.font + 2, height: s.font + 2 }}>{iconRight}</span>}
    </button>
  );
}
