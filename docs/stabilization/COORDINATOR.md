# Matrx Extend stabilization: resume here

Updated after D22 native run 011 and guarded Debug export run 002. Campaign incomplete; `inventory.json` is coverage authority (205 features, 693 cases).
Read [the stabilization handoff](HANDOFF.md) for the plain-English done/pending map, evidence limits, and guarded restart example; this checkpoint and the inventory/defects remain the current status authority.

## Active takeover — 2026-09-27

User approved TAKEOVER-PLAN.md and requested an ongoing testing/fix/integration loop. Goal is active in this chat. Non-Chat/Pilot first remains binding. Pilot follows the user's tab and loses context: EXT-D-0024 is open/untriaged user evidence, linked to EXT-F-2014-T05; no current reproduction claimed.

Current source includes remote 0.2.89 (b83088c4), verified resource repair 4083a889, and reviewed census/Settings development runners through 76a879cb, pushed. CI passed at 76a879cb and 13413ca0. The .89 development build passed with receipt test-results/source-dev-build-089-takeover-20260927.json and tree 78a508aee8e6dc1fab6bb452d3af5e1342a55917a8d4936266f1acc6d657fcd2. EXT-D-0025 is independently retested and closed; only the contention case is promoted, not the whole infrastructure feature.

Primary-profile preflight refused at 13.46 GiB free against unchanged 20 GiB threshold. No primary Chrome installation mutation occurred. External disposable guest census run takeover-visible-census-089-002 succeeded: native ID cihdmkcdjjckfhjpgoedmgfpoljebaml, version0.2.89, five expected guest navigation tabs, eleven known Settings section labels and fourteen known control labels. Five additional visible aria-expanded buttons are unclassified elements, not proven extra section headings; their mapping remains a census gap; no behavioral health inferred. First attempt failed setup because runtime paths were omitted; the corrected run succeeded with explicit bundled runtime. Scope gate opens only the four prepared Settings guest cases T22/T37/T46/T70, all other mode/surface gaps remain tracked.

Every browser command must provide MATRX_PLAYWRIGHT_MODULE=/Users/armanisadeghi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs and MATRX_CHROME_PATH=/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing, plus TMPDIR=/Volumes/Samsung2TB/code/.stabilization-scratch and its runner-specific current receipt variable. Quote the Chrome path; never rely on absent repo Playwright. Preserve Source Save checkpoint untouched.

Source census independently reviewed: 205 features, 1297 controls, 701 cases. inventory.json remains authoritative, source gate peer-reviewed with native visibility pending. All 72 changed src paths mapped; generated stream-events contracts explicitly accounted in deferred Chat/Pilot coverage. Live DB census has 82 active bound names, all inventoried, distinct from 169 local catalog rows. Do not treat source counts as passes.

Active lanes (flat; no child delegation):
- /root/debug_setup_diagnosis — Sol medium, lightweight diagnosis of actual clipboard test prerequisite and console-mirroring evidence after Debug run succeeded; no new browser launch authorized.
- /root/settings_089_result_peer — Luna medium, independent evidence review of partial Debug result; no launches.

Guest Settings run independently accepted within scope: T22/T37/T46 current .89 pass; T70 stays unverified for five unobserved branches. Deep clean pass covers its coming-soon preference only. Guard exit attested by worker; result and build hashes independently verified. Debug run debug-export-dev089-001 opened successfully and exited0: T16 exact 802-byte download supported but Copy unverified, T18 verbose persistence/pause/restoration supported but console mirror unverified. No full Debug pass or product defect established. No heavy job currently running.

Completed lanes include inventory census/review, resource implementation and two independent review slices, Debug diagnostics and independent review, native runner implementation. Root owns inventory, defect IDs, integration/pushes. At most one lightweight worker alongside the sole heavy run. Formatter-edited reports must be included in the actual commit before pushing.

Review queue lookup through the verified canonical project returned no repair feedback or campaign rows. Existing hourly sync automation is ACTIVE on its own chat; it is synchronization only, not a QA worker. Next: finish native visibility census then narrow Luna Settings/navigation controls; diagnose Debug setup before retry. Preserve Source/SEO checkpoints. Pilot remains wave D. Frontend's current folder name is ai-matrx (translate old matrx-frontend paths).

## Earlier handoff context (superseded build status; D22 constraints remain active)

- **Source/build:** The frozen lockfile at source HEAD `36fa88fb` was installed; `pnpm compile` and `pnpm exec wxt build --mode development` passed under separate guards. Its local `.85` artifact is tree `f35f13418d84d75e49819ca3a6be044a4fd01303d34e3db450f364780d05f8ff`, receipt `test-results/source-dev-build-085.json`. Later incoming lockfile changes are merged but not installed, compiled, or rebuilt; the old artifact does not represent the current merged lockfile. Focused regressions passed 62 tests with 1 explicit cross-client parity skip (`777e7948`). This is not browser acceptance or a release; the historical locally verified release receipt is 0.2.79. Incoming release commit `4767ed43` now sets source version 0.2.86; that version has not been locally built or tested in this campaign.
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
