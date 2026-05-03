---
name: matrx-extend-tool-display
description: Customize how a tool call renders inside the matrx-extend Chrome extension's chat surface (the agent harness). Use when adding a new entry to the per-tool display registry — overriding the inline header (icon, prefix, name, suffix, info), tweaking how args and results are shown, plugging in a fully custom React component, or troubleshooting a registered tool that's falling back to the default rendering. Applies ONLY to this Chrome extension's `src/features/chat/tool-display/` system; do not use for other Matrx surfaces (admin UI, dashboard, workflow studio) which have their own UIs.
---

# matrx-extend Tool Display Registry

Per-tool customization for how a tool call shows up in the chat surface of the **matrx-extend Chrome extension** (the agent harness side panel). Anything not registered keeps rendering exactly as it does today — the registry only intercepts on opt-in.

**Scope guardrail**: this only applies to `src/features/chat/tool-display/` in the matrx-extend repo. The Matrx admin app, dashboard, workflow-studio, etc. are separate surfaces with their own rendering pipelines. Do NOT confuse with server-side tool catalog generation (`pnpm catalog:tools`) — that's about advertising tools to the LLM, not displaying their results to humans.

## When to use this skill

Trigger when the user asks to:
- Add a new tool to the display registry / "make X tool show up nicely"
- Customize what shows in the inline header (icon, prefix, "Getting X" labels, info hint)
- Render a tool's result with custom components instead of raw JSON
- Plug in a fully custom React component for one tool
- Debug a registered tool that's silently falling back to the default

## Mental model in 30 seconds

```
chat → ToolTimelineRow (client tools) ─┐
chat → ServerToolRow (server tools)  ─┴→ toolDisplayRegistry[toolName] ?
                                           ├─ no  → default rendering (unchanged)
                                           ├─ yes + cfg.CustomComponent → that
                                           └─ yes + config → ConfigurableToolRow
                                                       (wrapped in ToolDisplayBoundary)
```

Three failure modes are all silent — they log `console.warn` and degrade gracefully:
1. **Bad path/key** in config → that field is skipped, others render.
2. **Throwing transform / field component** → that field is skipped, others render.
3. **Throwing custom component** → entire row falls back to default.

The user never sees an error UI. Verify your config by checking the rendered row, not by waiting for an exception.

## Quick start — minimal entry

For a tool whose result has a `label` and `content` field that should render nicely:

```ts
// src/features/chat/tool-display/registry.tsx

export const toolDisplayRegistry: Record<string, ToolDisplayEntry> = {
  my_tool_name: {
    inline: {
      prefix: { started: 'Doing', completed: 'Did' },
      info: { path: 'args.target', transform: 'snakeToTitle' },
    },
    results: {
      displayType: 'custom',
      keysInfo: [
        { key: 'label',   component: 'BoldLabel' },
        { key: 'content', component: 'Markdown', transform: 'textClean' },
      ],
    },
  },
};
```

That's it. The tool name is the raw `toolName` string the SW dispatcher uses (e.g. `ctx_get`, `read_page`, `seo_get_keyword_data`) — not the title-cased label. Find it by triggering the tool once and reading the inline row.

## File map

| File | Purpose | When to edit |
|---|---|---|
| `src/features/chat/tool-display/registry.tsx` | The actual entries map | **Adding a new tool** — almost always the only file you touch |
| `src/features/chat/tool-display/types.ts` | TS shapes for the config | Only when adding a new top-level config field (rare) |
| `src/features/chat/tool-display/registry-transforms.ts` | Named transforms (`titleCase`, `textClean`, …) | Adding a reusable string transformer |
| `src/features/chat/tool-display/registry-components.tsx` | Field components (`BoldLabel`, `Markdown`, …) | Adding a new way to render a single value |
| `src/features/chat/tool-display/helpers.ts` | Resolution + error boundary | Almost never |
| `src/features/chat/tool-display/ConfigurableToolRow.tsx` | The renderer | Almost never — config-driven |
| `src/features/chat/ToolTimelineRow.tsx` | Client-tool dispatch (do NOT touch the default branch) | Only if changing the dispatcher itself |
| `src/features/chat/ServerToolRow.tsx` | Server-tool dispatch (same) | Same |

**One golden rule**: edits go to `registry.tsx` (and maybe `-transforms.ts` / `-components.tsx`). Never modify the default render paths in `ToolTimelineRow` / `ServerToolRow` — they are the safety net for every unregistered tool plus the fallback for any registered tool whose config blows up.

