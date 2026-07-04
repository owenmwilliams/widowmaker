import React from "react";
export interface ChecklistItemProps {
  children?: React.ReactNode;
  checked?: boolean;
  onToggle?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}
/** A "Next steps" checklist row — accent ring when open, filled check when done. */
export function ChecklistItem(props: ChecklistItemProps): JSX.Element;
