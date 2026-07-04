import React from "react";

/**
 * Nexus Moves — Card. The base surface for panels, sheets sections, list groups.
 * padded by default; hairline border; soft shadow on light, lift on dark.
 */
export function Card({ children, padding = 20, interactive = false, style = {} }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        padding,
        boxShadow: hover ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform: hover ? "translateY(-2px)" : "none",
        transition: "transform var(--dur-base) var(--ease-standard), box-shadow var(--dur-base)",
        cursor: interactive ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
