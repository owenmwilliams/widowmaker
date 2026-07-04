import React from "react";
export interface BannerProps {
  children?: React.ReactNode;
  tone?: "warning" | "success" | "info" | "danger";
  /** Override the default tone icon. */
  icon?: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
}
/** Inline callout for honest nudges, confirmations, and alerts. */
export function Banner(props: BannerProps): JSX.Element;
