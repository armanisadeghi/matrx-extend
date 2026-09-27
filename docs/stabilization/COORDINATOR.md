# Matrx Extend stabilization: resume here

Checkpoint: 2026-09-27. Goal remains active and incomplete. This goal turn made verified progress: repaired the actual D26 admin navigation regression, independently retested it in native Chrome, repaired D29 persisted-role failures with remaining native gaps tracked, and closed D28 harness portability. Do not infer whole-feature health from these repairs.

## Source and runtime

Code commits: D26 5224d583; D29 c9abb17e, typing correction0b1ef207, internal cleanup registration110809f3. Concurrent main releases .91/.92 were merged without losing work. Another contributor fixed the same registry issue in32a6b944; merge31204376 reconciles both into the specific writeAuthRoleGate entry, preserving the shared intent. The targeted destructive-operation guard passed4/4. Final integrated CI still needs its current-head result checked; earlier CI failures were corrected, not ignored.

Latest verified development artifact is .92: `test-results/source-dev-build-092-d26-d29-20260927.json`, tree `48b73b141ed7fe48cd4aac145ed518bb3b732891d1b31946fbc7a7f87b4b572c`, application sourcec9abb17e. Native run used HEAD0b1ef207 (test typing only). The later function-name/registry correction has no runtime semantic change but is not in this artifact. Keep that distinction in build provenance. This is local unpacked verification, not a claim of a Store release or primary-profile installation.

## Accepted findings and remaining work

Inventory is authoritative:205 features,1297 controls,702 cases. The added auth T39 explicitly tracks cross-context writes and simultaneous storage failure. Broad native visibility and exhaustive guest/member/admin coverage remain incomplete.

- D26 CLOSED: native run `runs/d26-d29-native092.json` captured all21 admin tabs at the first sample,33ms after actual Settings role readiness, with all readiness flags true and no alert. It required no settling delay and retained21 after navigation.37 surrounding targets passed; Capture remained partial. Fresh peer `reports/auth-integration-peer.json` verified actual hashes and the strict oracle. Full F1001T03 remains unverified for reload and role-transition dimensions.
- D29 FIXED AWAITING RETEST: canonical revalidation now clears the persisted admin bit; queued writes check current generation; Safari failure revalidates an earlier session; a rejected false write falls back to removing only the cache key.24 targeted tests passed after demonstrated failures and independent source review passed. Native normal admin sign-in passed, but native error/role-transition paths are unverified. Both storage operations failing can leave stale true readable; separate realms do not share the queue. These limits are explicitly tracked in F1015T39, not certified as safe. Continue this work before declaring authentication healthy.
- D28 CLOSED: portable harness assertion passed independent runs from the relocated checkout and another working directory; commit189d6880. No product coverage promotion.
- D27 CLOSED: native .90 Copy feedback, exact filtered clipboard/download, observation permission recovery and restoration passed independent review. Broader Debug T16/T18 remain incomplete.
- D25 CLOSED: host-wide resource lease contention fixed and independently retested; broader infrastructure cases remain unverified.
- D22 FIXED AWAITING RETEST: positive Source recognition remains unverified. Reserved `d22-source-save-attempt.json` is immutable: never read/recover through it, reset, advance, delete, reinitialize, retry, or click Save.
- D24 OPEN: Pilot follows user tabs and loses context. Preserve the user report; defer systematic Chat/Pilot until contained surfaces are healthy unless globally blocking.

## Next actions

Check final integrated CI and reconcile any new origin/main changes. Continue D29 native failure-path verification and its explicit storage/cross-context gaps, then expand contained Settings/SEO/Screenshot coverage. Primary Chrome channel switch and ordinary-member test access remain unresolved. Do not spend another cycle rebuilding process scaffolding. Existing prepared native runners and inventory cases are the starting point.

All implementation, UI execution and peer lanes for this checkpoint are expected to be terminal; verify actual collaboration/process status before dispatch. No heavy job should remain after the accepted native/guard runs. Use Luna medium for narrow execution, Sol medium for code, a fresh peer before acceptance, and objective escalation thresholds in TAKEOVER-PLAN.md. Root owns exact-path integration and frequent pushes.

## Runtime and resource requirements

Every browser runner requires `MATRX_PLAYWRIGHT_MODULE=/Users/armanisadeghi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`, `MATRX_CHROME_PATH=/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, `TMPDIR=/Volumes/Samsung2TB/code/.stabilization-scratch`, and its explicit current development receipt variable. Quote paths. Use `scripts/stabilization-resource.mjs run` and allowlisted commands with external profile directory; one heavy lease, at most one lightweight worker alongside it. No bypass/threshold reduction/foreign process cleanup. Guard cleanup is authoritative; do not run redundant preflight after clean owned termination.

Primary Chrome installation switch remains unverified: prior primary-profile preflight refused13.46GiB free against20GiB floor; no primary installation mutation. Disposable native Chrome-for-Testing dev profiles are the tested alternative. Guest and real admin sign-in work; ordinary member access remains unresolved. Retrieve credentials at point of use; never print or commit credentials, clipboard contents, private auth URLs or vault values.

Shared main only, exact-path commits, fetch/merge before push, preserve concurrent changes. Local tests/source review are not UI evidence. Existing hourly repository sync is not a QA daemon; no new schedule has been created. Long-lived historical detail is in HANDOFF.md, TAKEOVER-PLAN.md, inventory, defects, runs, reports and Git history. This file replaces stale repeated checkpoint text rather than redefining historical results.
