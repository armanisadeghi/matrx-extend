# Stabilization checklist (derived)

> Generated from `inventory.json`, `defects/*.json`, and the linked D22 closure-path assessment. Those records remain authoritative. Latest source checkpoint is 0.2.82; no current engineering artifact is verified here.

## Coverage status

- [x] Inventory records 205 features and 693 test cases.
- [ ] Case-level coverage is incomplete: 1,142 applicable mode-specific slots; 53 have a recorded pass, 76 are explicitly unverified, 1 is not applicable, and 1,012 have no result object and remain unverified.
- [ ] Current 0.2.82 engineering-build verification: not established by the inventory. Of the 53 recorded passes, 43 lack a linked build receipt; 10 are bound to earlier builds (0.2.56: 1, 0.2.57: 1, 0.2.63: 4, 0.2.79: 4).
- [ ] The four .79 Debug passes (EXT-F-1005-T14, T15, T17, T22) are historical and are not .82 retests.

## Known defects

- [x] 22 defect records explicitly say `closed` (defect scope only; related features may still have pending cases).
- [ ] EXT-D-0022 remains `in-fix` in its ledger. There are no defects currently in explicit `fixed` awaiting retest state.

### EXT-D-0022 — native recognition evidence incomplete

Priority P1 / severity S2 in the defect ledger. The latest bounded source/evidence assessment found no new production defect and says the existing organization-scope, stale-result, and queue-order repairs are present. The ledger remains `in-fix` until its remaining evidence is reconciled.

**Next:** after root admits a current build and resources are healthy, run the already-reviewed `SOURCE_READONLY_SCOPE=1` path. Preserve the reserved checkpoint exactly and send no Save input. This covers only the no-workspace/scoped-negative native subset; it is not full closure.

**Then:** independently review a checkpoint-independent read-only path using a pre-existing Source in an approved workspace. Prove the actual matching Open target, workspace switch invalidation/restoration, and stale lookup rejection using real UI and scoped read-only responses. If no qualifying existing Source is available, record that evidence gap; do not create one.

**Also pending:** inventory T26 requires actual scoped recognition service-failure and recovery proof. Late in-flight Save cannot be proved by this read-only route; keep that dimension unverified. Never reset, delete, reinitialize, advance, or retry the reserved checkpoint.

## Next checklist

- [ ] Root completes/admit current engineering build and resource guard; no browser action from this documentation lane.
- [ ] Run bounded reviewed read-only scope without Save and compare checkpoint hash before/after.
- [ ] Prepare/peer-review the positive existing-Source multi-workspace read-only case plus scoped service-failure/recovery case; no synthetic data or forged responses.
- [ ] Keep the full feature and any late-Save dimension unverified until their own exact criteria and authorized evidence are met.
- [ ] Record fresh .82-bound receipts for cases being retested; do not promote historical case passes to .82.

## Status definitions

`pass` means the inventory explicitly records a case result with its original evidence; it does not imply current-build verification. `unverified` means a result object exists but criteria remain. An applicable slot with no result object is also unverified coverage. Defect `closed`, `fixed`, and `in-fix` counts come from the defect file current `state`; the newer D22 assessment supplies current next steps without silently changing that ledger state.
