import React from "react";
export interface ChipProps {
  children?: React.ReactNode;
  selected?: boolean;
  icon?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  /** When provided, renders a × to remove. */
  onRemove?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}
/** Inline pill for filters, room tabs, removable tokens. */
export function Chip(props: ChipProps): JSX.Element;