## The full config shape

Every visual segment is `PhaseAware<T>`: pass a single value to apply to all phases, or `{ started, completed, error }` to vary per phase.

```ts
interface ToolDisplayEntry {
  inline?: {
    hidden?: PhaseAware<boolean>;
    icon?: PhaseAware<IconName>;        // any lucide-react export name
    prefix?: PhaseAware<string>;        // "Getting" / "Got" / "Failed to get"
    name?: PhaseAware<string>;          // default: titleCase(toolName); pass '' to suppress
    suffix?: PhaseAware<string>;
    info?: PhaseAware<string | InfoSpec>;  // string shorthand = { path: string }
    color?: PhaseAware<ColorToken>;
    isMultiline?: boolean;              // wrap vs truncate the info segment
    spinIcon?: PhaseAware<boolean>;     // default: true on 'started' only
  };
  args?: {
    hidden?: PhaseAware<boolean>;
    displayType?: 'json' | 'key-value' | 'values-only';  // default 'json'
  };
  results?: {
    hidden?: PhaseAware<boolean>;
    displayType?: 'json' | 'key-value' | 'values-only' | 'custom';
    keysInfo?: KeyDisplay[];            // required when displayType === 'custom'
  };
  CustomComponent?: ComponentType<{ entry: ToolTimelineEntry; kind: 'server' | 'client' }>;
}

interface InfoSpec {
  path: string;                              // see "Path expressions" below
  transform?: TransformName | TransformName[];
  fallback?: string;                         // shown when path is nullish/empty
}

interface KeyDisplay {
  key: string;                               // dot path within the result object
  component: FieldComponentName;
  className?: string;                        // appended to component default classes
  transform?: TransformName | TransformName[] | null;
  fallback?: string;
}
```

## Path expressions

Used in `inline.info.path` and (with shallow-only resolution) in `keysInfo[].key`. Recognized roots for the inline path:

- `args.<key>...` — the model-supplied input
- `output.<key>...` (or `result.<key>...`, alias) — the tool's return payload
- `message` — error message string (only set in `error` phase)
- `toolName`, `callId` — for completeness; rarely useful

Numeric segments index into arrays: `output.items.0.title`. Misses are silent — render skips that segment.

## Transforms (current set)

In `registry-transforms.ts`. Add new ones there — same `(unknown) => unknown` contract, never throw.

