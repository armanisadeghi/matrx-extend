# Stabilization checklist

Generated 2026-10-03 19:34 UTC from inventory.json, defect records, and the current coverage audit. Inventory updated 2026-10-03T19:30:00Z.

## Current truth

- Scope: 205 feature records, 759 cases, 1331 controls, 1205 applicable case-role slots.
- Case results: pass 70, partial 56, fail 4, unverified 1074, n/a 1; 121 explicitly unverified and 953 with no result record. Missing results count as unverified, including later-wave surfaces.
- Fully verified feature-role pairs: 0/394 under the rule that every applicable case passes and every control maps to a case.
- Procedure gaps: 148 missing steps; 147 missing expected outcomes; 31 missing control links.
- Defect states: closed 57, retest-pass 2, fixed 27, in-fix 6, open 1. A fixed or closed defect is not a feature-level UI pass.

## Current-build evidence

- **Release 0.2.176:** Chrome Web Store 0.2.176 is Published - public, confirmed by the authenticated dashboard recheck at 16:09 UTC on October 3 (.research/daily-store-20261003.json). Hosted release 37105966615 passed its strict gates. Main is 0.2.177. Its development artifact at source 2274cc2f, run 37145482483, artifact 11282375130 was imported and provenance-verified; native acceptance was not run. No eligible newer Store artifact or publication is established. D91 manual Records execution and broader stabilization coverage remain open.
- **Artifact:** The frozen 0.2.176 release ZIP SHA-256 is 813715b8dcd6421d4ee001c04e99c3729f6dad439064f8bf5922e6fb38ce09f8; keyed tree SHA-256 is 755c43f69d4dc5bdc080194f131cd3d062f337240260afecda35401c67d31272. The exact unpacked ZIP and tree were unchanged before and after native guest run published176-guest-backend-82af43a3. The separate 0.2.177 development artifact has tree SHA-256 a366b2b34045412b9866929cea59ab9d872d7be373ba08562705e4bcce8d3b23 (.research/current-development-artifact-refresh.json); it is not a Store candidate or a native acceptance result.
- **Scoped native acceptance:** Exact 0.2.176 unpacked-ZIP native headless Chromium guest run published176-guest-backend-82af43a3 passed a grounded first answer and grounded follow-up after real side-panel reload against live aidream 82af43a337e848da4d2ffebc7915fc76da8ea2b8, unchanged before and after the run (.research/published176-guest-backend-82af43a3.json). This did not exercise Chrome Web Store installation/update lifecycle. Historical development175 and Store130 results retain their original evidence; no full Chat, Records, or overall product-health claim follows from this bounded run.
- These receipts establish only the named checks on the named artifact. Other inventory passes keep their recorded historical build boundary.

## Inventory freshness review

Since inventory source `528ea0b0fec200cc1e7a1f2685a80201ccf7ed4b`, **261 `src/` paths changed** through `0866cff18cf8cb95e0120d3c2f7591c12175f69f`. A direct path-anchor comparison matched 31 and left 230 without an exact inventory anchor.
A direct anchor miss is only a census-review hint. Feature inventory anchors are not an exhaustive dependency graph, so it does not prove an omitted feature or behavior.

## Next test priorities

- **Coverage model / all contained surfaces** — 0 of 394 applicable feature-role pairs meet the full-verification rule. The inventory records 70 pass, 121 explicit unverified, 56 partial, 4 fail, 1 not applicable, and 953 slots with no result. A pass retains its original build boundary. Next: Continue recording bounded runs by exact build and role; do not infer whole-feature health from a repaired defect or scoped pass.
- **Executable test procedures** — 148 cases lack steps, 147 lack expected outcomes, and 31 lack control links. The registered-executor surface has 173 cases; its live catalog parity does not prove runtime behavior. Next: Design each missing case from the live advertised tool contract and safe real fixtures before execution.
- **Current install and native breadth** — Strict exact 0.2.176 release gates passed and the frozen published artifact has bounded native guest acceptance. The separate 0.2.177 development artifact is provenance-verified, with native acceptance not run. Guest Chat grounding/reload, signed-in non-admin Chat, admin Files error/Retry and admin Saved captures selection race have narrow native passes. Personal Chrome reload, broad guest/member/admin sidepanel/content-script/service-worker/offscreen coverage and signout privacy remain unverified. Next: Bind native runs to current artifact receipt, real user surface and persona; preserve admission guard.
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
| Release infrastructure | 1 | 27 | 0 | 0 | 6 | 0 |
| Navigation / shell | 1 | 1 | 6 | 0 | 17 | 0 |
| Popup / options / mic permission | 1 | 0 | 0 | 0 | 20 | 0 |
| Settings | 1 | 26 | 10 | 0 | 55 | 1 |
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
| Chat (deferred wave D) | 1 | 1 | 0 | 0 | 25 | 0 |
| Pilot (deferred wave D) | 1 | 0 | 0 | 0 | 5 | 0 |
| Tools Smart tests | 1 | 0 | 0 | 0 | 8 | 0 |
| Tools Recorder | 1 | 0 | 0 | 0 | 8 | 0 |
| Vault password generator | 1 | 0 | 0 | 0 | 6 | 0 |
| Tools / registered executor | 169 | 0 | 0 | 0 | 325 | 0 |

See [STATUS.md](STATUS.md) for case-level statuses, recorded evidence, linked defects, and surface details.
