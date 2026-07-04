import React from "react";

/**
 * Nexus Moves — ChatBubble.
 * from="self" → the user's message: solid Nexus Blue (mobile) or shimmer (desktop).
 * from="assistant" → Nexus: a card-surface bubble.
 */
export function ChatBubble({ children, from = "assistant", shimmer = false, time = null, style = {} }) {
  const isSelf = from === "self";
  const bg = isSelf ? (shimmer ? "var(--shimmer)" : "var(--bubble-self)") : "var(--bubble-other)";
  const color = isSelf ? "var(--bubble-self-text)" : "var(--bubble-other-text)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isSelf ? "flex-end" : "flex-start", maxWidth: "82%", alignSelf: isSelf ? "flex-end" : "flex-start" }}>
      <div style={{
        position: "relative", overflow: "hidden",
        background: bg, color,
        padding: "13px 17px",
        borderRadius: "var(--r-xl)",
        borderBottomRightRadius: isSelf ? 7 : "var(--r-xl)",
        borderBottomLeftRadius: isSelf ? "var(--r-xl)" : 7,
        fontFamily: "var(--font-ui)", fontSize: 17, lineHeight: 1.45,
        fontWeight: isSelf ? 600 : 400,
        boxShadow: isSelf ? "none" : "var(--shadow-dark-sm)",
        ...style,
      }}>
        {isSelf && shimmer && (
          <span style={{
            position: "absolute", inset: 0, width: "45%",
            background: "linear-gradient(90deg,transparent,rgba(255,255,255,.32),transparent)",
            animation: "nx-shimmer-sweep var(--shimmer-sweep) var(--ease-standard) infinite",
            pointerEvents: "none",
          }} />
        )}
        <span style={{ position: "relative", whiteSpace: "pre-wrap" }}>{children}</span>
      </div>
      {time && <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-tertiary)", margin: "5px 4px 0" }}>{time}</span>}
    </div>
  );
}
