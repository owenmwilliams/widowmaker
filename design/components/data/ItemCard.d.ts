import React from "react";
export interface ItemCardProps {
  /** Object glyph (line icon / small duotone). */
  icon?: React.ReactNode;
  name: string;
  /** Secondary line — weight, volume, or count (mono). e.g. "44 lb". */
  meta?: string;
  /** Show the green verified check. Default true. */
  verified?: boolean;
  style?: React.CSSProperties;
}
/**
 * A verified inventory item chip (icon + name + weight). The signature
 * proof-of-inventory element; floats over hero art or lists in the app.
 * @startingPoint section="Data" subtitle="Verified item card" viewport="220x72"
 */
export function ItemCard(props: ItemCardProps): JSX.Element;
