# Demo System — design notes & known limitations

> Status: shipped 2026-05-05 (recorder + replayer + 5 agent tools).
> See [proposed-tools-and-features.md](./proposed-tools-and-features.md) item #1
> for the broader rationale.

## Why this approach

The user demonstrates a workflow once; the agent replays it on demand
with parameter substitution. The replay engine stays useful even when
the page changes underneath because every step records a **chain** of
selector strategies (matrx-ref → id → testid → ARIA → text → CSS path);
replay walks the chain top-to-bottom and stops at the first one that
finds a single visible element.

This is the canonical implementation of "self-healing selectors +
deterministic replay" from the harness roadmap (item 5 in CLAUDE.md).

## Key files

| File | Responsibility |
|---|---|
| `src/lib/demos/types.ts` | All shared types — Demo, DemoStep, SelectorStrategy, RecordingState, ReplayResult |
| `src/lib/demos/storage.ts` | chrome.storage.local persistence (split: list + per-demo) |
| `src/lib/demos/selector.ts` | Build & resolve selector chains. Used in extension context. |
| `src/lib/demos/event-capture.ts` | The function injected into pages during recording. **Self-contained** — duplicates selector-chain logic inline because it crosses the chrome.scripting boundary. |
| `src/lib/demos/recorder.ts` | SW-side per-recording state, capture-fn injection on navigation, event coalescing |
| `src/lib/demos/replayer.ts` | Runs steps in order against a tab; per-step selector resolution + action dispatch |
| `src/lib/tools/handlers/demos.ts` | The 5 agent tools |

## Architectural choices

### Capture-function injection (not a globally-registered content script)

We inject the recorder via `chrome.scripting.executeScript({func, args})`
on the recorded tab whenever it navigates. Pros:

- Recording is naturally scoped to one tab — no global content-script
  registration to manage
- Existing `data-picker.content.ts` style with `registration: 'runtime'`
  also works but adds match-pattern bookkeeping
- Re-injection is cheap (one round-trip per navigation)

Cons:

- Fails on chrome:// pages, the Web Store, etc. (logged + skipped — the
  recording will just have a gap there)
- There's a brief window after `webNavigation.onCommitted` before the
  inline function is in place. In practice this is sub-100ms, so user
  events that early are rare. If this becomes a real issue, switch to
  `executeScript` with `world: 'MAIN'` or a content-script entry.

### Idempotent injection

The injected function checks `window.__matrx_demo_recorder_mounted`
before attaching listeners. This protects against the rare double-run
when both `executeScript` (initial) and `webNavigation.onCommitted`
fire close together.

### Event coalescing

- `type` / `select` / `check`: typing fires `input` continuously, then
  `blur` once at the end. We accumulate the last value during `input`
  and emit a single step on `blur`. The recorder also coalesces
  consecutive same-target same-kind events (so a typo + correction
  becomes one step with the final value).
- Initial-load `navigate`: re-injection fires the `navigate` event again
  on each capture mount. The recorder suppresses consecutive navigates
  with the same URL.

### Sensitive-field handling

Inputs with `type="password"` or `autocomplete="cc-*"` / `*password*` /
`*secret*` / `*token*` / `*auth*` are flagged `is_sensitive=true`. The
recorder:

1. Stores **empty** `input_text` (the literal value never lands in
   storage)
2. Auto-derives a `param_placeholder` from the field's accessible name
3. At save time, the stop handler ensures every `param_placeholder` has
   a matching parameter declaration

At replay, sensitive steps fail unless `params` carries the placeholder.
The agent's coaching prompt should be: *call ask_user_secret to collect
the value, then pass it via params*.

### Selector-chain ranking

The order matters. Most stable first:

1. **matrx-ref** — only useful while the page is mid-recording (refs
   are ephemeral). Captured anyway for consistency.
2. **id** — but ONLY when `isStableId()` returns true. We reject IDs
   that look auto-generated: framework prefixes (react-*, ember-*),
   long hex blobs, numeric-only, CSS-modules-style hashes.
3. **data-testid** / **data-test** / **data-cy** — explicit test
   markers; most robust modern indicator.
4. **name-attr** — for form inputs. Stable across sessions.
5. **aria** — role + accessible name. Survives layout/CSS changes
   that nuke selectors.
6. **text** — visible text + tag. Survives ARIA absence.
7. **css-path** — last resort, ancestral CSS path with `nth-of-type`,
   capped at 4 levels.

If you change this ranking, also update the inline copy in
`event-capture.ts` and `replayer.ts` (they have the resolution logic
duplicated for in-page use).

### Storage layout

```
chrome.storage.local
  matrx.demos.list          DemoSummary[]   (small index)
  matrx.demos.{demo_id}     Demo            (full step list)
```

Cheap `list_demos` (one JSON read). Big demos with hundreds of steps
don't bloat every read. Migration to Supabase is a follow-up — keep
the same shape and just swap the backend in `storage.ts`.

### Replay tier

`replay_demo` is **privileged** (always confirm), even though `record_demo`
is action-tier. Reason: replay re-executes arbitrary user-recorded
actions automatically — clicks, types, submits, navigations. A demo
named "monthly expense report" can absolutely send money or click a
"delete account" button if the recording captured one. Always require
explicit user approval per replay.

`dry_run: true` resolves selectors but skips all side-effecting actions.
Use it to verify a demo still works after a site has changed without
risking the action.

## Known limitations

- **Single recording at a time.** The SW state holds one
  `RecordingState`. Concurrent recordings on different tabs aren't
  supported. If we need this, key the state by tabId.
- **No visual UI yet.** Recording is started/stopped via agent tools
  (chat IS the UI). A side-panel "Record Demo" button + step list is
  on the roadmap but not blocking.
- **Cross-origin auth/cookies.** The recorder captures clicks +
  navigations across origins fine, but if the workflow depends on
  cookies that were set during recording, replay needs the same
  cookies. We don't snapshot cookies — that's a sensitive-data
  surface we'd want explicit consent for.
- **Iframes.** The injected function attaches to `document` in the
  top frame only. Events inside iframes are missed. CDP could fix this;
  see the CDP-based pattern in `record_gif` for inspiration.
- **Shadow DOM.** Click events on shadow-DOM-rooted elements bubble
  up via composedPath, but the snapshot's selector chain references
  the *closest light-DOM ancestor*, not the actual shadow target. For
  pages built on web components, replay may resolve to the wrong
  element. See proposed-tools-and-features.md item #11 for the planned
  `shadow_dom_resolve` fix.
- **No LLM-fallback recovery.** When all selector strategies miss,
  replay fails with a per-step report. A natural next step is to use
  the `element_snapshot` (visible text + ARIA + bounding rect) plus a
  fresh page snapshot to ask Gemini Nano "find the element that looks
  like THIS"; that lookup result becomes the resolved element. Not in
  the MVP because it requires good prompts and tight loops we haven't
  validated.

## Future work (in priority order)

1. **Side-panel UI**: a "Demos" tab listing saved demos with
   inline replay/edit/delete + a record button in the chat header.
2. **LLM-based selector recovery** (Gemini Nano + ai_check_availability).
3. **Cookie / localStorage scoping**: opt-in capture per recording.
4. **Iframe support** via per-frame injection.
5. **Cloud persistence** (Supabase): same shape, different backend.
6. **Edit a saved demo** without re-recording (delete a step, reorder,
   rename a parameter).

## What to do when this doc and the code disagree

The code wins. Update this doc — don't quietly change behavior.
