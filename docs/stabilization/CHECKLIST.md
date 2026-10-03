# Stabilization checklist

Generated 2026-10-03 05:01 UTC from inventory.json, defect records, and the current coverage audit. Inventory updated 2026-10-03T05:01:17.774052+00:00.

## Current truth

- Scope: 205 feature records, 739 cases, 1323 controls, 1183 applicable case-role slots.
- Case results: pass 58, partial 47, fail 5, unverified 1072, n/a 1; 122 explicitly unverified and 950 with no result record. Missing results count as unverified, including later-wave surfaces.
- Fully verified feature-role pairs: 0/394 under the rule that every applicable case passes and every control maps to a case.
- Procedure gaps: 158 missing steps; 157 missing expected outcomes; 31 missing control links.
- Defect states: closed 50, retest-pass 2, fixed 29, in-fix 7, open 1. A fixed or closed defect is not a feature-level UI pass.

## Current-build evidence

- **Release 0.2.173:** Last frozen validated candidate is0.2.173 at the receipt/tag shown (1862 tests,5skipped and strict gates passed). Primary Store0.2.130 is Published-public, verified October2 13:12UTC. Main is0.2.175 plus newer fixes, with no matching ZIP; latest hosted packaging awaits scoped credential approval. Candidate173 is not latestmain and has not been uploaded.
- **Artifact:** Frozen 0.2.173 keyed tree SHA256 494b817a4de35ee52c3b00718d902538c2fa597f4af6b2f4fb1c66ea83458064; Store ZIP SHA256 1c640b6770ec442d173db92c8a624cfd935e1118785f2f6f48b238cec5c99bff. Candidate receipt/hash verified; no personal Chrome runtime claim. Current development-only175 artifact11236112494 from CI37027762568/sourceb41fd0b3 imported with tree a7f9728b45d9dcc407e392092c15383cd541de030d71330322d08617524e73ba; not Store-eligible.
- **Scoped native acceptance:** Exact173: D64 Files admin/member error and Retry passed, closed; D65 member pending. Exact development175/sourceb41fd0b3: guest SEO17 targets passed including Airbnb auto/manual audit and hreflang/schema links; independent0c84ddbd verified receipt chain and D76 guest spinner closed. One Wikipedia metadata-door candidate unavailable; broader SEO remains partial. D58 native active; D59 and D74 native pending. Chat/Pilot breadth, signout privacy, full modes/controls remain unverified.
- These receipts establish only the named checks on the named artifact. Other inventory passes keep their recorded historical build boundary.

## Inventory freshness review

Since inventory source `528ea0b0fec200cc1e7a1f2685a80201ccf7ed4b`, **237 `src/` paths changed** through `e932a09239ca97e0211985fcd763a3f529d7442a`. A direct path-anchor comparison matched 30 and left 207 without an exact inventory anchor.
A direct anchor miss is only a census-review hint. Feature inventory anchors are not an exhaustive dependency graph, so it does not prove an omitted feature or behavior.

## Next test priorities

- **Coverage model / all contained surfaces** — 0 of 394 applicable feature-role pairs meet the full-verification rule. The inventory records 58 pass, 122 explicit unverified, 47 partial, 5 fail, 1 not applicable, and 950 slots with no result. A pass retains its original build boundary. Next: Continue recording bounded runs by exact build and role; do not infer whole-feature health from a repaired defect or scoped pass.
- **Executable test procedures** — 158 cases lack steps, 157 lack expected outcomes, and 31 lack control links. The registered-executor surface has 173 cases; its live catalog parity does not prove runtime behavior. Next: Design each missing case from the live advertised tool contract and safe real fixtures before execution.
- **Current install and native breadth** — Strict exact0.2.173 release gates and frozen artifact pass. Guest Chat grounding/reload, signed-in non-admin Chat, admin Files error/Retry and admin Saved captures selection race have narrow native passes. Personal Chrome reload, broad guest/member/admin sidepanel/content-script/service-worker/offscreen coverage and signout privacy remain unverified. Next: Bind native runs to current artifact receipt, real user surface and persona; preserve admission guard.
- **Notes, Files, Saved captures** — Notes D61/D62/D63/D67/D68 have scoped exact139 admin native verification; feature/member breadth remains open. On exact173, D64 Files admin read-error/Retry passed for Library and Screenshots, and D65 Saved captures admin last-click race passed for late success and late failure. Member behavior, full search/pagination/edit/delete controls and full feature cases remain unverified. Next: Run the remaining current-build member and admin controls; do not count the exact-ID backend test-fixture cleanup as Saved captures UI deletion coverage.
- **Showcase / data / document identity** — Showcase has 59 cases: admin 1 pass, 26 partial, 3 unverified, 28 no-result; D54 is fixed with partial native dimensions, while D42/D47/D58/D59 remain among the active in-fix defect records, with build/native or shared document-identity consumer gaps documented. Next: Resume from their latest defect reports/checkpoint; avoid using historical artifact a8670bf7 as proof for newer corrections.
- **Registered tools** — 173 registered-executor cases (154 member and 173 admin slots); 4 slots per role are explicitly unverified and the rest have no result. Procedures are substantially missing; current database catalog parity does not prove tool runtime behavior. Next: Reconcile live roster; make procedures executable, then positive/refusal/permission/result-rendering checks with real data.
- **D69–D71 latest batch** — D69 archived org visibility is bounded native-verified, but archived/stale choice and held-request paths remain open. D70 Guidance read-error/retry and D71 records cross-org runtime scope are source/release-verified; current native behavior remains unverified. Next: Use the current checkpoint/report to run only the unverified paths.
- **Chat/Pilot** — Wave D inventory includes 10 Chat and 5 Pilot cases; systematic coverage remains deferred. Incidental guest availability is not full Chat acceptance. Next: Keep systematic Chat/Pilot behind contained-surface and case-procedure readiness; retain guest smoke as regression guard.

