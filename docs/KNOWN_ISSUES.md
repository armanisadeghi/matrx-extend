# Known Issues / Follow-ups

Living list of known problems and unaddressed weaknesses to triage. Keep entries
short and actionable; delete an entry when it's fixed (git history keeps the record).

> Code-level weaknesses from the full-repo audit are in
> [AUDIT_2026_06_10.md](./AUDIT_2026_06_10.md). This file is for items noticed
> outside that audit (e.g. during doc cleanup) plus standing backlog.

---

## Documentation / source-of-truth

- **`docs/SURFACE_INTEGRATION_TODO.md` inline SQL is pre-refactor.** The header warns
  that the `tl_*` table names moved (2026-05-27), but the SQL templates in §1–2 still
  use `tl_executor` / `tl_def_surface` / `source_app`. Rewrite the SQL to
  `tool_binding` / `tool_surface_defaults` before matrx-frontend or matrx-local
  consume it as an integration spec.

## Cloud sync

- **Guidance `demo_ref` bodies don't sync (TASK-004 follow-up).** `wbx_guidance`
  syncs guidance metadata across machines, but a `demo_ref` only carries the
  POINTER — the recorded demo itself lives local-only in `chrome.storage.local`
  (`matrx.demos.{id}`). On a fresh machine a synced `demo_ref` will list but
  `replay_demo` fails until demo bodies sync too. Next step: a `wbx_demo` table
  (or fold demos into guidance `data`) so demos travel with their refs.

## Research capture

- **The extension never sends `published_time` / `modified_time`.** The server's
  `_structured_dates` (`research/multisource.py`) documents the extension as its
  PRIMARY source for a source's publish/modify dates —
  "the extension already resolved OG `article:published_time` etc. into these" —
  and only falls back to JSON-LD `datePublished`/`dateModified`. It doesn't:
  `CollectedMetadata` (`src/lib/scrape/collectors.ts`) keeps only `property`
  values starting with `og:`, and `article:published_time` does not, so it is
  dropped before the payload is built. Every extension capture therefore takes
  the fallback path, and a page with OG article dates but no JSON-LD dates
  stores no dates at all. Fix: collect the `article:*` meta properties into
  `CollectedMetadata` and map them into `ExtensionStructuredPayload.metadata`.
  Found 2026-08-09 while verifying the capture-media overlay.

## Context bundle optimization (backlog)

From [context-bloat-findings.md](./context-bloat-findings.md), items #1–8 documented
but never shipped:

- Site chrome (nav/footer boilerplate) is re-shipped on every `read_page` — no
  content-hash cache to skip unchanged chrome.
- Element memoization not implemented (refs re-derived each read).
- Tool-naming confusion (#8) and cross-link descriptions deferred as breaking changes.
- The doc's open questions about small-model behavior were never re-tested — either
  collect the traces or drop the questions.

---

_Last reviewed: 2026-06-10 (doc-cleanup pass)._
