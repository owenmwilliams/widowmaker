import React from "react";
export interface ProgressBarProps {
  /** 0–100. */
  value?: number;
  label?: string;
  showPercent?: boolean;
  height?: number;
  /** Looping highlight while in progress (hidden at 0/100). */
  sweep?: boolean;
  style?: React.CSSProperties;
}
/** Inventory-readiness progress. Shimmer fill. */
export function ProgressBar(props: ProgressBarProps): JSX.Element;
