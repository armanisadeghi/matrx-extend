# matrx-extend-tool-display — worked examples

## Reference: the `ctx_get` worked example

One of many registered tools (the live set is the `entries` map in `src/features/chat/tool-display/registry.tsx`). It's the canonical example for the four core capabilities:

```ts
ctx_get: {
  inline: {
    icon:   { started: 'Loader2', completed: 'HandGrab', error: 'AlertTriangle' },
    prefix: { started: 'Getting', completed: 'Got', error: 'Failed to get' },
    name:   '',
    info:   { path: 'args.key', transform: 'snakeToTitle' },
    color:  { started: 'primary', completed: 'blue', error: 'red' },
  },
  args: { displayType: 'key-value' },
  results: {
    displayType: 'custom',
    keysInfo: [
      { key: 'label',   component: 'BoldLabel', className: 'text-foreground' },
      { key: 'content', component: 'Markdown',  className: 'text-foreground', transform: 'textClean' },
    ],
  },
}
```

Reads as: "While running, show a spinner with `Getting Clean Content Markdown` in primary color. After success, swap to a HandGrab icon and `Got Clean Content Markdown` in blue. On error, red AlertTriangle and `Failed to get Clean Content Markdown`. Expanded body shows args as a key-value grid, then a bold label + markdown-rendered content with backslash escapes cleaned."

Use it as the starting template for new entries.

### A second example — `take_screenshot`

Demonstrates: the whole-result key convention, the `Base64Image` field component, and using a transform on the entire output object for the inline info.

```ts
take_screenshot: {
  inline: {
    icon:   { started: 'Loader2', completed: 'Camera', error: 'AlertTriangle' },
    prefix: {
      started:   'Capturing screenshot',
      completed: 'Captured screenshot',
      error:     'Failed to capture screenshot',
    },
    name:   '',
    info:   { completed: { path: 'output', transform: 'formatImageDimensions' } },
    color:  { started: 'primary', completed: 'violet', error: 'red' },
  },
  args: { displayType: 'key-value' },
  results: {
    displayType: 'custom',
    keysInfo: [{ key: '', component: 'Base64Image' }],
  },
}
```

Reads as: "While capturing, show a spinner with `Capturing screenshot` in primary color. After success, swap to a Camera icon and `Captured screenshot 2576×1911` in violet — dimensions extracted by `formatImageDimensions` reading `width`/`height` off the whole output object. The expanded body renders the actual image inline, with a small caption underneath showing `2576×1911 · 313.0 KB`. On error, red AlertTriangle and `Failed to capture screenshot` with no dimensions."
