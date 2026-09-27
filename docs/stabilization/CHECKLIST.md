# Stabilization checklist (derived)

> Generated 2026-09-27T02:33:03Z. Source version is 0.2.82; the current receipt-bound tree is `9066e69fc13f5c35bd9650aa2540288045a40331012620def87faef4405d9611`. This does not turn the latest unverified native attempt into a pass. `inventory.json` and defect records remain authoritative.

## Coverage

- [x] Inventory contains 205 features and 693 cases.
- [ ] Case coverage remains incomplete: 1142 applicable mode-specific slots; 53 recorded pass, 76 explicit unverified, 1 not applicable, and 1012 slots without a result record (unverified coverage).
- [ ] Current-tree acceptance: no current 0.2.82 case pass is recorded. The read-only native attempt on tree `9066e69fc13f5c35bd9650aa2540288045a40331012620def87faef4405d9611` exited 1 and is unverified at `discover_existing_public_source` (`no_existing_public_positive_fixture_in_visible_page`). No eligible existing public Source fixture was found; this is a fixture/evidence gap, not evidence of product failure.
- [ ] The four explicit 0.2.79 Debug passes (EXT-F-1005-T14/T15/T17/T22) remain historical, not 0.2.82 retests.

## Defects

- [x] 22 defects are explicitly closed.
- [ ] EXT-D-0022 is `fixed` and awaiting retest; it is not closed. No other defect is currently open, in-fix, or fixed-awaiting-retest.

### EXT-D-0022 - native retest pending

Independent state audit `reports/d22-state-audit.json` supports recording the engineering repair as fixed after the scoped-query, stale-result, actor-boundary, queue-order, and refusal repairs and their focused green receipts. The latest native attempt verified its `.82` tree but could not test positive recognition because no eligible existing public Source was found. Keep `ui_retest` pending and do not mark EXT-F-1007-T26 passed.

**Next:** obtain independent source review of the bounded multi-page fixture-discovery revision in `tests/browser/source-recognition-readonly-acceptance.mjs`. It must use actual existing Sources through the scoped list, constrain navigation to public read-only pages, and keep URLs/IDs private. Only after review and root admission may one guarded native run proceed.

**Still unverified:** actual positive Source/Open identity agreement across workspaces, stale-response rejection, service-failure/recovery, and late in-flight Save. The read-only runner cannot prove late Save. Preserve the reserved Save checkpoint exactly; do not read, advance, reset, reinitialize, retry, capture, or Save.

## Status definitions

`pass` is the inventory's recorded case result with its original evidence and build boundary; it is not a current-build pass by default. An explicit `unverified` result and an applicable slot with no result object are both pending coverage. Defect `fixed` means engineering work is present and retest remains; only an explicit `closed` defect record is closed.
