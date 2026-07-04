import React from "react";
export interface StatCardProps {
  icon?: React.ReactNode;
  value: React.ReactNode;
  label: string;
  sublabel?: string;
  tone?: "accent" | "cyan" | "beacon" | "success" | "warning" | "danger";
  style?: React.CSSProperties;
}
/**
 * Dashboard metric tile (Items, Total Weight, Fragile Items, …).
 * @startingPoint section="Data" subtitle="Dashboard metric tile" viewport="320x150"
 */
export function StatCard(props: StatCardProps): JSX.Element;
