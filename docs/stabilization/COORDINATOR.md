# Matrx Extend stabilization: resume here

Checkpoint: 2026-09-27. Goal active and incomplete. Latest progress: D29 original persisted-role failure passed native fault/recovery and closed; D30 development-provenance setup repair passed native guest/reload/sign-out. Real Screenshot capture now reaches persisted image/preview but fails pixel verification and cleanup remains unresolved. No whole-feature health claim.

## Source and runtime

Code commits: D26 5224d583; D29 c9abb17e, typing correction0b1ef207, internal cleanup registration110809f3. Concurrent main releases .91/.92 were merged without losing work. Another contributor fixed the same registry issue in32a6b944; merge31204376 reconciles both into the specific writeAuthRoleGate entry, preserving the shared intent. The targeted destructive-operation guard passed4/4. Final integrated CI still needs its current-head result checked; earlier CI failures were corrected, not ignored.

Current verified development build is .94: `test-results/source-dev-build-094-capture-20260927.json`, tree `8b359ead9dd0b4db1d404a26cb6b2fbfc3e3c10d79956638a2ec587d4a395665`, source8fc02d90. Subsequent changes are test-only. Native .94 attempt001 captured the correct fixture but exposed two test defects: D31 samples overlapped text, D32 cleanup inspected dialog before render. Main8fc02d90 CI passed. Earlier .93 builds/runs are historical; never relabel them. Primary Chrome installation and Store verification remain unclaimed.

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

D31 pixel oracle corrected with a fixed text-free bottom strip and unchanged color tolerance (bc55f7bd). D32 cleanup waits for exact visible confirmation and enabled Delete (8ed23029,118bbfb1). Fresh peer capture094_retest_peer is authorized for exactly one guarded .94 retry002 after narrow source check; no build needed for test-only changes. Read its actual report before promoting any case. Historical .93/.94 attempt001 row disposition remains unknown and exact recovery identity was not retained: no deletion by title/recency, no reserved Source checkpoint reuse. F1009T02/T06/T07 stay unverified until actual evidence resolves their substeps, and broader error/reload/member controls remain open.

Use Luna medium for narrow execution and Sol medium for implementation. Sole heavy guard run at a time; only one lightweight worker alongside it. Current refresh/capture executor is terminal and lease released. capture094_retest_peer may be active for retry002; verify live state before launching anything else. No hidden browser run remains. Root owns exact-path integration and frequent pushes. Primary channel switch and ordinary-member access remain unresolved; keep progressing on actionable admin/guest contained controls.

## Runtime and resource requirements

Every browser runner requires `MATRX_PLAYWRIGHT_MODULE=/Users/armanisadeghi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`, `MATRX_CHROME_PATH=/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, `TMPDIR=/Volumes/Samsung2TB/code/.stabilization-scratch`, and its explicit current development receipt variable. Quote paths. Use `scripts/stabilization-resource.mjs run` and allowlisted commands with external profile directory; one heavy lease, at most one lightweight worker alongside it. No bypass/threshold reduction/foreign process cleanup. Guard cleanup is authoritative; do not run redundant preflight after clean owned termination.

Primary Chrome installation switch remains unverified: latest read-only audit found12.03GiB free against20GiB floor and zero campaign-owned disposable profile cleanup candidates; no primary installation mutation. Disposable native Chrome-for-Testing dev profiles are the tested alternative. Guest and real admin sign-in work; ordinary member access remains unresolved. Retrieve credentials at point of use; never print or commit credentials, clipboard contents, private auth URLs or vault values.

Shared main only, exact-path commits, fetch/merge before push, preserve concurrent changes. Local tests/source review are not UI evidence. Existing hourly repository sync is not a QA daemon; no new schedule has been created. Long-lived historical detail is in HANDOFF.md, TAKEOVER-PLAN.md, inventory, defects, runs, reports and Git history. This file replaces stale repeated checkpoint text rather than redefining historical results.
