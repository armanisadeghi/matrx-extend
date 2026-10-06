# Stabilization checklist

Generated 2026-10-06 23:29 UTC from inventory.json, defect records, and the current coverage audit. Inventory updated 2026-10-06T23:29:55.094914+00:00.

## Current truth

- Scope: 205 feature records, 767 cases, 1349 controls, 1224 applicable case-role slots.
- Case results: pass 85, partial 78, fail 2, unverified 1058, n/a 1; 134 explicitly unverified and 924 with no result record. Missing results count as unverified, including later-wave surfaces.
- Fully verified feature-role pairs: 0/396 under the rule that every applicable case passes and every control maps to a case.
- Procedure gaps: 82 missing steps; 82 missing expected outcomes; 27 missing control links.
- Defect states: closed 91, retest-pass 6, fixed 40, in-fix 6, open 1. A fixed or closed defect is not a feature-level UI pass.

## Current-build evidence

- **Release 0.2.205:** Authenticated primary Store dashboard confirmed submission success at approximately 05:57 UTC October 4: 0.2.205 Pending review, 0.2.176 Published, automatic publication enabled. The earlier 0.2.181 submission was cancelled because its 403-only guest allowance classifier missed the reproduced live HTTP 402 refusal; that submission is historical. D97 and D112 await publication and actual Store-installed 0.2.205 acceptance. D96 remains unclosed pending signed-in owner-table HTTP 200 proof and Store verification. No full extension health claim.
- **Artifact:** Exact submitted Store 0.2.205 ZIP from hosted strict release run 37180303468, artifact 11294843385, source 2f68bc4fef0c024f5a91d69f3c49b51c9dcd38a3, SHA-256 6cc56340e928376db57d31460d3c06eb894fbd0415c87b0ff372f633c5f44a26. This is a release package, not an installed Store build. Separate Profile development 0.2.189 evidence remains scoped to that older artifact.
- **Scoped native acceptance:** Independent exact 0.2.205 Store payload loaded unpacked with only its public manifest key adapted: four real fresh-guest answers, fifth live HTTP 402 guest_ai_allowance_used with free-account remedy/no Retry, and returning exhausted-guest panel reload/New chat with a second distinct live HTTP 402 and same remedy. Signed-in non-admin Chat answered with admin check HTTP 200/zero rows. The organization-present probe was source-fixed at bef9a4de after its string/object mismatch, and independent source/narrow-guard review 216c24c0 passed. The historical local receipt remains false. Corrected hosted local-development-ZIP 0.2.205 member run 37182939504 passed organization presence, canonical non-admin HTTP 200/zero rows and a real Chat answer; D113 is closed. Evidence: .research/hosted-member205-final.json. That hosted member run does not verify the Store ZIP, full organization lifecycle, or a Store installation. See .research/guest-402-native-acceptance.json, .research/guest-returning-final-acceptance.json, and .research/member-org-diagnostic-repair.json. Historical Profile 0.2.189 bounded results are retained in inventory; none certify Store 0.2.205.
- These receipts establish only the named checks on the named artifact. Other inventory passes keep their recorded historical build boundary.

## Inventory freshness review

Since inventory source `528ea0b0fec200cc1e7a1f2685a80201ccf7ed4b`, **285 `src/` paths changed** through `682bc758751d829ddbe89a86fbecaf4ad8b9dd1d`. A direct path-anchor comparison matched 34 and left 251 without an exact inventory anchor.
A direct anchor miss is only a census-review hint. Feature inventory anchors are not an exhaustive dependency graph, so it does not prove an omitted feature or behavior.

## Next test priorities

- **Coverage model / all contained surfaces** — 0 of 396 applicable feature-role pairs meet the full-verification rule. The inventory records 85 pass, 134 explicit unverified, 78 partial, 2 fail, 1 not applicable, and 924 slots with no result. A pass retains its original build boundary. Next: Continue recording bounded runs by exact build and role; do not infer whole-feature health from a repaired defect or scoped pass.
- **Executable test procedures** — 82 cases lack steps, 82 lack expected outcomes, and 27 lack control links. The registered-executor surface has 173 cases; its live catalog parity does not prove runtime behavior. Next: Design each missing case from the live advertised tool contract and safe real fixtures before execution.
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
| Development installation | 1 | 6 | 1 | 0 | 14 | 0 |
| Testing infrastructure | 1 | 8 | 2 | 1 | 17 | 0 |
| Release infrastructure | 1 | 27 | 0 | 0 | 6 | 0 |
| Navigation / shell | 1 | 1 | 6 | 0 | 17 | 0 |
| Popup / options / mic permission | 1 | 0 | 0 | 0 | 20 | 0 |
| Settings | 1 | 26 | 10 | 0 | 58 | 1 |
| Profile | 1 | 5 | 6 | 0 | 21 | 0 |
| Debug log | 1 | 4 | 1 | 0 | 46 | 0 |
| Debug bridges | 1 | 0 | 0 | 0 | 28 | 0 |
| Scrape | 1 | 6 | 13 | 0 | 72 | 0 |
| SEO | 1 | 0 | 5 | 0 | 37 | 0 |
| Screenshots | 1 | 0 | 0 | 0 | 16 | 0 |
| Highlights | 1 | 0 | 0 | 0 | 40 | 0 |
| Guidance | 1 | 0 | 0 | 0 | 46 | 0 |
| Showcase | 1 | 1 | 28 | 0 | 30 | 0 |
| Token broker | 1 | 0 | 0 | 0 | 9 | 0 |
| Content-page overlays / context menus / commands | 1 | 0 | 1 | 0 | 56 | 0 |
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
| Vault side-panel | 1 | 0 | 0 | 0 | 20 | 0 |
| Tools/manual runner | 1 | 0 | 0 | 0 | 4 | 0 |
| Chat (deferred wave D) | 1 | 1 | 1 | 1 | 24 | 0 |
| Pilot (deferred wave D) | 1 | 0 | 0 | 0 | 5 | 0 |
| Tools Smart tests | 1 | 0 | 0 | 0 | 8 | 0 |
| Tools Recorder | 1 | 0 | 0 | 0 | 8 | 0 |
| Vault password generator | 1 | 0 | 0 | 0 | 6 | 0 |
| Tools / registered executor | 169 | 0 | 0 | 0 | 327 | 0 |

See [STATUS.md](STATUS.md) for case-level statuses, recorded evidence, linked defects, and surface details.
