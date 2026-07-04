import React from "react";
export interface InputProps {
  /** field = labeled form input. composer = the rounded chat message bar. */
  variant?: "field" | "composer";
  label?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  /** Leading adornment (icon). */
  leading?: React.ReactNode;
  /** Trailing adornment — e.g. the send IconButton in a composer. */
  trailing?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}
/** Text input — labeled field or the chat composer bar. */
export function Input(props: InputProps): JSX.Element;