## Per-surface case totals

Pass and partial counts are recorded results; unverified includes explicit unverified and no-result slots. These are case-role slots, not whole-feature certifications.

| Surface | Features | Pass | Partial | Fail | Unverified | N/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development installation | 1 | 2 | 1 | 3 | 15 | 0 |
| Testing infrastructure | 1 | 7 | 1 | 1 | 14 | 0 |
| Release infrastructure | 1 | 24 | 0 | 0 | 6 | 0 |
| Navigation / shell | 1 | 1 | 6 | 0 | 17 | 0 |
| Popup / options / mic permission | 1 | 0 | 0 | 0 | 20 | 0 |
| Settings | 1 | 18 | 1 | 0 | 53 | 1 |
| Profile | 1 | 0 | 0 | 0 | 32 | 0 |
| Debug log | 1 | 4 | 1 | 0 | 46 | 0 |
| Debug bridges | 1 | 0 | 0 | 0 | 28 | 0 |
| Scrape | 1 | 1 | 0 | 0 | 87 | 0 |
| SEO | 1 | 0 | 5 | 0 | 37 | 0 |
| Screenshots | 1 | 0 | 0 | 0 | 16 | 0 |
| Highlights | 1 | 0 | 0 | 0 | 40 | 0 |
| Guidance | 1 | 0 | 0 | 0 | 46 | 0 |
| Showcase | 1 | 1 | 28 | 0 | 29 | 0 |
| Token broker | 1 | 0 | 0 | 0 | 9 | 0 |
| Content-page overlays / context menus / commands | 1 | 0 | 0 | 0 | 57 | 0 |
| Profile/auth/org picker | 1 | 0 | 0 | 0 | 46 | 0 |
| Keyboard commands | 1 | 0 | 0 | 0 | 0 | 0 |
| Tasks side-panel | 1 | 0 | 0 | 0 | 12 | 0 |
| Tasks capture flow | 1 | 0 | 0 | 0 | 2 | 0 |
| Lists side-panel | 1 | 0 | 0 | 0 | 10 | 0 |
| Agenda side-panel | 1 | 0 | 0 | 0 | 12 | 0 |
| Data side-panel | 1 | 0 | 1 | 0 | 6 | 0 |
| Notes side-panel | 1 | 0 | 0 | 0 | 4 | 0 |
| Notes editor | 1 | 0 | 0 | 0 | 8 | 0 |
| Files side-panel | 1 | 0 | 2 | 0 | 4 | 0 |
| Saved captures side-panel | 1 | 0 | 1 | 0 | 13 | 0 |
| Capture side-panel | 1 | 0 | 0 | 0 | 6 | 0 |
| Vault side-panel | 1 | 0 | 0 | 0 | 16 | 0 |
| Tools/manual runner | 1 | 0 | 0 | 0 | 4 | 0 |
| Chat (deferred wave D) | 1 | 0 | 0 | 1 | 25 | 0 |
| Pilot (deferred wave D) | 1 | 0 | 0 | 0 | 5 | 0 |
| Tools Smart tests | 1 | 0 | 0 | 0 | 8 | 0 |
| Tools Recorder | 1 | 0 | 0 | 0 | 8 | 0 |
| Vault password generator | 1 | 0 | 0 | 0 | 6 | 0 |
| Tools / registered executor | 169 | 0 | 0 | 0 | 325 | 0 |

See [STATUS.md](STATUS.md) for case-level statuses, recorded evidence, linked defects, and surface details.
