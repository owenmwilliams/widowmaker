import React from "react";

/**
 * Nexus Moves — ItemCard. A floating "verified item" chip: object icon + name + weight.
 * The product's signature proof-of-inventory moment (Box 20 kg, Lamp 3 kg…).
 */
export function ItemCard({ icon = null, name, meta, verified = true, style = {} }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 13,
      background: "var(--surface-card)", border: "1px solid var(--border)",
      borderRadius: "var(--r-md)", padding: "12px 16px",
      boxShadow: "var(--shadow-md)", minWidth: 168,
      fontFamily: "var(--font-ui)", ...style,
    }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 40, height: 40, flex: "none", borderRadius: "var(--r-sm)",
        background: "var(--l-card-2)", color: "var(--navy-600)",
      }}>
        <span style={{ display: "inline-flex", width: 24, height: 24 }}>{icon}</span>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{name}</span>
          {verified && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-label="verified">
              <circle cx="12" cy="12" r="10" fill="var(--success)" />
              <path d="M8.5 12.2l2.4 2.3 4.6-4.8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500, color: "var(--text-tertiary)", marginTop: 1 }}>{meta}</div>
      </div>
    </div>
  );
}
