import React from "react";

/**
 * Nexus Moves — Input. Two shapes:
 * variant="field" → labeled form field. variant="composer" → the rounded chat message bar.
 */
export function Input({
  variant = "field",
  label = null,
  placeholder = "",
  value,
  defaultValue,
  onChange,
  type = "text",
  leading = null,
  trailing = null,
  disabled = false,
  style = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const composer = variant === "composer";

  const wrap = {
    display: "flex", alignItems: "center", gap: 10,
    background: composer ? "var(--surface-card)" : "var(--surface)",
    border: composer ? "none" : ("1.5px solid " + (focus ? "var(--accent)" : "var(--border)")),
    borderRadius: composer ? "var(--r-pill)" : "var(--r-md)",
    padding: composer ? "0 8px 0 18px" : "0 14px",
    height: composer ? 52 : 48,
    boxShadow: focus && !composer ? "var(--focus-ring)" : "none",
    transition: "border-color var(--dur-base), box-shadow var(--dur-base)",
    opacity: disabled ? 0.5 : 1,
  };
  const input = {
    flex: 1, border: "none", outline: "none", background: "transparent",
    fontFamily: "var(--font-ui)", fontSize: composer ? 17 : 15,
    color: "var(--text-primary)", minWidth: 0, height: "100%",
  };

  return (
    <label style={{ display: "block", ...style }}>
      {label && <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 7 }}>{label}</span>}
      <div style={wrap}>
        {leading && <span style={{ display: "inline-flex", width: 20, height: 20, color: "var(--text-tertiary)", flex: "none" }}>{leading}</span>}
        <input
          type={type} placeholder={placeholder} value={value} defaultValue={defaultValue}
          onChange={onChange} disabled={disabled}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={input} {...rest}
        />
        {trailing && <span style={{ display: "inline-flex", flex: "none" }}>{trailing}</span>}
      </div>
    </label>
  );
}
