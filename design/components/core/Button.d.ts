import React from "react";

export interface ButtonProps {
  children?: React.ReactNode;
  /** primary = solid Nexus Blue (default action). shimmer = signature gradient, reserve for hero/AI CTAs. secondary = quiet accent fill. ghost = transparent. danger = destructive. */
  variant?: "primary" | "shimmer" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  disabled?: boolean;
  /** Leading icon (ReactNode / SVG). Inherits currentColor. */
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

/**
 * The Nexus Moves button.
 * @startingPoint section="Core" subtitle="Buttons — primary, shimmer, secondary, ghost" viewport="700x220"
 */
export function Button(props: ButtonProps): JSX.Element;
