import React from "react";

/**
 * Nexus Moves — ProgressBar. Inventory readiness. Fill uses the signature shimmer.
 */
export function ProgressBar({ value = 0, label = null, showPercent = true, height = 10, sweep = true, style = {} }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ fontFamily: "var(--font-ui)", ...style }}>
      {(label || showPercent) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          {label && <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>{label}</span>}
          {showPercent && <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: "var(--text-secondary)" }}>{Math.round(pct)}%</span>}
        </div>
      )}
      <div style={{ height, borderRadius: "var(--r-pill)", background: "var(--surface-hover)", overflow: "hidden" }}>
        <div style={{
          width: pct + "%", height: "100%", borderRadius: "var(--r-pill)",
          background: "var(--shimmer)", position: "relative", overflow: "hidden",
          transition: "width var(--dur-slow) var(--ease-standard)",
        }}>
          {sweep && pct > 0 && pct < 100 && (
            <span style={{
              position: "absolute", inset: 0, width: "40%",
              background: "linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent)",
              animation: "nx-shimmer-sweep var(--shimmer-sweep) var(--ease-standard) infinite",
            }} />
          )}
        </div>
      </div>
    </div>
  );
}
