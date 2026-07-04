import React from "react";
export interface SheetProps {
  title?: string;
  /** Renders a "Done" pill in the header when provided. */
  onDone?: () => void;
  doneLabel?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
/** iOS-style bottom sheet (grabber + title + Done), e.g. "Get ready to share". */
export function Sheet(props: SheetProps): JSX.Element;
