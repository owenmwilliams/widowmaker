A chat message bubble. Assistant messages are card-surface with a small bottom-left tail; user messages are solid Nexus Blue (mobile) with a bottom-right tail, or `shimmer` on desktop.

```jsx
<ChatBubble from="assistant">What else should we add to the Hallway, Owen?</ChatBubble>
<ChatBubble from="self">Everything in this closet</ChatBubble>
<ChatBubble from="self" shimmer time="2:32 PM">Added 1 of the 1 items from the scan.</ChatBubble>
```

Body text is 17px. Assistant = weight 400; self = 600. Wrap a chat column in a flex column with `gap` between bubbles.
