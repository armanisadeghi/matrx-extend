# Matrx Extend stabilization: resume here

Updated 2026-09-27 02:21 UTC. Campaign incomplete; `inventory.json` is coverage authority (205 features, 693 cases).

## Current truth and next actions

Checklist `63547bf8` summarizes 23 defect records (22 closed, D22 still in-fix); case results are historical unless tied to the exact current build.

- **Source and release:** Merge `5593c486` is integrated and pushed in `ef03ecef`; source package remains 0.2.82. The latest published release is still 0.2.79. The prior .82 dev baseline predates the merged app/dependency delta and is stale for this tree. The 0.2.82 dev manifest was installed in the new isolated install (`90507`, exit 0 at 02:19:48.393 UTC), but that does not verify the merged tree's built artifact.
- **Only active heavy job:** root owns compile session `25943` (`baseline-source-merge-types-001`). No other build, browser, or heavy command may start until root confirms it ended. If compile passes, next is a fresh guarded development build from merged source, then a new local receipt with `scripts/record-local-dev-build.mjs`; independent receipt peer `7bde85c4` accepted the source mechanics, but no current receipt/runtime acceptance exists yet.
- **D22:** Keep `test-results/d22-source-save-attempt.json` reserved and immutable. Never read/recover through the default path, reset, delete, reinitialize, retry, or click Save. Read-only runner `7f1fdb5b` was rejected by peer `dde2796b` because saved-capture list rows expose `url`, not the point-lookup alias `canonical_identity`. Source-only repair `72de7258` now reads `row.url` for list discovery while retaining exact identity validation; this repair still needs fresh independent source review and runtime proof. Incoming filing impact review `418e8bb3` found no D22 rebreak, but called for focused regression gates. No native D22 run has occurred on the merged tree.
- **Next gates in order:** finish compile; build the integrated source under the existing guard; capture and independently verify the local `.82` receipt; obtain fresh independent review of the repaired read-only runner; only then, after root admission and healthy resources, run its no-write native scope. Track each result at its exact build/tree. Keep unknown positive fixtures, service-failure/recovery, late Save, and all unexercised acceptance criteria unverified.
- **Coverage and scope:** closed defects do not imply complete features. Preserve the checklist's 22-closed/1-D22-pending distinction and its case-level unverified coverage. Chat/Pilot remain last; no broad health, Store-upload, or current-build pass is established.

## Operating constraints

- Shared `main` is the only sync point. No branches, worktrees, resets, force-pushes, or worker pushes/amends; use exact-path local commits and let root integrate. Never publish red.
- At most one guarded heavy command or browser lease at a time. Root controls admission. Keep the existing resource thresholds; a refusal is infrastructure evidence, not product failure. Do not kill another contributor's process.
- Keep receipts free of secrets, tokens, Vault values, and raw auth URLs. Use real credentials only at point of use, owned disposable profiles, and explicit guest/member/admin applicability.
- Preserve the reserved D22 Source attempt exactly. Current D22 path is read-only; do not use the default recovery branch or any alternate write/e2e runner as a substitute.
- Complete contained surfaces before systematic Chat/Pilot work. A test or source review is not native UI proof; bind accepted outcomes to the exact build/tree and retain unresolved criteria as unverified.

## Durable coordination pointers

- Existing hourly repository-sync automation is already active; do not duplicate it. Shared sync may publish local commits, so never commit intentionally red intermediate work.
- Keep long-lived evidence in `runs/`, `reports/`, and `inventory.json`; this coordinator is only the compact current checkpoint. Do not rewrite historical receipts to match the new source build.
- Ordinary-member credential access and cross-repo coverage remain open. Continue to defer systematic Chat/Pilot until contained surfaces are complete.

## Evidence pointers

- Inventory/checklist: `inventory.json`, `CHECKLIST.md`, `reports/current-checklist-summary.json`.
- Merge impact: `reports/incoming-file-source-d22-impact.json`.
- Local build binding: `reports/current-dev-build-readiness.json`, `reports/local-dev-build-source-peer.json`, `scripts/record-local-dev-build.mjs`.
- D22: `reports/d22-next-closure-path.json`, `reports/d22-readonly-source-peer.json`, `reports/d22-readonly-scope-final-peer.json`, and the preserved checkpoint receipt under `test-results/`.
