import React from "react";
export interface StatusPillProps {
  children?: React.ReactNode;
  tone?: "success" | "accent" | "neutral";
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}
/** Centered inline status divider in the chat stream. */
export function StatusPill(props: StatusPillProps): JSX.Element;
