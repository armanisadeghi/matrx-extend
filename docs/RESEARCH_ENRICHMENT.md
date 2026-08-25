# Research capture — extension-side local rules

> Cross-repo system-of-record: `/Users/armanisadeghi/code/common-docs/systems/knowledge/research/EXTENSION_CAPTURE_CONTRACT.md` — the capture ladder, the queue shape, every endpoint and payload, the verdict vocabulary, the enrichment goal catalog, and the topic-picker contract. Read it before changing anything below. Node truth: `/Users/armanisadeghi/code/common-docs/systems/knowledge/research/STATE.md`.

## Files

`src/features/tasks/` — `TasksView.tsx` (`captureAndSubmit`), `QueueToolbar.tsx`,
`QueueSelectionBar.tsx`, `queue-view.ts` (pure flatten/facet/filter/sort/group, unit-tested),
`verdicts.tsx` (the shared verdict/status catalog) · `src/lib/scrape/capture-media.ts`
(`getCapturePageData` — images + media + structured in ONE injection) ·
`src/lib/scrape/collectors.ts` · `src/lib/research/enrich.ts` + `enrich-types.ts` (the enrich
executor) · `src/lib/api/routes/research.ts` (`submitExtensionContent`, `applyVerdictBulk`) ·
`src/state/scrape-queue-view.ts` (chrome.storage-persisted view state) ·
`src/components/AddToProjectButton.tsx`.

## The rules

- **Do NOT add a scroll to Level-1 capture.** The ladder is deliberate: L1 = quick, L2 = scroll,
  L3 = user-gated. A thin L1 escalates to L2, which already scrolls to fire lazy loaders, and the
  server parser already reads `data-src`/`data-lazy`. Forcing a scroll into L1 fights the design.
- **Always send the REAL `capture_level`** you used. It defaults to 1 for old builds, and the
  queue's `attempted_levels` history — the thing that makes the capture loop structurally
  impossible — is only accurate if you do. `capture_level: 4` to `/extension-content` is a 400;
  paste uses the dedicated `/content` route.
- **Send the optional payload fields only when non-empty.** A media-less page POSTs the exact
  legacy `{html_content, capture_level}` body.
- **Never block the user with a modal demanding a verdict, never derive a verdict, and never
  surface a `blocked` verdict.** The user is on the page, so there is no bot block to declare.
  Verdicts are a convenience; the ladder works without them.
- **`scrape_status` is a code-only enum shared by three repos on one database — there is no CHECK
  constraint.** Adding a value is a coordinated code change across `matrx-extend`, `aidream` and
  `matrx-frontend`, with no migration. Never add one unilaterally.
- **Research writes go through the FastAPI endpoints, never Supabase directly** — `rs_source` has
  no RLS policy permitting user writes, so the anon key cannot write `scrape_status`. The server
  also owns the verdict state machine (status mapping + `next_level` re-derivation).
- **Bulk verdict prefers the atomic endpoint** (`POST /research/extension/sources/verdict_bulk`,
  live) and falls back to a concurrency-capped per-source loop.
- **`low_value` and `gated_login` items are listed, never auto-queued.** A `low_value` capture
  must never silently become an expensive scrape task.
- **Only the human operator can verify extension behaviour in a real browser.** Every capability
  keeps a manual checklist in [`feature-tests.md`](./feature-tests.md) ("Research capture — *",
  "Research queue — *", "Research enrich *", "Scrape queue — *").

The `enrich` executor is built and unit-tested; it activates the instant the server tags queue
items `task_kind: 'enrich'`. Capture-family goals post to `/extension-content`; `screenshot` /
`download` artifacts post to `/sources/upload`.
