import React from "react";
export interface IconButtonProps {
  children?: React.ReactNode;
  tone?: "default" | "accent" | "quiet" | "plain";
  /** px, defaults 44 (min tap target). */
  size?: number;
  round?: "circle" | "square";
  disabled?: boolean;
  "aria-label"?: string;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}
/** Icon-only button (composer +, send, ellipsis menu). Always pass aria-label. */
export function IconButton(props: IconButtonProps): JSX.Element;
