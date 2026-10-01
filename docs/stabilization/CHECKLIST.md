# Stabilization checklist

Generated 2026-10-01 16:54 UTC from inventory.json, defect records, and the current coverage audit. Inventory updated 2026-10-01.

## Current truth

- Scope: 205 feature records, 732 cases, 1315 controls, 1163 applicable case-role slots.
- Case results: pass 58, partial 29, fail 1, unverified 1074, n/a 1; 124 explicitly unverified and 950 with no result record. Missing results count as unverified, including later-wave surfaces.
- Fully verified feature-role pairs: 0/394 under the rule that every applicable case passes and every control maps to a case.
- Procedure gaps: 158 missing steps; 157 missing expected outcomes; 31 missing control links.
- Defect states: closed 45, retest-pass 2, fixed 20, in-fix 4, open 1. A fixed or closed defect is not a feature-level UI pass.

## Current-build evidence

- **Release 0.2.173:** Exact 0.2.173 candidate was created from verified origin/main/tag; strict release gates passed (1862 tests passed, 5 skipped; compile/typecheck, tool DB drift, migrations, package checks and Store package/risk gates passed). This is a candidate, not a Chrome Web Store submission; 0.2.130 remains pending review.
- **Artifact:** Frozen 0.2.173 keyed tree SHA256 494b817a4de35ee52c3b00718d902538c2fa597f4af6b2f4fb1c66ea83458064; Store ZIP SHA256 1c640b6770ec442d173db92c8a624cfd935e1118785f2f6f48b238cec5c99bff. Candidate receipt/hash verified; no personal Chrome runtime claim.
- **Scoped native acceptance:** Candidate-native acceptance: signed-in non-admin Chat PASS_SCOPED on exact 0.2.173; guest UNVERIFIED because the run stopped at a tool-only-looking in-progress state before terminal answer evidence. Guest reload and signed-in-to-guest privacy transition remain unverified. Overall exact-candidate acceptance is HOLD; see docs/stabilization/reports/candidate-native-20261001.json.
- These receipts establish only the named checks on the named artifact. Other inventory passes keep their recorded historical build boundary.

## Inventory freshness review

Since inventory source `528ea0b0fec200cc1e7a1f2685a80201ccf7ed4b`, **209 `src/` paths changed** through `5cd121a2424e84cb81e2962152bdb9f3344d0f89`. A direct path-anchor comparison matched 25 and left 184 without an exact inventory anchor.
A direct anchor miss is only a census-review hint. Feature inventory anchors are not an exhaustive dependency graph, so it does not prove an omitted feature or behavior.

## Next test priorities

