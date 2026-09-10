# matrx-extend-tool-display — cookbook

## Contents

- Common patterns (cookbook)
  - Phase-aware prefix that conjugates by tense
  - "Saving X" → "Saved X" with the X coming from args
  - Inline shows a count from the result, only after completion
  - Render a result that's a list of `{title, url}` objects
  - Suppress the row entirely while running, show only when done
- Cookbook — phased animations and dynamic icons
  - Long-running tool with shimmering query as the label
  - Per-category dynamic icon
  - Favicon as the inline icon

## Common patterns (cookbook)

### Phase-aware prefix that conjugates by tense

```ts
prefix: { started: 'Searching', completed: 'Searched', error: 'Search failed' }
```

### "Saving X" → "Saved X" with the X coming from args

```ts
inline: {
  prefix: { started: 'Saving', completed: 'Saved' },
  name: '',   // suppress the auto title-case
  info: { path: 'args.title', transform: 'truncate80' },
}
```

### Inline shows a count from the result, only after completion

```ts
info: {
  started: undefined,
  completed: { path: 'output.items.length', fallback: '0' },
}
// Wrap in suffix instead if you want "Found 7 results":
// suffix: { completed: 'results' },
// info:   { completed: { path: 'output.items.length' } },
```

### Render a result that's a list of `{title, url}` objects

Use a CustomComponent — `keysInfo` only addresses single values, not "render every item in this array". Or pre-shape the result on the server.

### Suppress the row entirely while running, show only when done

```ts
inline: { hidden: { started: true } }
```

## Cookbook — phased animations and dynamic icons

### Long-running tool with shimmering query as the label

```ts
// `find` — natural-language element search; sometimes 10–20s
find: {
  inline: {
    icon: 'Search',                                  // spins on started by default
    prefix: { started: 'Searching for', completed: 'Found', error: 'Search failed' },
    name: { path: 'args.query', transform: 'truncate80' },  // query becomes the label
    info: { completed: { path: 'output.matches.length', fallback: '0' } },
    suffix: { completed: 'matches' },
    color: { started: 'primary', completed: 'violet', error: 'red' },
    // shimmerOnRunning defaults to true — the query shimmers while we search
  },
}
```

While running: spinning Search icon + shimmering "Searching for the sign-in button". On success: violet Search + "Found the sign-in button 3 matches".

### Per-category dynamic icon

```ts
// `load_chrome_tools` — category in args drives the icon
load_chrome_tools: {
  inline: {
    icon: {
      started: 'Loader2',
      completed: { path: 'args.category', transform: 'browserCategoryIcon' },
      error: 'AlertTriangle',
    },
    prefix: { started: 'Loading my', completed: 'Loaded my', error: 'Failed to load my' },
    name: { path: 'args.category' },
    suffix: 'browser tools',
  },
}
```

`forms` category → FormInput icon. `cookies` → Cookie. `debug` → Bug. Add new categories to `BROWSER_CATEGORY_ICONS` in `registry-transforms.ts`.

### Favicon as the inline icon

```ts
// `get_active_tab` — the tab's own favicon becomes the row icon
get_active_tab: {
  inline: {
    icon: {
      started: 'Loader2',
      completed: { path: 'output.fav_icon_url', fallback: 'Globe' },
      error: 'AlertTriangle',
    },
    prefix: { started: 'Reading active tab', error: "Couldn't read active tab" },
    name: { started: '', completed: { path: 'output.title', transform: 'truncate80' }, error: '' },
    info: { completed: { path: 'output.url', transform: 'truncate80' } },
  },
}
```

When the URL fails to load (CSP block, 404), it falls back to `Globe` automatically. The whole tab identity (favicon + title + URL) lives in the inline row — no expanded body needed.
