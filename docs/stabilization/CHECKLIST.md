# Stabilization checklist

Generated 2026-10-04 01:04 UTC from inventory.json, defect records, and the current coverage audit. Inventory updated 2026-10-04T01:04:06.442420+00:00.

## Current truth

- Scope: 205 feature records, 761 cases, 1333 controls, 1209 applicable case-role slots.
- Case results: pass 69, partial 68, fail 4, unverified 1067, n/a 1; 122 explicitly unverified and 945 with no result record. Missing results count as unverified, including later-wave surfaces.
- Fully verified feature-role pairs: 0/394 under the rule that every applicable case passes and every control maps to a case.
- Procedure gaps: 148 missing steps; 147 missing expected outcomes; 31 missing control links.
- Defect states: closed 61, retest-pass 4, fixed 30, in-fix 5, open 1. A fixed or closed defect is not a feature-level UI pass.

## Current-build evidence

- **Release 0.2.181:** The primary authenticated Chrome Web Store dashboard confirmed Pending review, Draft 0.2.181, Published 0.2.176 at approximately 22:29 UTC October 3 after an approximately 22:27–22:28 UTC submission with automatic publication enabled. Screenshot: docs/stabilization/evidence/release181/store-pending-review.png. Hosted strict release 37155938434 produced the exact 0.2.181 Store ZIP from bcf1d1615e90f873cada20209eae7ddce742ecf4; later main metadata does not replace the submitted package. D97 is retest-pass pending publication and actual Store-installed verification. D96 remains fixed pending the signed-in owner-table HTTP 200 read and publication. D94 is closed only for its original admin reproduction; D95 remains fixed pending member and cross-identity retest. No overall Profile, extension, or Store acceptance is claimed.
- **Artifact:** Submitted 0.2.181 Store ZIP SHA-256 b816f01b1f2bbc3c5dae378415c701f2e73233e18998af6adc72fa2b87ab987c; original Store tree 827d1a10c42955cf83e007039d4768e3d33b25dc97521b3a97c6ab56eab45cf8. Native acceptance used an unpacked copy with only the matching local public key added to manifest.json for extension identity; the original ZIP was unchanged. Previous Profile development artifact remains CI 37150495327 / artifact 11283802431, source ac49ac2f8fb9f9c3d538aef81149a1c4a6eb2418, tree 9cc1d6a77f7f2f0314a9ecee8dae6b73bc2bc6bb472e94d05e6b0aea43f75fdf; its Profile observations do not establish behavior in Store 0.2.181.
- **Scoped native acceptance:** Exact Store ZIP candidate 0.2.181 bounded guest run passed three live Chat answers and a fourth-turn allowance/free-account explanation without generic denial or Retry; guest public demo and page-grounded panel reload passed. A real signed-in non-admin member completed a Chat answer. Owner-table GET was absent after guest observer attachment; the specific signed-in owner-table HTTP 200 read was not observed. .research/guest-store-native-escalation.json and independent .research/guest-driver-final-peer.json preserve proof and limits; root independently verified all seven resource-journal hashes. The candidate was unpacked with manifest-key identity adaptation, not installed from Google; the Network observer did not cover startup or offscreen HTTP status. Earlier exact Profile development artifact ac49ac2f admin warm T02 Back/discard/reopen, T04 Discard/save/reopen/restoration, and T25 denied owner-row read/Retry passed. Profile runner source repair 73793bb7 passed lightweight checks; independent source review 4118a398 found prior defects addressed but flagged a stable account fingerprint in report metadata. Remove it before guarded member/reload native acceptance. No member/reload native acceptance has run. No overall feature pass follows. Member warm T01/T03/T25 and bounded first-save T28 were observed on exact9dfb5911 development184 in run04; failed reload remains unverified. Separate guarded recovery05 restored original Profile-row absence; root verified raw/journal hashes. See .research/profile-member-bounded-owner-verification.json. No whole-case or defect closure.
- These receipts establish only the named checks on the named artifact. Other inventory passes keep their recorded historical build boundary.

## Inventory freshness review

Since inventory source `528ea0b0fec200cc1e7a1f2685a80201ccf7ed4b`, **272 `src/` paths changed** through `242ee730e5bb90e1115c652c7ea35dc2f30d4378`. A direct path-anchor comparison matched 32 and left 240 without an exact inventory anchor.
A direct anchor miss is only a census-review hint. Feature inventory anchors are not an exhaustive dependency graph, so it does not prove an omitted feature or behavior.

## Next test priorities

- **Coverage model / all contained surfaces** — 0 of 394 applicable feature-role pairs meet the full-verification rule. The inventory records 69 pass, 122 explicit unverified, 68 partial, 4 fail, 1 not applicable, and 945 slots with no result. A pass retains its original build boundary. Next: Continue recording bounded runs by exact build and role; do not infer whole-feature health from a repaired defect or scoped pass.
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
| Development installation | 1 | 1 | 2 | 3 | 15 | 0 |
| Testing infrastructure | 1 | 7 | 3 | 1 | 16 | 0 |
| Release infrastructure | 1 | 27 | 0 | 0 | 6 | 0 |
| Navigation / shell | 1 | 1 | 6 | 0 | 17 | 0 |
| Popup / options / mic permission | 1 | 0 | 0 | 0 | 20 | 0 |
| Settings | 1 | 26 | 10 | 0 | 55 | 1 |
| Profile | 1 | 0 | 8 | 0 | 24 | 0 |
| Debug log | 1 | 4 | 1 | 0 | 46 | 0 |
| Debug bridges | 1 | 0 | 0 | 0 | 28 | 0 |
| Scrape | 1 | 1 | 0 | 0 | 87 | 0 |
| SEO | 1 | 0 | 5 | 0 | 37 | 0 |
| Screenshots | 1 | 0 | 0 | 0 | 16 | 0 |
| Highlights | 1 | 0 | 0 | 0 | 40 | 0 |
| Guidance | 1 | 0 | 0 | 0 | 46 | 0 |
| Showcase | 1 | 1 | 28 | 0 | 29 | 0 |
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
| Vault side-panel | 1 | 0 | 0 | 0 | 16 | 0 |
| Tools/manual runner | 1 | 0 | 0 | 0 | 4 | 0 |
| Chat (deferred wave D) | 1 | 1 | 0 | 0 | 25 | 0 |
| Pilot (deferred wave D) | 1 | 0 | 0 | 0 | 5 | 0 |
| Tools Smart tests | 1 | 0 | 0 | 0 | 8 | 0 |
| Tools Recorder | 1 | 0 | 0 | 0 | 8 | 0 |
| Vault password generator | 1 | 0 | 0 | 0 | 6 | 0 |
| Tools / registered executor | 169 | 0 | 0 | 0 | 325 | 0 |

See [STATUS.md](STATUS.md) for case-level statuses, recorded evidence, linked defects, and surface details.
