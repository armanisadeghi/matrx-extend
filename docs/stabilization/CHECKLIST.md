# Stabilization checklist

Generated 2026-10-03 16:38 UTC from inventory.json, defect records, and the current coverage audit. Inventory updated 2026-10-03T16:38:19.684027+00:00.

## Current truth

- Scope: 205 feature records, 759 cases, 1331 controls, 1205 applicable case-role slots.
- Case results: pass 70, partial 50, fail 4, unverified 1080, n/a 1; 122 explicitly unverified and 958 with no result record. Missing results count as unverified, including later-wave surfaces.
- Fully verified feature-role pairs: 0/394 under the rule that every applicable case passes and every control maps to a case.
- Procedure gaps: 148 missing steps; 147 missing expected outcomes; 31 missing control links.
- Defect states: closed 55, retest-pass 2, fixed 29, in-fix 5, open 1. A fixed or closed defect is not a feature-level UI pass.

## Current-build evidence

- **Release 0.2.173:** Last frozen validated Store candidate remains 0.2.173 at this receipt/tag. Published Store version is 0.2.130. Main development version is 0.2.175 with newer fixes, but no newer Store package has passed all release gates or been uploaded. Hosted credentials are working; current release blocker is genuine Records contract drift (D91), after D90 validator repair.
- **Artifact:** Frozen Store candidate173 keyed tree494b817a4de35ee52c3b00718d902538c2fa597f4af6b2f4fb1c66ea83458064 and Store ZIP1c640b6770ec442d173db92c8a624cfd935e1118785f2f6f48b238cec5c99bff remain unchanged. Guest development175 artifact11264666911 tree54162a180ed723dd4eb4b18cfbe6c0d9253be6d72b545c722cb4ed4a68a35068 is not Store-eligible.
- **Scoped native acceptance:** Development175 controlled-article guest first answer/reload passed37098718754; bounded Settings guest cases passed37099860144 (runs/hosted-settings-20261003.json). Published130 adapted original Google CRX run37103324918 observed two grounded signed-out answers, but failed final artifact-integrity assertion: whole-run acceptance remains unverified pending diagnostic37103982014. See .research/guest-published-runtime.json. Current live server5318c105 contains startup/envelope/routing repairs; new endpoint revision9bd979a894 passed train37103660096 and deploy37103864282 is pending. No full Chat, Records, member or overall product health claim; historical case passes retain exact build boundaries.
- These receipts establish only the named checks on the named artifact. Other inventory passes keep their recorded historical build boundary.

## Inventory freshness review

Since inventory source `528ea0b0fec200cc1e7a1f2685a80201ccf7ed4b`, **261 `src/` paths changed** through `e15aac6af702c747de1ecaf050626ebe397e1459`. A direct path-anchor comparison matched 31 and left 230 without an exact inventory anchor.
A direct anchor miss is only a census-review hint. Feature inventory anchors are not an exhaustive dependency graph, so it does not prove an omitted feature or behavior.

## Next test priorities

- **Coverage model / all contained surfaces** — 0 of 394 applicable feature-role pairs meet the full-verification rule. The inventory records 70 pass, 122 explicit unverified, 50 partial, 4 fail, 1 not applicable, and 958 slots with no result. A pass retains its original build boundary. Next: Continue recording bounded runs by exact build and role; do not infer whole-feature health from a repaired defect or scoped pass.
- **Executable test procedures** — 148 cases lack steps, 147 lack expected outcomes, and 31 lack control links. The registered-executor surface has 173 cases; its live catalog parity does not prove runtime behavior. Next: Design each missing case from the live advertised tool contract and safe real fixtures before execution.
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
| Release infrastructure | 1 | 27 | 0 | 0 | 6 | 0 |
| Navigation / shell | 1 | 1 | 6 | 0 | 17 | 0 |
| Popup / options / mic permission | 1 | 0 | 0 | 0 | 20 | 0 |
| Settings | 1 | 26 | 4 | 0 | 61 | 1 |
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
