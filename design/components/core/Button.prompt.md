The primary Nexus Moves button — use for any tap/click action; reserve the `shimmer` variant for one hero or AI-forward CTA per screen (e.g. "Share inventory").

```jsx
<Button variant="primary" size="lg" fullWidth icon={<ShareIcon />}>
  Share inventory
</Button>
```

Variants: `primary` (solid Nexus Blue, default), `shimmer` (blue→cyan gradient with a looping sweep — the "intelligence" CTA), `secondary` (quiet accent tint on a surface, e.g. "Estimate weights"), `ghost` (transparent, low-priority), `danger`. Sizes `sm`/`md`/`lg`. Press = scale 0.97; hover deepens color / adds glow. Never use two `shimmer` buttons on one screen.