| Name | Effect |
|---|---|
| `titleCase` / `snakeToTitle` / `kebabToTitle` | `clean_content_markdown` → `Clean Content Markdown` (aliases — same impl) |
| `textClean` | Strips markdown escapes (`\_`, `\*`, `` \` ``), trims whitespace |
| `truncate80` / `truncate200` | Truncate long strings with an ellipsis |
| `lowercase` / `uppercase` | Case conversion |

Chain by passing an array: `transform: ['textClean', 'truncate80']`.

## Field components (current set)

In `registry-components.tsx`. Each receives `{ value, className? }`.

| Name | Renders as |
|---|---|
| `BoldLabel` | `<div>` with bold 12px text |
| `TextDisplay` | Plain 12px `<div>` |
| `Markdown` | `<MarkdownView density="compact">` (full markdown w/ remark-gfm) |
| `Code` | Pre-formatted scrollable code block |
| `Json` | Pretty-printed JSON in a code block |
| `Image` | `<img>` (value must be a URL string) |
| `Badge` | Small pill — good for counts, statuses |

When adding a new component: keep it small, accept `unknown` for `value`, never throw.

## Result display modes

`results.displayType` controls how the (typically object) result is shown:

- **`'json'`** (default) — pretty-printed JSON in a `<pre>`. Same as today's default.
- **`'key-value'`** — two-column grid: bold key, value. One row per top-level key. Non-object payloads fall back to JSON.
- **`'values-only'`** — bulleted list of just the values. Loses keys. Useful when keys are noise.
- **`'custom'`** — iterate `keysInfo`; each entry `getByPath` → `applyTransforms` → render with `component`. Missing keys with no `fallback` are silently skipped + warned.

`args.displayType` supports the same modes minus `'custom'`.

## Icons + colors

**Icons**: any export name from `lucide-react`. Examples: `HandGrab`, `Database`, `Search`, `Globe`, `Cookie`, `Camera`, `MousePointerClick`, `Keyboard`, `FileText`, `Clipboard`. Unknown names log a warning and fall back to the phase default (`Loader2` / `CheckCircle2` / `AlertTriangle`).

**Colors**: pick a `ColorToken` — `blue`, `emerald`, `amber`, `red`, `violet`, `slate`, `primary`, `muted`. Resolves to a `text-{color}-600 dark:text-{color}-400` class. **Error phase always wins (forced red)** regardless of the override — keeps error visuals consistent across the app.

## The CustomComponent escape hatch

When the config isn't expressive enough — e.g. you want a chart, a comparison view, or per-tool interactive elements — pass a full React component:

```tsx
import type { ToolTimelineEntry } from '../ToolTimelineRow';

function MyTool({ entry, kind }: { entry: ToolTimelineEntry; kind: 'server' | 'client' }) {
  // entry.args, entry.output, entry.phase, entry.startedAt, etc.
  return <div className="rounded-md border bg-card/60 p-2">…your UI…</div>;
}

// in registry.tsx:
my_tool: { CustomComponent: MyTool }
```

When `CustomComponent` is set, `inline`/`args`/`results` config is **ignored** — your component owns the entire visual. If your component throws on render, `ToolDisplayBoundary` catches it and the row falls back to the default rendering (with a console warning).

You're responsible for the outer card / styling — match `kind === 'server'` vs `kind === 'client'` if you want surface consistency. See `ConfigurableToolRow` for examples of the existing card classes.

## Adding a new tool — checklist

```
- [ ] 1. Find the raw toolName. Trigger the tool once; the default row shows
       the snake_case name. (For server tools, ServerToolRow titleCases it,
       so use the catalog: types/tool-catalog.json or src/lib/tools/handlers/*.)

- [ ] 2. Decide the inline shape:
       - prefix (phase-aware verb: "Getting" / "Got" / "Failed to get")
       - icon (a lucide name that suggests the action)
       - color (one of the eight ColorTokens; error is always red)
       - info (the most identifying arg or result field, transformed for humans)

- [ ] 3. Decide the result shape:
       - Simple? Use 'key-value'.
       - Has a label + body? Use 'custom' with BoldLabel + Markdown/TextDisplay.
       - Already pretty as JSON? Leave default ('json').

- [ ] 4. Add the entry to toolDisplayRegistry in registry.tsx.

- [ ] 5. pnpm tsc --noEmit — confirm types check.

- [ ] 6. Reload the extension, trigger the tool, walk all three phases:
       - while running: prefix + icon + spinning + info text correct
       - after success: prefix swap + icon swap + color correct
       - on error: prefix swap + red icon, no crash, message visible
       (Force an error by passing invalid args or breaking the network.)
```

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

## Verification

After every registry change:

1. **Typecheck**: `pnpm tsc --noEmit` (must exit 0).
2. **Build**: `pnpm wxt build` (extension must build cleanly).
3. **Visual sweep**: open the side panel, trigger the tool, walk all three phases (`started` → `completed` → `error`). Compare against an unregistered tool to confirm the default still works for everything else.
4. **Console check**: open DevTools console while triggering. Any `[tool-display] ...` warning means a path/transform/icon is wrong — silent in the UI but logged.
5. **Catalog regen** (only if you changed tool handlers, not just display): `pnpm catalog:tools:md` and commit. Display registry edits do NOT need catalog regen.

## Anti-patterns

- ❌ Modifying `DefaultToolTimelineRow` / `DefaultServerToolRow`. The defaults are the safety net — touch them and every fallback inherits your bug.
- ❌ Adding error UI in the configurable renderer. Failures should be silent + logged. The user should never see "config error" — they should see the default rendering.
- ❌ Putting tool-specific logic inside `helpers.ts` or `ConfigurableToolRow.tsx`. That's what the registry config + `CustomComponent` are for.
- ❌ Using the `result.` alias in `keysInfo[].key`. `keysInfo` paths are scoped to the result object already — just use `label` (or `nested.field`), not `result.label`.
- ❌ Registering a tool name that doesn't exist. The dispatcher silently falls through to the default; you'll think your config doesn't work when really the tool never ran.
- ❌ Importing from outside `src/features/chat/tool-display/` into the registry maps. Registry files should be a flat description of behavior — pull in shared UI through `registry-components.tsx` instead.

## Reference: the `ctx_get` worked example

Currently the only registered tool. It's the canonical example for the four core capabilities:

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
