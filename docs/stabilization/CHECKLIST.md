# Stabilization checklist (derived)

> Updated 2026-09-27T03:06:11Z. The last observed local development artifact is 0.2.83 tree `8d1e7e426d679b1efdcebf6376c077d1317aff99fe6e223b64689b6809b46ed8`; run 003 is bound to it. A later lockfile-only merge has not been installed or rebuilt, and native acceptance remains unverified. `inventory.json` and defect records remain authoritative.

## Coverage

- [x] Inventory contains 205 features and 693 cases.
- [ ] Case coverage remains incomplete: 1142 mode-specific slots, including 1 not-applicable result; 53 recorded pass, 76 explicit unverified, and 1012 slots without a result record (unverified coverage).
- [ ] Acceptance: no 0.2.83 case pass is recorded. Runs 002 and 003 bind to the last observed `.83` tree `8d1e7e426d679b1efdcebf6376c077d1317aff99fe6e223b64689b6809b46ed8`, before the latest lockfile-only merge. Run 002 found an empty first page. Run 003 found one eligible public Source in the originally selected workspace, but positive recognition (`stage_not_observed`) and workspace enumeration remain unverified; fixture-page guard installation was observed, successful navigation was not established. Run 004 was refused before child launch. The merged lockfile has not been installed/rebuilt/retested. These results establish neither positive acceptance nor product failure.
- [ ] The four explicit 0.2.79 Debug passes (EXT-F-1005-T14/T15/T17/T22) remain historical, not 0.2.83 retests.

## Defects

- [x] 22 defects are explicitly closed.
- [ ] EXT-D-0022 is `fixed` and awaiting retest; it is not closed. No other defect is currently open, in-fix, or fixed-awaiting-retest.

### EXT-D-0022 - native retest pending

Independent state audit `reports/d22-state-audit.json` supports recording the engineering repair as fixed after the scoped-query, stale-result, actor-boundary, queue-order, and refusal repairs and their focused green receipts. Discovery peer `reports/d22-discovery-final-peer.json` accepted the bounded source repair; diagnostic peer `4a3ad173` accepted scoped discovery/cleanup diagnostics. Run 003 found one eligible fixture in the originally selected workspace but could not establish workspace enumeration or positive recognition. Keep `ui_retest` pending and do not mark EXT-F-1007-T26 passed.

**Next:** Run 005 is pending a healthy resource preflight and root admission. Run 004 and its recovery check were refused at pressure level 2; no browser lease is authorized now. Use the existing receipt-bound `.83` artifact only when root admits a run; use actual existing Sources, keep URLs/IDs private, and send no Save input. Both refusals are infrastructure evidence, not product results.

**Still unverified:** actual positive Source/Open identity agreement across workspaces, stale-response rejection, service-failure/recovery, and late in-flight Save. The read-only runner cannot prove late Save. Preserve the reserved Save checkpoint exactly; do not read, advance, reset, reinitialize, retry, capture, or Save.

## Status definitions

`pass` is the inventory's recorded case result with its original evidence and build boundary; it is not a current-build pass by default. An explicit `unverified` result and an applicable slot with no result object are both pending coverage. Defect `fixed` means engineering work is present and retest remains; only an explicit `closed` defect record is closed.
