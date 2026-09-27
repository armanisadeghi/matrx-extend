# Matrx Extend stabilization: resume here

Current priority (2026-09-27): finish Showcase detect → extract → save → reopen → repeat, per the latest owner request. See SHOWCASE-PLAN.md and inventory EXT-F-1012. Broad stabilization is incomplete. Prior resource refusals are historical; primary Chrome manual discovery was admitted and terminated cleanly. The goal tool retains its earlier blocked status, but current Showcase work is active.

Primary Chrome is verified unpacked .97 from repository .output/chrome-mv3-dev, extension ID cihdmkcdjjckfhjpgoedmgfpoljebaml, signed-in admin. Source is now .100, integrated at dcd57b09; the old installed build is baseline evidence only. D39 reproduced live: Doctor finds249 event cards but List Pattern receives no seed. Run showcase-live-discovery-001 records this and installation identity.

Active ownership: showcase_detect_audit (Sol medium) owns D39 Doctor/List Pattern/state and the sole heavy-test permit; dependency sync completed, prepare/focused regression underway. showcase_save_replay_audit (Sol medium) owns D40 preview/config integrity and other producer tabs/hooks; source-only until permit transfer. Root owns integration. No browser permit is active. Fresh development build/reload and independent live retests remain mandatory. After these fixes, address saved Network matching, missing-root behavior, route applicability, and actual saved output/replay across all supported methods. Preserve every historical unresolved defect below.

## Historical baseline (superseded environment and sequencing)

## Source and runtime

Shared main has merged remote release .95 (8ab844de) in bffe07be. Source test fixes: D33 safe runtime diagnostics25f81f14 plus declaratione8a393e5 (focused tests3/3, independent source peer, guarded compile passed); D34 canonical Files redirectd450c7a2; D35 stable driver84d63d0e (native controls003 passed). Two earlier focused D33 fixture attempts and one compile type failure were corrected and recorded, not discarded. Check latest integrated CI before next green claim.

Current development artifact .97: `test-results/source-dev-build-097-screenshots-20260927.json`, tree `aefca61f20fe24ba5cf172c7f9a4f4732bf9983cfe383269f37ab1eca4355820`, sourcec0c0ec34; receipt SHA `2c0a724dd7563a11214b94446155ab9fe532814fe6e47940d89be98f99c8c76c`. Build admitted and exited0, recorded `runs/screenshot-dev097-build-001.json`. Subsequent browser run `gallery-d38-dev097-001` refused before launch. .95/.96 receipts historical. Primary Chrome installation and Store verification remain unclaimed.

## Accepted findings and remaining work

Inventory is authoritative:205 features,1297 controls,702 cases. The added auth T39 explicitly tracks cross-context writes and simultaneous storage failure. Broad native visibility and exhaustive guest/member/admin coverage remain incomplete.

- D26 CLOSED: native run `runs/d26-d29-native092.json` captured all21 admin tabs at the first sample,33ms after actual Settings role readiness, with all readiness flags true and no alert. It required no settling delay and retained21 after navigation.37 surrounding targets passed; Capture remained partial. Fresh peer `reports/auth-integration-peer.json` verified actual hashes and the strict oracle. Full F1001T03 remains unverified for reload and role-transition dimensions.
- D29 CLOSED for the original persisted-role defect:24 targeted regressions and independent source review passed; native run `runs/auth-role-failure-dev093-001.json` then failed four exact real-account role reads, observed admin controls disappear and the worker gate become false, and restored the same account/admin gate with the actual product retry. F1015T35 remains partial because this does not certify all sign-in error dimensions. Native Safari, actual member/revocation and T39 simultaneous storage failure/cross-context races remain unverified; authentication as a whole is not healthy yet.
- D30 CLOSED: Screenshot runner dropped the development receipt before invoking its native harness. Fix2de0364c forwards actual development provenance; independent Sol source review passed. Native retry002 entered the owned development profile and all four guest/reload/sign-out subcases passed; full T09 remains partial for arbitrary direct/persisted state.
- D28 CLOSED: portable harness assertion passed independent runs from the relocated checkout and another working directory; commit189d6880. No product coverage promotion.
- D27 CLOSED: native .90 Copy feedback, exact filtered clipboard/download, observation permission recovery and restoration passed independent review. Broader Debug T16/T18 remain incomplete.
- D25 CLOSED: host-wide resource lease contention fixed and independently retested; broader infrastructure cases remain unverified.
- D22 FIXED AWAITING RETEST: positive Source recognition remains unverified. Reserved `d22-source-save-attempt.json` is immutable: never read/recover through it, reset, advance, delete, reinitialize, retry, or click Save.
- D24 OPEN: Pilot follows user tabs and loses context. Preserve the user report; defer systematic Chat/Pilot until contained surfaces are healthy unless globally blocking.

