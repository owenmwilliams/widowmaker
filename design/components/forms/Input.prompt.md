Text input. `composer` is the signature rounded chat bar ("Message Nexus…") with a leading + and a trailing send button; `field` is a standard labeled form input.

```jsx
<Input variant="composer" placeholder="Message Nexus…"
  leading={<IconButton tone="accent" aria-label="Add"><PlusIcon/></IconButton>}
  trailing={<IconButton tone="default" aria-label="Send"><ArrowUpIcon/></IconButton>} />

<Input variant="field" label="Street address" placeholder="123 Main St" />
```
