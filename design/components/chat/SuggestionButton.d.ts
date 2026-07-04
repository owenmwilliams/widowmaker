import React from "react";
export interface SuggestionButtonProps {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  /** block = full-width tinted row (mobile). outline = pill (desktop). */
  variant?: "block" | "outline";
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}
/** A suggested next action offered by Nexus beneath a message. */
export function SuggestionButton(props: SuggestionButtonProps): JSX.Element;
