import React from "react";

/**
 * Nexus Moves — AssistantAvatar. The one filled brand mark: a sparkles glyph
 * on the signature shimmer. Square (mobile header) or circle (chat rows).
 */
export function AssistantAvatar({ size = 44, shape = "square", sweep = true, style = {} }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, flex: "none",
      borderRadius: shape === "circle" ? "999px" : "var(--r-md)",
      background: "var(--shimmer)", position: "relative", overflow: "hidden",
      boxShadow: "var(--glow-shimmer)", ...style,
    }}>
      {sweep && (
        <span style={{
          position: "absolute", inset: 0, width: "50%",
          background: "linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent)",
          animation: "nx-shimmer-sweep var(--shimmer-sweep) var(--ease-standard) infinite",
        }} />
      )}
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none"
        stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ position: "relative" }}>
        <path d="M12 3l1.7 4.6L18 9.2l-4.3 1.6L12 15.4l-1.7-4.6L6 9.2l4.3-1.6z" fill="#fff" stroke="none" />
        <path d="M18.5 14l.9 2.2 2.1.9-2.1.9-.9 2.2-.9-2.2-2.1-.9 2.1-.9z" fill="#fff" stroke="none" />
      </svg>
    </span>
  );
}
