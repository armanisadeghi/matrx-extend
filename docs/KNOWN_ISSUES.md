# Known Issues / Follow-ups

Living list of known problems and unaddressed weaknesses to triage. Keep entries
short and actionable; delete an entry when it's fixed (git history keeps the record).

> Code-level weaknesses from the full-repo audit are in
> [AUDIT_2026_06_10.md](./AUDIT_2026_06_10.md). This file is for items noticed
> outside that audit (e.g. during doc cleanup) plus standing backlog.

---

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
