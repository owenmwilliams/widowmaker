import React from "react";

/**
 * Nexus Moves — Sheet. iOS-style bottom sheet header (grabber + title + Done).
 * Wrap sheet content below <SheetHeader/>. Provided as a header primitive.
 */
export function Sheet({ title, onDone, doneLabel = "Done", children, style = {} }) {
  return (
    <div style={{
      background: "var(--surface-sunk)",
      borderTopLeftRadius: "var(--r-2xl)", borderTopRightRadius: "var(--r-2xl)",
      boxShadow: "var(--shadow-sheet)",
      overflow: "hidden", ...style,
    }}>
      <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
        <span style={{ width: 40, height: 5, borderRadius: "999px", background: "var(--border)" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px 16px" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>{title}</span>
        {onDone && (
          <button onClick={onDone} style={{
            border: "none", background: "var(--surface-card)", color: "var(--text-primary)",
            fontFamily: "var(--font-ui)", fontSize: 16, fontWeight: 600,
            padding: "8px 18px", borderRadius: "var(--r-pill)", cursor: "pointer",
          }}>{doneLabel}</button>
        )}
      </div>
      <div style={{ padding: "0 20px 24px" }}>{children}</div>
    </div>
  );
}
