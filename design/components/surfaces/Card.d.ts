import React from "react";
export interface CardProps {
  children?: React.ReactNode;
  padding?: number;
  /** Adds hover lift + pointer for clickable cards. */
  interactive?: boolean;
  style?: React.CSSProperties;
}
/** Base surface: hairline border, 18px radius, soft shadow (light) / lift (dark). No colored left-borders. */
export function Card(props: CardProps): JSX.Element;