## Next actions

Next: resource admission must recover without policy changes or foreign process cleanup. Native targets remain gallery error/Refresh recovery and fullpage capture. After genuine resource recovery, validate current .97 artifact/receipt against source; rebuild only if source/runtime changed, then perform one guarded D38 gallery run. D38 commit46eaeecf changes gallery-failure/admin-readonly canonical predicates to exact displayed text; actual evaluator red/green + wrong-page rejection and independent source review passed. Runs gallery-d38-dev096-001/002/003 all stopped before browser launch for pressure and/or swap growth. `reports/resource-attribution-20260927.json` proves no owned live cleanup opportunity at audit time. Do not replay merely because a lock file is gone or a single healthy sample appears; full guard admission remains authoritative.

D37 CLOSED: .96 native `gallery-d37-dev096-001` emitted actionable initial_owned_empty_ui evidence: exactGET200 zero rows, active/selected/linked/empty/Refresh true, canonical=false. This exposed D38 and proves diagnostic repair, not feature health. Prior orgselection issue did not reproduce across these .96 gallery runs; keep historical uncertainty, no speculative extra waits.

D36 FIXED pending full-page native capture retest: in-page aspect metric replaces nullable CDP viewport, safe capture stages plus focused red/green/source peer pass. Latest fullpage003 (.95) stopped before capture at org selection. After gallery target, run fullpage with explicit .96 receipt when guard admits. Gallery-error and fullpage exact commands are allowlisted. Fresh .97 build is now available; validate it before the next native run. CI1980b9fe passed; check current integration CI.

D34 and D35 CLOSED after independent real .95 controls003 passed original targets and surrounding Copy/Cancel/Delete. D32/D33 remain closed. Refresh/Open/Copy/Cancel successes are warm-admin substeps only; reload, service errors, member and remaining guest dimensions stay unverified.

F1009T01/T02/T04/T06/T07 contain only verified warm-admin substeps, not whole-case passes. Warm-admin Copy/Cancel now pass; their failure/reload/member dimensions and full-page capture remain open. Historical .93/.94 first capture rows have unknown disposition because exact recovery identity was not retained; never delete by title/recency. Future owned fixtures should retain a private recovery identity before assertions so cleanup can be targeted after a failure; this is a follow-up, not implemented yet. Never reuse the reserved Source checkpoint.

All lanes are terminal; no guard/browser job remains. Heavy concurrency stays1.  Default Luna medium for narrow execution, Sol medium for implementation. Last Luna omitted required runtime env and was rerouted; always explicitly export and assert the exact paths in the same launch shell. Root owns integration. Primary channel switch and ordinary-member access remain unresolved, with other actionable guest/admin testing still available.

## Runtime and resource requirements

Every browser runner requires `MATRX_PLAYWRIGHT_MODULE=/Users/armanisadeghi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`, `MATRX_CHROME_PATH=/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, `TMPDIR=/Volumes/Samsung2TB/code/.stabilization-scratch`, and its explicit current development receipt variable. Quote paths. Use `scripts/stabilization-resource.mjs run` and allowlisted commands with external profile directory; one heavy lease, at most one lightweight worker alongside it. No bypass/threshold reduction/foreign process cleanup. Guard cleanup is authoritative; do not run redundant preflight after clean owned termination.

Primary Chrome installation switch remains unverified: latest read-only audit found12.03GiB free against20GiB floor and zero campaign-owned disposable profile cleanup candidates; no primary installation mutation. Disposable native Chrome-for-Testing dev profiles are the tested alternative. Guest and real admin sign-in work; ordinary member access remains unresolved. Retrieve credentials at point of use; never print or commit credentials, clipboard contents, private auth URLs or vault values.

Shared main only, exact-path commits, fetch/merge before push, preserve concurrent changes. Local tests/source review are not UI evidence. Existing hourly repository sync is not a QA daemon; no new schedule has been created. Long-lived historical detail is in HANDOFF.md, TAKEOVER-PLAN.md, inventory, defects, runs, reports and Git history. This file replaces stale repeated checkpoint text rather than redefining historical results.