- **Coverage model / all contained surfaces** — 0 of 394 applicable feature-role pairs meet the full-verification rule. The inventory records 58 pass, 124 explicit unverified, 29 partial, 1 fail, 1 not applicable, and 950 slots with no result. A pass retains its original build boundary. Next: Continue recording bounded runs by exact build and role; do not infer whole-feature health from a repaired defect or scoped pass.
- **Executable test procedures** — 158 cases lack steps, 157 lack expected outcomes, and 31 lack control links. The registered-executor surface has 173 cases; its live catalog parity does not prove runtime behavior. Next: Design each missing case from the live advertised tool contract and safe real fixtures before execution.
- **Current install and native breadth** — 0.2.139 release gates passed and isolated extension artifact is recorded, but personal Chrome reload is explicitly unverified; broad guest/member/admin sidepanel/content-script/service-worker/offscreen passes are absent. Next: Bind native runs to current artifact receipt, real user surface and persona; preserve admission guard.
- **Notes, Files, Saved captures** — Notes D61/D62/D63/D67/D68 have scoped exact139 admin native verification; feature/member breadth remains open. D64 Files and D65 saved-capture race are source-fixed with focused regression coverage but no native acceptance in current reconciliation. Next: Do not reimplement Notes or D64/D65 source fixes; run remaining current-build native cases and update statuses only for observed outcomes.
- **Showcase / data / document identity** — Showcase has 59 cases: admin 1 pass, 26 partial, 3 unverified, 28 no-result; D54 is fixed with partial native dimensions, while D42/D47/D58/D59 remain among the active in-fix defect records, with build/native or shared document-identity consumer gaps documented. Next: Resume from their latest defect reports/checkpoint; avoid using historical artifact a8670bf7 as proof for newer corrections.
- **Registered tools** — 173 registered-executor cases (154 member and 173 admin slots); 4 slots per role are explicitly unverified and the rest have no result. Procedures are substantially missing; current database catalog parity does not prove tool runtime behavior. Next: Reconcile live roster; make procedures executable, then positive/refusal/permission/result-rendering checks with real data.
- **D69–D71 latest batch** — D69 archived org visibility is bounded native-verified, but archived/stale choice and held-request paths remain open. D70 Guidance read-error/retry and D71 records cross-org runtime scope are source/release-verified; current native behavior remains unverified. Next: Use the current checkpoint/report to run only the unverified paths.
- **Chat/Pilot** — Wave D inventory includes 10 Chat and 5 Pilot cases; systematic coverage remains deferred. Incidental guest availability is not full Chat acceptance. Next: Keep systematic Chat/Pilot behind contained-surface and case-procedure readiness; retain guest smoke as regression guard.

## Per-surface case totals

Pass and partial counts are recorded results; unverified includes explicit unverified and no-result slots. These are case-role slots, not whole-feature certifications.

| Surface | Features | Pass | Partial | Fail | Unverified | N/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development installation | 1 | 2 | 0 | 0 | 13 | 0 |
| Testing infrastructure | 1 | 7 | 0 | 0 | 14 | 0 |
| Release infrastructure | 1 | 24 | 0 | 0 | 6 | 0 |
| Navigation / shell | 1 | 1 | 0 | 0 | 14 | 0 |
| Popup / options / mic permission | 1 | 0 | 0 | 0 | 20 | 0 |
| Settings | 1 | 18 | 0 | 0 | 54 | 1 |
| Profile | 1 | 0 | 0 | 0 | 32 | 0 |
| Debug log | 1 | 4 | 1 | 0 | 46 | 0 |
| Debug bridges | 1 | 0 | 0 | 0 | 28 | 0 |
| Scrape | 1 | 1 | 0 | 0 | 87 | 0 |
| SEO | 1 | 0 | 0 | 0 | 42 | 0 |
| Screenshots | 1 | 0 | 0 | 0 | 16 | 0 |
| Highlights | 1 | 0 | 0 | 0 | 40 | 0 |
| Guidance | 1 | 0 | 0 | 0 | 46 | 0 |
| Showcase | 1 | 1 | 26 | 0 | 31 | 0 |
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
| Files side-panel | 1 | 0 | 1 | 0 | 5 | 0 |
| Saved captures side-panel | 1 | 0 | 0 | 0 | 14 | 0 |
| Capture side-panel | 1 | 0 | 0 | 0 | 6 | 0 |
| Vault side-panel | 1 | 0 | 0 | 0 | 16 | 0 |
| Tools/manual runner | 1 | 0 | 0 | 0 | 4 | 0 |
| Chat (deferred wave D) | 1 | 0 | 0 | 1 | 22 | 0 |
| Pilot (deferred wave D) | 1 | 0 | 0 | 0 | 5 | 0 |
| Tools Smart tests | 1 | 0 | 0 | 0 | 8 | 0 |
| Tools Recorder | 1 | 0 | 0 | 0 | 8 | 0 |
| Vault password generator | 1 | 0 | 0 | 0 | 6 | 0 |
| Tools / registered executor | 169 | 0 | 0 | 0 | 325 | 0 |

See [STATUS.md](STATUS.md) for case-level statuses, recorded evidence, linked defects, and surface details.
