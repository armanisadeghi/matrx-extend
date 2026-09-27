# Matrx Extend stabilization: resume here

Current checkpoint: 2026-09-27. Goal active and incomplete. Previous goal turn made verified progress: EXT-D-0027 repaired, native .90 retest independently accepted, records pushed. No claim of full feature health.

## Source and runtime

Shared main now cf684f9a: D26 fix5224d583 plus concurrent version-only .92 release630e0f20 merged and pushed. Concurrent release 6886adde (.91) merged in26231182; changes were version/catalog timestamps plus generated CutoverFinalSwitchCopyAgainResultData, a deferred streaming contract. No application runtime implementation changed in that release. CI39b8ea8b and D28 commit189d6880 passed; current integration CI pending.

Latest verified local development artifact is .90, not .91: receipt `test-results/source-dev-build-090-takeover-20260927.json`, tree `23d12768a3a27ca3cd44c339bd833c68f5319ac44e5825d0b8329e4c1127edf3`, source91b610da. Guarded build and native Debug run passed; see `runs/dev090-refresh.json`, `runs/debug-export-dev090-001.json`, and its peer report. Package .92 plus auth changes currently require a fresh build before the next native run; defer rebuilding until pending app changes are ready to avoid duplicate work.

## Coverage and findings

Inventory is the sole coverage authority: 205 features, 1297 controls, 701 cases. Source census independently reviewed; broad native visibility and exhaustive mode coverage remain incomplete. Historical passes are build-scoped, not proof of current whole-system health.

- D27 closed after actual Copy feedback, exact filtered clipboard/download, owned-origin observation permission recovery and restoration passed independent review. This was a test-infrastructure fix; T16 warm passes, reload/service-error remain unverified. T18 remains partial.
- D26 fixed awaiting native retest (5224d583; independent source review and two-consumer regression pass). Original: first admin-ready roster was17/21 in .89 run001; run002 first sample already21/21 and stayed21 after navigation. The causal shared-auth fix now suppresses its own synchronous notification; native21-tab acceptance still pending. Original raw run001 was overwritten: sanitized receipt and original worker attestation survive, never reconstruct a raw artifact. Immutable run002: `test-results/contained-navigation-dev089-002.evidence.json`. Preserve strict21-tab oracle; role transitions/reload remain unverified.
- Guest Settings .89 T22/T37/T46 passed only their scoped criteria; T70 partial. Guest SEO run002 has16 passing subtargets and1 unverified subtarget, no full-case promotion. See inventory and reviewed run records.
- D25 resource contention fix independently retested and closed; not a full infrastructure feature pass.
- D22 fixed awaiting positive native retest. Reserved Source Save checkpoint `d22-source-save-attempt.json` is immutable: never read/recover through it, reset, advance, delete, reinitialize, retry, or click Save. Use no write runner as a substitute.
- D24 Pilot follows user tabs and loses context: user-reported, open, deferred until contained surfaces healthy; only globally blocking defects justify early intervention.

## Current routing

Implementation lane `/root/admin_navigation_repair` (Sol medium) now owns D29: persisted admin flag remains stale after failed/unverified role/session transitions. Separate shared-auth repair and guarded regressions are authorized; no browser/build yet. D28 harness portability is independently verified, closed and pushed189d6880. D26 is fixed awaiting native retest; D29 must clear independent review before combined fresh build. Root integrates, commits/pushes; fresh zero-authorship peers review before acceptance. No manager-only workers or worker pushes.

Thresholds remain TAKEOVER-PLAN.md: two ineffective attempts trigger decomposing/rerouting, rare Astra escalation; bounded tasks and one heavy test/build at a time. Next priority is contained product testing and D26, not expanding infrastructure. Routing records here are snapshots; query actual agent/process state before treating work as live.

## Runtime and resource requirements

Every browser runner requires `MATRX_PLAYWRIGHT_MODULE=/Users/armanisadeghi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`, `MATRX_CHROME_PATH=/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, `TMPDIR=/Volumes/Samsung2TB/code/.stabilization-scratch`, and its explicit current development receipt variable. Quote paths. Use `scripts/stabilization-resource.mjs run` and allowlisted commands with external profile directory; one heavy lease, at most one lightweight worker alongside it. No bypass/threshold reduction/foreign process cleanup. Guard cleanup is authoritative; do not run redundant preflight after clean owned termination.

Primary Chrome installation switch remains unverified: prior primary-profile preflight refused13.46GiB free against20GiB floor; no primary installation mutation. Disposable native Chrome-for-Testing dev profiles are the tested alternative. Guest and real admin sign-in work; ordinary member access remains unresolved. Retrieve credentials at point of use; never print or commit credentials, clipboard contents, private auth URLs or vault values.

Shared main only, exact-path commits, fetch/merge before push, preserve concurrent changes. Local tests/source review are not UI evidence. Existing hourly repository sync is not a QA daemon; no new schedule has been created. Long-lived historical detail is in HANDOFF.md, TAKEOVER-PLAN.md, inventory, defects, runs, reports and Git history. This file replaces stale repeated checkpoint text rather than redefining historical results.
