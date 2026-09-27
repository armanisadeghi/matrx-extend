# Stabilization checklist (derived)

> Updated after D22 run 011 and guarded Debug export run 002. The frozen lockfile install, compile, and development build passed on source HEAD `36fa88fb`; the `.85` local artifact tree is `f35f13418d84d75e49819ca3a6be044a4fd01303d34e3db450f364780d05f8ff`. Incoming lockfile changes landed afterward and have not been installed or rebuilt. Focused D22 regressions passed 62 tests with 1 explicit skip. Native acceptance remains unverified. `inventory.json` and defect records remain authoritative.

## Coverage

- [x] Inventory contains 205 features and 693 cases.
- [ ] Case coverage remains incomplete: 1142 mode-specific slots, including 1 not-applicable result; 53 recorded pass, 76 explicit unverified, and 1012 slots without a result record (unverified coverage).
- [ ] Acceptance: the 62 focused unit tests do not count as inventory case passes; no current `.85` D22 native case pass is recorded. Run 011 on `.85` enumerated 98 accessible picker choices and read 98 organization-scoped lists, each HTTP 200 and exhausted after one page. Seven public-eligible pages were probed: one HTTP 500, five HTTP 404, and one redirect did not satisfy the runner's exact-URL rule. The child exited unverified before positive recognition.
- [ ] The four explicit 0.2.79 Debug passes (EXT-F-1005-T14/T15/T17/T22) remain historical, not 0.2.85 retests.
- [ ] Debug export/verbose: run 001 used a separate runner outside the guard's owned child and is excluded from accepted coverage. Proper guarded run 002 exited unverified at `debug_open` before T16 or T18 case observations. Neither run promotes inventory coverage; diagnose the real opening error before another guarded attempt.

## Defects

- [x] 22 defects are explicitly closed.
- [ ] EXT-D-0022 is `fixed` and awaiting retest; it is not closed. No other defect is currently open, in-fix, or fixed-awaiting-retest.

### EXT-D-0022 - native retest pending

Independent state audit `reports/d22-state-audit.json` supports recording the engineering repair as fixed after the scoped-query, stale-result, actor-boundary, queue-order, and refusal repairs and their focused green receipts. Run 011 has independently checked hashes and bounded list/candidate counts (`reports/d22-readonly011-peer.json`), but found no candidate meeting the exact-URL healthy-fixture rule within its observed 98 accessible workspaces. The redirect may be benign URL normalization; it is not a global absence claim. Keep `ui_retest` pending and do not mark EXT-F-1007-T26 passed.

**Next:** Audit the redirect candidate against the app's canonical URL behavior, then seek a qualifying existing fixture through a bounded read-only retest on a receipt-bound build. Preserve the exact-URL Source identity and UI predicates unless independently justified. Keep URLs/IDs private and send no Save input.

**Build boundary:** Reinstall the newly merged lockfile, recheck types, and rebuild under resource guard before claiming a current merged-tree native result. The existing `.85` artifact and D22/Debug receipts remain valid evidence only for their earlier tree.

**Still unverified:** actual positive Source/Open identity agreement across workspaces, stale-response rejection, service-failure/recovery, and late in-flight Save. The read-only runner cannot prove late Save. Preserve the reserved Save checkpoint exactly; do not read, advance, reset, reinitialize, retry, capture, or Save.

## Status definitions

`pass` is the inventory's recorded case result with its original evidence and build boundary; it is not a current-build pass by default. An explicit `unverified` result and an applicable slot with no result object are both pending coverage. Defect `fixed` means engineering work is present and retest remains; only an explicit `closed` defect record is closed.
