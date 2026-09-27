# Matrx Extend stabilization: resume here

Updated after D22 native run 011 and guarded Debug export run 002. Campaign incomplete; `inventory.json` is coverage authority (205 features, 693 cases).

## Current truth and next actions

- **Source/build:** The frozen lockfile at source HEAD `36fa88fb` was installed; `pnpm compile` and `pnpm exec wxt build --mode development` passed under separate guards. Its local `.85` artifact is tree `f35f13418d84d75e49819ca3a6be044a4fd01303d34e3db450f364780d05f8ff`, receipt `test-results/source-dev-build-085.json`. Later incoming lockfile changes are merged but not installed, compiled, or rebuilt; the old artifact does not represent the current merged lockfile. Focused regressions passed 62 tests with 1 explicit cross-client parity skip (`777e7948`). This is not browser acceptance or a release; latest published release remains 0.2.79.
- **D22 state:** Independent audit `7cb1ec35` supports `fixed` awaiting retest, never closed. Run 011 on `.85` enumerated 98 accessible picker choices and completed 98 organization-scoped HTTP 200 list reads. Seven public-eligible page candidates yielded one HTTP 500, five HTTP 404, and one redirect rejected by the runner's exact-URL rule. No candidate met the runner's healthy-fixture predicate; positive recognition was not reached. The bounded evidence is independently checked in `reports/d22-readonly011-peer.json`. Keep defect counts at 22 closed/1 fixed-awaiting-retest and do not promote EXT-F-1007-T26.
- **Next D22 step:** Audit whether the redirected candidate is equivalent under the app's canonical URL handling before another guarded read-only fixture search. The `.85` receipt remains a local development artifact; no browser may launch without root resource admission. Keep the reserved `d22-source-save-attempt.json` immutable; never read/recover through the default path, advance, reset, delete, reinitialize, retry, or click Save.
- **Debug export/verbose:** Run 001's partial result is excluded from accepted coverage because the runner was not the guard's owned child. Proper guarded run 002 exited unverified at `debug_open` before T16/T18 observations, with a generic error category. Diagnose the actual opening failure through safe evidence before another guarded attempt; neither run promotes inventory cases.
- **Remaining evidence:** Positive Source/Open identity across workspaces, workspace-change stale-state behavior, late response rejection, service-failure/recovery, successful fixture navigation, and late in-flight Save remain unverified. The 98-choice picker enumeration in run 011 is bounded evidence, not positive recognition. The focused unit run does not promote inventory coverage. Chat/Pilot remain last; do not claim full health or a Store upload.

## Operating constraints

- Shared `main` is the only sync point. No branches, worktrees, resets, force-pushes, or worker pushes/amends; use exact-path local commits and let root integrate. Never publish red.
- At most one guarded heavy command or browser lease at a time. Root controls admission. Keep existing resource thresholds; a refusal is infrastructure evidence, not product failure. Do not kill another contributor's process.
- Keep receipts free of secrets, tokens, Vault values, and raw auth URLs. Use real credentials only at point of use and owned disposable profiles; retain guest/member/admin applicability.
- Preserve the reserved D22 Source attempt exactly. Do not use the default recovery or any write/e2e runner as a substitute for the reviewed read-only path.
- Complete contained surfaces before systematic Chat/Pilot work. Source review and unit tests are not native UI proof; bind accepted outcomes to the exact build/tree and retain unresolved criteria as unverified.

## Durable coordination pointers

- Existing hourly repository-sync automation is already active; do not duplicate it. Shared sync may publish local commits, so never commit intentionally red intermediate work.
- Long-lived evidence belongs in `runs/`, `reports/`, and `inventory.json`; this file is the compact current checkpoint. Never rewrite historical receipts to match a new tree.
- Ordinary-member credential access and cross-repo coverage remain open. Continue to defer systematic Chat/Pilot until contained surfaces are complete.

## Evidence pointers

- Inventory/checklist: `inventory.json`, `CHECKLIST.md`, `reports/current-checklist-summary.json`.
- D22 state/fixture assessment: `defects/EXT-D-0022.json`, `reports/d22-state-audit.json`, `reports/d22-next-closure-path.json`.
- Native attempts: `runs/d22-recognition-readonly-011.json` (98 observed workspaces, seven candidates, no exact-URL healthy fixture; unverified) and prior `runs/d22-recognition-readonly-002.json` through `runs/d22-recognition-readonly-010.json`. `.85` baseline and focused regression: `runs/baseline-main085.json`, `runs/source-main085-regression-001.json`. Discovery source review: `reports/d22-discovery-final-peer.json`; run 011 evidence peer: `reports/d22-readonly011-peer.json`.
- Debug export attempts: `runs/debug-export-dev085-001.json` (manual guard mismatch; excluded) and `runs/debug-export-dev085-002.json` (proper guard; `debug_open` unverified). Incoming source review: `reports/incoming-file-source-d22-impact.json`.
