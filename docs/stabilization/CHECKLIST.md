# Stabilization checklist

Generated 2026-10-10 18:03 UTC from inventory.json, defect records, and the current coverage audit. Inventory updated 2026-10-10T12:43:34Z.

## Current truth

- Scope: 205 feature records, 769 cases, 1358 controls, 1230 applicable case-role slots.
- Case results: pass 95, partial 89, fail 2, unverified 1043, n/a 1; 132 explicitly unverified and 911 with no result record. Missing results count as unverified, including later-wave surfaces.
- Fully verified feature-role pairs: 0/396 under the rule that every applicable case passes and every control maps to a case.
- Procedure gaps: 0 missing steps; 0 missing expected outcomes; 1 missing control links.
- Defect states: closed 125, retest-pass 9, fixed 49, in-fix 10, open 1. A fixed or closed defect is not a feature-level UI pass.

## Current-build evidence

- **Release 0.2.205:** Last authenticated primary Store observation, October7 at16:23UTC: published/draft0.2.205, public, no pending review or reviewer action. No newer eligible Store ZIP established. Evidence .research/daily-store-20261007.json and daily-release-inventory-20261007.json. D97/D112 actual Store-installed acceptance and D96 owner-table/published verification remain open; no overall health claim. October8 dashboard observation was not admitted by the local resource guard; no newer dashboard status is claimed.
- **Artifact:** Exact submitted Store 0.2.205 ZIP from hosted strict release run 37180303468, artifact 11294843385, source 2f68bc4fef0c024f5a91d69f3c49b51c9dcd38a3, SHA-256 6cc56340e928376db57d31460d3c06eb894fbd0415c87b0ff372f633c5f44a26. This is a release package, not an installed Store build. Separate Profile development 0.2.189 evidence remains scoped to that older artifact.
- **Scoped native acceptance:** October8 original public205 adapted-unpacked guest regression passes in native37770686993 on stablelive32f3a398789e0a56b590089ff47b90aff6abe159 containing7ec6c76205. Opening/same-conversation follow-up/full-panel-reload new conversation each produced grounded visible terminal answers; postreload page tool completed and continuation ended complete/success. All3 current resourcejournals valid. Independent4a72d8b0 resolves earlier cross-turn diagnostic objection and confirms boundedpass. EXT-D-0172 closed; T10 guest pass preserves priorfailhistory. No StoreUIinstallation or overallChat/extensionhealth claim. Evidence .research/guest-position-fix-live-retest-20261008.json and .research/guest-position-native-adjudication-20261008.json. Earlier build-specific evidence follows and does not override this failure. October7 hosted37649504416 tested publicCRX205 unpacked: first, same-conversation follow-up and new conversation after reload returned actual terminal answers over HTTP200 against stable server8fe201b44e7a4c8fe3bf726b77546ad533926a60; all three owned guard journals valid. Evidence .research/daily-guest-20261007.json. This is not Store UI installation proof or broad health. Historical candidate/allowance/nonadmin evidence follows: Independent exact 0.2.205 Store payload loaded unpacked with only its public manifest key adapted: four real fresh-guest answers, fifth live HTTP 402 guest_ai_allowance_used with free-account remedy/no Retry, and returning exhausted-guest panel reload/New chat with a second distinct live HTTP 402 and same remedy. Signed-in non-admin Chat answered with admin check HTTP 200/zero rows. The organization-present probe was source-fixed at bef9a4de after its string/object mismatch, and independent source/narrow-guard review 216c24c0 passed. The historical local receipt remains false. Corrected hosted local-development-ZIP 0.2.205 member run 37182939504 passed organization presence, canonical non-admin HTTP 200/zero rows and a real Chat answer; D113 is closed. Evidence: .research/hosted-member205-final.json. That hosted member run does not verify the Store ZIP, full organization lifecycle, or a Store installation. See .research/guest-402-native-acceptance.json, .research/guest-returning-final-acceptance.json, and .research/member-org-diagnostic-repair.json. Historical Profile 0.2.189 bounded results are retained in inventory; none certify Store 0.2.205.
- These receipts establish only the named checks on the named artifact. Other inventory passes keep their recorded historical build boundary.

## Inventory freshness review

Since inventory source `636d00857f774a7b15fe70032dd9c35cef44c015`, **152 `src/` paths changed** through `5061d886fbff8b294a7c16a92b8938ddc0c42796`. A direct path-anchor comparison matched 21 and left 131 without an exact inventory anchor.
A direct anchor miss is only a census-review hint. Feature inventory anchors are not an exhaustive dependency graph, so it does not prove an omitted feature or behavior.

## Next test priorities

- **Coverage model / all contained surfaces** — 0 of 396 applicable feature-role pairs meet the full-verification rule. The inventory records 95 pass, 132 explicit unverified, 89 partial, 2 fail, 1 not applicable, and 911 slots with no result. A pass retains its original build boundary. Next: Continue recording bounded runs by exact build and role; do not infer whole-feature health from a repaired defect or scoped pass.
- **Executable test procedures** — 0 cases lack steps, 0 lack expected outcomes, and 1 lack control links. The registered-executor surface has 173 cases; its live catalog parity does not prove runtime behavior. Next: Design each missing case from the live advertised tool contract and safe real fixtures before execution.
- **Current install and native breadth** — Published 0.2.205 has bounded unpacked public-CRX evidence; this is not actual Store-installed lifecycle acceptance. The last resource-valid stable-server guest check is October 5 run37356729984. October 6 checks produced replies but failed deployment-stability or resource-validity gates, so current-server acceptance remains unverified. Development artifacts and their bounded case results carry separate receipts. Personal Chrome reload, broad guest/member/admin sidepanel/content-script/service-worker/offscreen coverage and signout privacy remain unverified. Next: Bind native runs to current artifact receipt, real user surface and persona; preserve admission guard.
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
| Testing infrastructure | 1 | 8 | 3 | 1 | 19 | 0 |
| Release infrastructure | 1 | 27 | 0 | 0 | 6 | 0 |
| Navigation / shell | 1 | 1 | 6 | 0 | 17 | 0 |
| Popup / options / mic permission | 1 | 0 | 0 | 0 | 20 | 0 |
| Settings | 1 | 32 | 16 | 0 | 46 | 1 |
| Profile | 1 | 5 | 6 | 0 | 21 | 0 |
| Debug log | 1 | 4 | 1 | 0 | 46 | 0 |
| Debug bridges | 1 | 0 | 0 | 0 | 28 | 0 |
| Scrape | 1 | 9 | 14 | 0 | 68 | 0 |
| SEO | 1 | 0 | 6 | 0 | 36 | 0 |
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
| Data side-panel | 1 | 1 | 2 | 0 | 7 | 0 |
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
| Tools / registered executor | 169 | 0 | 1 | 0 | 326 | 0 |

See [STATUS.md](STATUS.md) for case-level statuses, recorded evidence, linked defects, and surface details.
