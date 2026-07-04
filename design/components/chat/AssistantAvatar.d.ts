import React from "react";
export interface AssistantAvatarProps {
  size?: number;
  shape?: "square" | "circle";
  /** Looping highlight sweep (the "Nexus is here" signal). Default true. */
  sweep?: boolean;
  style?: React.CSSProperties;
}
/** The Nexus assistant mark — sparkles on shimmer. The only filled brand glyph. */
export function AssistantAvatar(props: AssistantAvatarProps): JSX.Element;
