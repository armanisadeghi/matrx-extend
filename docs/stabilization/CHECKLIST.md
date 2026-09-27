# Stabilization checklist (derived)

> Updated 2026-09-27T04:22:58Z. The frozen lockfile install, compile, and development build passed on source HEAD `36fa88fb`; the `.85` local artifact tree is `f35f13418d84d75e49819ca3a6be044a4fd01303d34e3db450f364780d05f8ff`. Focused D22 regressions passed 62 tests with 1 explicit skip. Native acceptance remains unverified. `inventory.json` and defect records remain authoritative.

## Coverage

- [x] Inventory contains 205 features and 693 cases.
- [ ] Case coverage remains incomplete: 1142 mode-specific slots, including 1 not-applicable result; 53 recorded pass, 76 explicit unverified, and 1012 slots without a result record (unverified coverage).
- [ ] Acceptance: the 62 focused unit tests do not count as inventory case passes; no current `.85` native case pass is recorded. Run 005 on `.85` was refused before child launch, so it produced no browser result. The last child-started native run, 003 on `.83`, found one eligible Source in the originally selected workspace but left successful fixture navigation, positive recognition, and workspace enumeration unverified. Run 004 was also refused before child launch.
- [ ] The four explicit 0.2.79 Debug passes (EXT-F-1005-T14/T15/T17/T22) remain historical, not 0.2.85 retests.

## Defects

- [x] 22 defects are explicitly closed.
- [ ] EXT-D-0022 is `fixed` and awaiting retest; it is not closed. No other defect is currently open, in-fix, or fixed-awaiting-retest.

### EXT-D-0022 - native retest pending

Independent state audit `reports/d22-state-audit.json` supports recording the engineering repair as fixed after the scoped-query, stale-result, actor-boundary, queue-order, and refusal repairs and their focused green receipts. Discovery peer `reports/d22-discovery-final-peer.json` accepted the bounded source repair; diagnostic peer `4a3ad173` accepted scoped discovery/cleanup diagnostics. Run 003 found one eligible fixture in the originally selected workspace but could not establish workspace enumeration or positive recognition. Keep `ui_retest` pending and do not mark EXT-F-1007-T26 passed.

**Next:** Run 006 is pending healthy resource conditions and root admission. Use the fresh receipt-bound `.85` artifact only after admission; use actual existing Sources, keep URLs/IDs private, and send no Save input. Run 005 was refused at preflight and is infrastructure evidence, not a product result.

**Still unverified:** actual positive Source/Open identity agreement across workspaces, stale-response rejection, service-failure/recovery, and late in-flight Save. The read-only runner cannot prove late Save. Preserve the reserved Save checkpoint exactly; do not read, advance, reset, reinitialize, retry, capture, or Save.

## Status definitions

`pass` is the inventory's recorded case result with its original evidence and build boundary; it is not a current-build pass by default. An explicit `unverified` result and an applicable slot with no result object are both pending coverage. Defect `fixed` means engineering work is present and retest remains; only an explicit `closed` defect record is closed.
