# Research scrape-queue management — filter / search / sort / batch + new statuses

**Date:** 2026-06-18 · **Status:** extension shipped; aidream + matrx-frontend
changes authored, **need deploy** (see below). Operator visual verification:
docs/feature-tests.md → "Scrape queue — *".

The Tasks tab (Scrape queue) held hundreds of sources across many research
projects, grouped only by capture level, with no way to focus on one project or
act in bulk. This adds focus + bulk + two honest "make it go away" verdicts.

---

## What shipped (extension)

- **Toolbar** ([QueueToolbar.tsx](../src/features/tasks/QueueToolbar.tsx)) — a
  project filter, free-text search (url / title / project / domain), sort
  (project / domain / recency / chars / attempts / status), a **group-by toggle
  (capture level ↔ project)**, and a "Filters" popover (domain · status · policy
  category · capture level). All persisted across reopens
  ([scrape-queue-view store](../src/state/scrape-queue-view.ts), chrome.storage)
  so you stay on your current project until you change it.
- **Multi-select + batch** ([QueueSelectionBar.tsx](../src/features/tasks/QueueSelectionBar.tsx)) —
  a checkbox per row, a select-all-in-group checkbox on each section header, and
  a "select all filtered" action. With a selection: **bulk Capture** (auto-
  capturable buckets) and **bulk Resolve** (any verdict). Gmail/Linear pattern.
  Typical flow: filter to a finished project → select all → Resolve → Ignore.
- **Two new honest verdicts/statuses** (shared catalog
  [verdicts.tsx](../src/features/tasks/verdicts.tsx)):
  - **`ignored`** — "not interested, stop surfacing it." Not dead, not gated —
    just not wanted.
  - **`content_mismatch`** — "the page loaded but isn't what it claimed"
    (redirect / changed page / wrong content). **Not** a 404.
  Both are **terminal** (leave every queue) and available per-row *and* in bulk.
- **Pure view logic** ([queue-view.ts](../src/features/tasks/queue-view.ts)) —
  flatten / facet / filter / sort / group, unit-tested
  (tests/unit/queue-view.test.ts).

Bulk apply prefers the atomic server endpoint and **falls back to a
concurrency-capped per-source loop** over the live `/verdict` endpoint until the
bulk endpoint deploys, so the feature works today (`applyVerdictBulk` in
[research.ts](../src/lib/api/routes/research.ts)).

---

## Cross-team status contract (the new statuses)

`scrape_status` is a code-only enum (no DB CHECK constraint) shared by three
repos on one DB. Adding `ignored` + `content_mismatch` is a coordinated **code**
change — **no migration**. All three are authored; the two server-side ones need
deploy:

| Repo | Change | Deploy |
|---|---|---|
| **matrx-extend** | `ScrapeStatusSchema` + `UserVerdict` + verdict catalog + bulk client + queue UI | ✅ shipped |
| **aidream** | `ScrapeStatus` + `UserVerdict` Literals; `_VERDICT_TO_STATUS` (`ignored`→`ignored`, `content_mismatch`→`content_mismatch`); `_TERMINAL_STATUSES` (so they drop from the queue); **new bulk endpoint** `POST /research/extension/sources/verdict_bulk` (`apply_user_verdict_bulk`) | ⏳ **needs backend deploy** |
| **matrx-frontend** | `ScrapeStatus` type + `SCRAPE_STATUS_CONFIG` (label/colors) in `features/research/` so the web research UI renders the new statuses | ⏳ **needs Vercel deploy** |

Until the **bulk endpoint** deploys, batch resolve uses the per-source fallback
(works, just N requests). Until the **frontend** deploys, an `ignored` /
`content_mismatch` source shows with a default muted badge in the web UI (the
config entry upgrades it to a proper label/color). Neither blocks the extension.

### Why a server endpoint, not direct Supabase

`rs_source` has **no RLS policy** permitting user writes, so the extension's anon
key can't write `scrape_status` directly — research writes go through the
FastAPI endpoint (elevated auth). The bulk endpoint also keeps the verdict state
machine (status mapping + `next_level` re-derivation) as one server-side source
of truth instead of duplicating it in the client.

---

## Deploy steps (operator)

1. **aidream** — deploy the backend (the enum + `_TERMINAL_STATUSES` +
   `apply_user_verdict_bulk` + the `/research/extension/sources/verdict_bulk`
   route are in `research/models.py`, `research/multisource.py`,
   `aidream/api/routers/research.py`). No migration. After deploy, the extension
   auto-uses the atomic bulk endpoint.
2. **matrx-frontend** — deploy (the `ScrapeStatus` type + `SCRAPE_STATUS_CONFIG`
   entries in `features/research/`). No migration.
3. Nothing to run on the DB — `scrape_status` has no constraint.
