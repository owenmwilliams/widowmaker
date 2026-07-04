import React from "react";
export interface ChatBubbleProps {
  children?: React.ReactNode;
  from?: "self" | "assistant";
  /** Self bubbles only: use the signature shimmer gradient (desktop treatment). */
  shimmer?: boolean;
  /** Optional timestamp shown under the bubble. */
  time?: string;
  style?: React.CSSProperties;
}
/**
 * A chat message bubble.
 * @startingPoint section="Chat" subtitle="User & assistant message bubbles" viewport="700x260"
 */
export function ChatBubble(props: ChatBubbleProps): JSX.Element;
