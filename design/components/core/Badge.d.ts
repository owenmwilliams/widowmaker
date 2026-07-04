import React from "react";
export interface BadgeProps {
  children?: React.ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "beacon";
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}
/** Small pill label for counts/status (e.g. "281 this week", "Fragile"). */
export function Badge(props: BadgeProps): JSX.Element;
