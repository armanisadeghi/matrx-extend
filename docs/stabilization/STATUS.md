# Extension stabilization status

Generated 2026-10-07 09:43 UTC from inventory.json and defects/*.json. Inventory updated 2026-10-07T05:31:12.930287+00:00. 205 features · 767 cases · 1349 controls · 147 linked defect records.

A feature is fully verified for a role only when every applicable case explicitly passes and every inventoried control has a mapped case. A pass on one case does not verify the whole feature. Unrecorded results remain unverified. Matrix passes retain their original build boundary; they count as current-build acceptance only when a receipt-bound report says so. A fixed or closed defect does not itself prove native behavior.

## Current coverage snapshot

Applicable case-by-role slots: **1224** — Pass: 85 · Partial: 78 · Fail: 2 · Unverified: 1058 · N/A: 1.
Unverified splits into **134 explicitly marked unverified** and **924 with no result record**.
Full feature-role pairs: **0/396**. Procedure gaps: 48 cases without steps, 48 without expected outcomes, 27 without control links.
A recorded pass is historical or bounded until its evidence explicitly binds it to the current artifact. The current release receipt and scoped native results are listed separately in the checklist.

## Tab and surface overview

| Tab or surface | Features | Guest cases | Member cases | Admin cases | All-role case slots | Active defects |
| --- | ---: | --- | --- | --- | --- | ---: |
| [Development installation](#development-installation) | 1 | 2 pass · 0 partial · 0 fail · 5 unverified · 0 deferred; 0/1 full | 2 pass · 0 partial · 0 fail · 5 unverified · 0 deferred; 0/1 full | 2 pass · 1 partial · 0 fail · 4 unverified · 0 deferred; 0/1 full | pass 6, partial 1, fail 0, unverified 14, n/a 0 | 1 |
| [Testing infrastructure](#testing-infrastructure) | 1 | 3 pass · 0 partial · 0 fail · 5 unverified · 0 deferred; 0/1 full | 3 pass · 1 partial · 1 fail · 5 unverified · 0 deferred; 0/1 full | 2 pass · 1 partial · 0 fail · 7 unverified · 0 deferred; 0/1 full | pass 8, partial 2, fail 1, unverified 17, n/a 0 | 5 |
| [Release infrastructure](#release-infrastructure) | 1 | 9 pass · 0 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | 9 pass · 0 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | 9 pass · 0 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | pass 27, partial 0, fail 0, unverified 6, n/a 0 | 0 |
| [Navigation / shell](#navigation--shell) | 1 | 1 pass · 3 partial · 0 fail · 4 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 8 unverified · 0 deferred; 0/1 full | 0 pass · 3 partial · 0 fail · 5 unverified · 0 deferred; 0/1 full | pass 1, partial 6, fail 0, unverified 17, n/a 0 | 0 |
| [Popup / options / mic permission](#popup--options--mic-permission) | 1 | 0 pass · 0 partial · 0 fail · 6 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 7 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 7 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 20, n/a 0 | 0 |
| [Settings](#settings) | 1 | 10 pass · 4 partial · 0 fail · 12 unverified · 0 deferred; 0/1 full | 2 pass · 3 partial · 0 fail · 22 unverified · 0 deferred; 0/1 full | 14 pass · 3 partial · 0 fail · 24 unverified · 0 deferred; 0/1 full | pass 26, partial 10, fail 0, unverified 58, n/a 1 | 0 |
| [Profile](#profile) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 5 pass · 3 partial · 0 fail · 8 unverified · 0 deferred; 0/1 full | 0 pass · 3 partial · 0 fail · 13 unverified · 0 deferred; 0/1 full | pass 5, partial 6, fail 0, unverified 21, n/a 0 | 5 |
| [Debug log](#debug-log) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 4 pass · 1 partial · 0 fail · 46 unverified · 0 deferred; 0/1 full | pass 4, partial 1, fail 0, unverified 46, n/a 0 | 0 |
| [Debug bridges](#debug-bridges) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 28 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 28, n/a 0 | 1 |
| [Scrape](#scrape) | 1 | 6 pass · 5 partial · 0 fail · 16 unverified · 0 deferred; 0/1 full | 0 pass · 8 partial · 0 fail · 24 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 32 unverified · 0 deferred; 0/1 full | pass 6, partial 13, fail 0, unverified 72, n/a 0 | 8 |
| [SEO](#seo) | 1 | 0 pass · 5 partial · 0 fail · 9 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 14 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 14 unverified · 0 deferred; 0/1 full | pass 0, partial 5, fail 0, unverified 37, n/a 0 | 0 |
| [Screenshots](#screenshots) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 8 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 8 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 16, n/a 0 | 6 |
| [Highlights](#highlights) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 20 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 20 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 40, n/a 0 | 1 |
| [Guidance](#guidance) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 23 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 23 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 46, n/a 0 | 1 |
| [Showcase](#showcase) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 1 pass · 28 partial · 0 fail · 30 unverified · 0 deferred; 0/1 full | pass 1, partial 28, fail 0, unverified 30, n/a 0 | 11 |
| [Token broker](#token-broker) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 9 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 9, n/a 0 | 0 |
| [Content-page overlays / context menus / commands](#content-page-overlays--context-menus--commands) | 1 | 0 pass · 1 partial · 0 fail · 18 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 19 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 19 unverified · 0 deferred; 0/1 full | pass 0, partial 1, fail 0, unverified 56, n/a 0 | 0 |
| [Profile/auth/org picker](#profileauthorg-picker) | 1 | 0 pass · 0 partial · 0 fail · 10 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 18 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 18 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 46, n/a 0 | 1 |
| [Keyboard commands](#keyboard-commands) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | pass 0, partial 0, fail 0, unverified 0, n/a 0 | 0 |
| [Tasks side-panel](#tasks-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 6 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 6 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 12, n/a 0 | 0 |
| [Tasks capture flow](#tasks-capture-flow) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 1 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 1 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 2, n/a 0 | 0 |
| [Lists side-panel](#lists-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 5 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 5 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 10, n/a 0 | 0 |
| [Agenda side-panel](#agenda-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 6 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 6 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 12, n/a 0 | 0 |
| [Data side-panel](#data-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 1 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 3 unverified · 0 deferred; 0/1 full | 0 pass · 1 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | pass 0, partial 1, fail 0, unverified 6, n/a 0 | 1 |
| [Notes side-panel](#notes-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 4, n/a 0 | 3 |
| [Notes editor](#notes-editor) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 4 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 4 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 8, n/a 0 | 3 |
| [Files side-panel](#files-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 1 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | 0 pass · 1 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | pass 0, partial 2, fail 0, unverified 4, n/a 0 | 0 |
| [Saved captures side-panel](#saved-captures-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 7 unverified · 0 deferred; 0/1 full | 0 pass · 1 partial · 0 fail · 6 unverified · 0 deferred; 0/1 full | pass 0, partial 1, fail 0, unverified 13, n/a 0 | 0 |
| [Capture side-panel](#capture-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 3 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 3 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 6, n/a 0 | 0 |
| [Vault side-panel](#vault-side-panel) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 10 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 10 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 20, n/a 0 | 0 |
| [Tools/manual runner](#toolsmanual-runner) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 2 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 4, n/a 0 | 0 |
| [Chat (deferred wave D)](#chat-deferred-wave-d) | 1 | 1 pass · 0 partial · 1 fail · 7 unverified · 0 deferred; 0/1 full | 0 pass · 1 partial · 0 fail · 8 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 9 unverified · 0 deferred; 0/1 full | pass 1, partial 1, fail 1, unverified 24, n/a 0 | 3 |
| [Pilot (deferred wave D)](#pilot-deferred-wave-d) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 5 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 5, n/a 0 | 1 |
| [Tools Smart tests](#tools-smart-tests) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 4 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 4 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 8, n/a 0 | 0 |
| [Tools Recorder](#tools-recorder) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 4 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 4 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 8, n/a 0 | 0 |
| [Vault password generator](#vault-password-generator) | 1 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 3 unverified · 0 deferred; 0/1 full | 0 pass · 0 partial · 0 fail · 3 unverified · 0 deferred; 0/1 full | pass 0, partial 0, fail 0, unverified 6, n/a 0 | 0 |
| [Tools / registered executor](#tools--registered-executor) | 169 | 0 pass · 0 partial · 0 fail · 0 unverified · 0 deferred; 0/0 full | 0 pass · 0 partial · 0 fail · 154 unverified · 0 deferred; 0/150 full | 0 pass · 0 partial · 0 fail · 173 unverified · 0 deferred; 0/169 full | pass 0, partial 0, fail 0, unverified 327, n/a 0 | 5 |

Role counts include only case-role combinations listed in each case. The all-role column includes every applicable recorded or unrecorded slot. Open each feature for case evidence, defects, and next action.

## Current artifact and bounded acceptance

**Release:** 0.2.205 at `2f68bc4fef0c024f5a91d69f3c49b51c9dcd38a3`. Last authenticated primary Store check, October 6 at 18:20 UTC: 0.2.205 Published — public and draft 0.2.205, with no pending review or reviewer action. Evidence: .research/daily-store-20261006.json; canonical release record: common-docs/systems/apps/extension/CHROME-WEB-STORE.md. Publication is confirmed; D97/D112 still need their remaining actual Store-installed acceptance, and D96 still needs signed-in owner-table HTTP 200 and published verification. No overall health claim.
**Local artifact:** Exact submitted Store 0.2.205 ZIP from hosted strict release run 37180303468, artifact 11294843385, source 2f68bc4fef0c024f5a91d69f3c49b51c9dcd38a3, SHA-256 6cc56340e928376db57d31460d3c06eb894fbd0415c87b0ff372f633c5f44a26. This is a release package, not an installed Store build. Separate Profile development 0.2.189 evidence remains scoped to that older artifact.
**Native evidence:** Independent exact 0.2.205 Store payload loaded unpacked with only its public manifest key adapted: four real fresh-guest answers, fifth live HTTP 402 guest_ai_allowance_used with free-account remedy/no Retry, and returning exhausted-guest panel reload/New chat with a second distinct live HTTP 402 and same remedy. Signed-in non-admin Chat answered with admin check HTTP 200/zero rows. The organization-present probe was source-fixed at bef9a4de after its string/object mismatch, and independent source/narrow-guard review 216c24c0 passed. The historical local receipt remains false. Corrected hosted local-development-ZIP 0.2.205 member run 37182939504 passed organization presence, canonical non-admin HTTP 200/zero rows and a real Chat answer; D113 is closed. Evidence: .research/hosted-member205-final.json. That hosted member run does not verify the Store ZIP, full organization lifecycle, or a Store installation. See .research/guest-402-native-acceptance.json, .research/guest-returning-final-acceptance.json, and .research/member-org-diagnostic-repair.json. Historical Profile 0.2.189 bounded results are retained in inventory; none certify Store 0.2.205.
These current-build checks supplement the inventory matrix; they do not promote unobserved cases or certify whole features.

## Development installation

### Development build, reload and runtime identity (EXT-F-0001)

**Role status:** guest: Unverified · member: Unverified · admin: Partial. **Cases:** 7. **Controls:** 7.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0077

**Linked defects:** [EXT-D-0007](defects/EXT-D-0007.json) (closed), [EXT-D-0014](defects/EXT-D-0014.json) (closed), [EXT-D-0028](defects/EXT-D-0028.json) (closed), [EXT-D-0077](defects/EXT-D-0077.json) (fixed), [EXT-D-0080](defects/EXT-D-0080.json) (closed), [EXT-D-0090](defects/EXT-D-0090.json) (closed), [EXT-D-0099](defects/EXT-D-0099.json) (closed), [EXT-D-0106](defects/EXT-D-0106.json) (closed), [EXT-D-0120](defects/EXT-D-0120.json) (closed), [EXT-D-0121](defects/EXT-D-0121.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-0001-T01 Fresh development build and unpacked identity | Unverified | Unverified | Unverified | EXT-F-0001-C01 |
| EXT-F-0001-T02 Extension reload and sidepanel recovery | Pass | Pass | Pass | EXT-F-0001-C02 |
| EXT-F-0001-T03 Content-script page reload | Unverified | Unverified | Unverified | EXT-F-0001-C03 |
| EXT-F-0001-T04 Service-worker and offscreen restart | Unverified | Unverified | Unverified | EXT-F-0001-C04 |
| EXT-F-0001-T05 Development identity auth redirect | Unverified | Unverified | Unverified | EXT-F-0001-C05 |
| EXT-F-0001-T06 Automatic CI development artifact is trustworthy and usable without local build | Unverified | Unverified | Partial | EXT-F-0001-C06 |
| EXT-F-0001-T07 Strict release gate accepts valid registry metadata and rejects actual drift | Pass | Pass | Pass | EXT-F-0001-C07 |

**Recorded case details and evidence:**

- EXT-F-0001-T01 · guest: Unverified.
  Evidence / build / date recorded: baseline-build-001, docs/stabilization/runs/baseline-build-001.json
- EXT-F-0001-T02 · guest: Pass. Exact development215 genuine guest reload: authoritative old stopped/redundant proof, sole distinct running/activated replacement, exact SIDE_PANEL context appeared after2checks, trusted Scrape click and rendered empty/capture-enabled view. Three healthy exit0journals; root verified raw hashes. Management diagnostic counts not retained by this receipt; no claim of zero errors globally or Store/current-main acceptance.
  Evidence / build / date recorded: 37205211642, Frozen development215/source3536b5cb/CI37193761291/artifact11299613935, 2026-10-04T13:30:38.711263+00:00, .research/startup-attributed-native.json
- EXT-F-0001-T02 · member: Pass. Independent frozen189 member full extension reload retired old worker/panel, created replacements, restored signed-in account and rendered Profile controls; subsequent field/save/reopen cases passed. Original row absence restored; no Store installation claim.
  Evidence / build / date recorded: profile-fields-reload-fixed-189-08, Frozen development189/sourceb4b9f0c4/CI37164174445/artifact11288542496, 2026-10-04T03:52:44.728959+00:00, .research/profile-fields-reload-fixed-native.json
- EXT-F-0001-T02 · admin: Pass. Final shipped0.2.56 full extension Reload,30s before opening actual sidepanel: admin/ADMIN restored; selected org visible about5s later. Original development30s-settle proof retained in permissions-auth-native-sol.
  Evidence / build / date recorded: release-native-verification, docs/stabilization/runs/release-native-verification.json
- EXT-F-0001-T06 · guest: Unverified. Implementation active after independent contract review; actual artifact/import/native evidence pending.
  Evidence / build / date recorded: ['docs/stabilization/reports/current-test-artifact-20261002.json', 'docs/stabilization/reports/current-test-artifact-contract-peer-20261002.json']
- EXT-F-0001-T06 · member: Unverified. Implementation active after independent contract review; actual artifact/import/native evidence pending.
  Evidence / build / date recorded: ['docs/stabilization/reports/current-test-artifact-20261002.json', 'docs/stabilization/reports/current-test-artifact-contract-peer-20261002.json']
- EXT-F-0001-T06 · admin: Partial. D80 actual profile/loaded-path/version check validated with fresh admin repeat; complete CI import collision/error matrix and all artifact coverage remain unverified.
  Evidence / build / date recorded: docs/stabilization/reports/siteaccess-prepare-pathchecked-native-20261002.json
- EXT-F-0001-T07 · guest: Pass. Auth-independent release gate only: fresh metadata/rejection checks3/3 and exact hosted205 mandatory strict drift gate success. Scoped historical205/source2f68bc4f evidence, not native role or current-main acceptance. Previous failure retained.
  Evidence / build / date recorded: 37180303468, 2026-10-04T10:43:41.516942+00:00, .research/registry-gate-current-retest.json
- EXT-F-0001-T07 · member: Pass. Auth-independent release gate only: fresh metadata/rejection checks3/3 and exact hosted205 mandatory strict drift gate success. Scoped historical205/source2f68bc4f evidence, not native role or current-main acceptance. Previous failure retained.
  Evidence / build / date recorded: 37180303468, 2026-10-04T10:43:41.516942+00:00, .research/registry-gate-current-retest.json
- EXT-F-0001-T07 · admin: Pass. Auth-independent release gate only: fresh metadata/rejection checks3/3 and exact hosted205 mandatory strict drift gate success. Scoped historical205/source2f68bc4f evidence, not native role or current-main acceptance. Previous failure retained.
  Evidence / build / date recorded: 37180303468, 2026-10-04T10:43:41.516942+00:00, .research/registry-gate-current-retest.json

**Other remaining work:** Concrete procedure and evidence required before executing each control.


## Testing infrastructure

### Resource admission and owned job lifecycle (EXT-F-0002)

**Role status:** guest: Unverified · member: Fail · admin: Partial. **Cases:** 10. **Controls:** 10.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0073, EXT-D-0079, EXT-D-0083, EXT-D-0101, EXT-D-0107

**Linked defects:** [EXT-D-0025](defects/EXT-D-0025.json) (closed), [EXT-D-0051](defects/EXT-D-0051.json) (closed), [EXT-D-0056](defects/EXT-D-0056.json) (closed), [EXT-D-0060](defects/EXT-D-0060.json) (closed), [EXT-D-0072](defects/EXT-D-0072.json) (closed), [EXT-D-0073](defects/EXT-D-0073.json) (fixed), [EXT-D-0079](defects/EXT-D-0079.json) (in-fix), [EXT-D-0083](defects/EXT-D-0083.json) (fixed), [EXT-D-0098](defects/EXT-D-0098.json) (closed), [EXT-D-0101](defects/EXT-D-0101.json) (fixed), [EXT-D-0102](defects/EXT-D-0102.json) (closed), [EXT-D-0103](defects/EXT-D-0103.json) (closed), [EXT-D-0107](defects/EXT-D-0107.json) (triaged), [EXT-D-0117](defects/EXT-D-0117.json) (closed), [EXT-D-0119](defects/EXT-D-0119.json) (closed), [EXT-D-0122](defects/EXT-D-0122.json) (closed), [EXT-D-0136](defects/EXT-D-0136.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-0002-T01 Unsafe preflight refusal | Unverified | Unverified | Unverified | EXT-F-0002-C01 |
| EXT-F-0002-T02 Single-heavy-job contention | Pass | Pass | Pass | EXT-F-0002-C02 |
| EXT-F-0002-T03 Watchdog stops owned workload | Unverified | Unverified | Unverified | EXT-F-0002-C03 |
| EXT-F-0002-T04 Lease held through owned-work cleanup | Unverified | Unverified | Unverified | EXT-F-0002-C04 |
| EXT-F-0002-T05 Manual browser stop confirmation | Unverified | Unverified | Unverified | EXT-F-0002-C05 |
| EXT-F-0002-T06 Durable browser resource event and terminal proof | Pass | Pass | Pass | EXT-F-0002-C06 |
| EXT-F-0002-T07 Native Chat acceptance distinguishes tool progress from terminal answer | Pass | Unverified | Unverified | EXT-F-0002-C07 |
| EXT-F-0002-T08 Native fixture failure is actionable without exposing sensitive data | Unverified | Fail | Partial | EXT-F-0002-C08 |
| EXT-F-0002-T09 Persistent fixture cleanup survives write, assertion, and extension reload failures | N/A | Partial | Unverified | EXT-F-0002-C09 |
| EXT-F-0002-T10 Authenticated Profile control readiness after reload | N/A | Pass | Unverified | EXT-F-0002-C10 |

**Recorded case details and evidence:**

- EXT-F-0002-T01 · guest: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T01 · member: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T01 · admin: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T02 · guest: Pass. Independent real-guard contender refused, incumbent completed and cleaned up; existing legacy holder remained blocking. No extension behavior or watchdog proof claimed.
  Evidence / build / date recorded: ['docs/stabilization/reports/resource-lock-peer.json', 'docs/stabilization/reports/resource-lock-quality-peer.json']
- EXT-F-0002-T02 · member: Pass. Independent real-guard contender refused, incumbent completed and cleaned up; existing legacy holder remained blocking. No extension behavior or watchdog proof claimed.
  Evidence / build / date recorded: ['docs/stabilization/reports/resource-lock-peer.json', 'docs/stabilization/reports/resource-lock-quality-peer.json']
- EXT-F-0002-T02 · admin: Pass. Independent real-guard contender refused, incumbent completed and cleaned up; existing legacy holder remained blocking. No extension behavior or watchdog proof claimed.
  Evidence / build / date recorded: ['docs/stabilization/reports/resource-lock-peer.json', 'docs/stabilization/reports/resource-lock-quality-peer.json']
- EXT-F-0002-T03 · guest: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T03 · member: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T03 · admin: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T04 · guest: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T04 · member: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T04 · admin: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T05 · guest: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T05 · member: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T05 · admin: Unverified. Historical fixture proof retained; current infrastructure audit requires revalidation after guard repairs before asserting current pass.
  Evidence / build / date recorded: docs/stabilization/reports/infrastructure-coverage-audit.json
- EXT-F-0002-T06 · guest: Pass. Auth-independent infrastructure: D51 closed. Subsequent real Chrome run durable20healthy watches/stop/final exit0; independent writer/refusal/close tests and contained-path checks pass. No claim other infrastructure cases pass.
  Evidence / build / date recorded: showcase-structured-journal-retest-20260928, ['docs/stabilization/reports/showcase-structured-journal-retest.json', 'docs/stabilization/reports/native-guard-finalize-peer.json']
- EXT-F-0002-T06 · member: Pass. Auth-independent infrastructure: D51 closed. Subsequent real Chrome run durable20healthy watches/stop/final exit0; independent writer/refusal/close tests and contained-path checks pass. No claim other infrastructure cases pass.
  Evidence / build / date recorded: showcase-structured-journal-retest-20260928, ['docs/stabilization/reports/showcase-structured-journal-retest.json', 'docs/stabilization/reports/native-guard-finalize-peer.json']
- EXT-F-0002-T06 · admin: Pass. Auth-independent infrastructure: D51 closed. Subsequent real Chrome run durable20healthy watches/stop/final exit0; independent writer/refusal/close tests and contained-path checks pass. No claim other infrastructure cases pass.
  Evidence / build / date recorded: showcase-structured-journal-retest-20260928, ['docs/stabilization/reports/showcase-structured-journal-retest.json', 'docs/stabilization/reports/native-guard-finalize-peer.json']
- EXT-F-0002-T07 · guest: Pass. Oracle-only: four tool resumptions observed before actual completion; wrong terminal content rejected. Ten surrounding helper/collector cases passed. Not a Chat product pass.
  Evidence / build / date recorded: guest-acceptance-final-native-20261001-001, docs/stabilization/reports/guest-acceptance-final-20261001.json
- EXT-F-0002-T08 · guest: Unverified. Native37209834721 has fixed warm_media_controls stage but no failing-pane screenshot/group observation, preventing distinction between rendered-text mismatch and product groups. D122 repair/retest pending.
  Evidence / build / date recorded: .research/scrape-media-capacity-recheck.json
- EXT-F-0002-T08 · member: Fail. Native test-process failure: app re-selection automatically emitted an unmasked accessibility tree containing Store reviewer credentials before redaction. Containment was applied and no credential value is retained in repository evidence. The login was rejected; member identity and Notes setup/operations were never verified. This is an infrastructure failure only; no Notes product failure is claimed.
  Evidence / build / date recorded: notes-member-native-20261002-01, docs/stabilization/reports/notes-member-native-20261002.json
- EXT-F-0002-T08 · admin: Partial. Native A readiness observed zero then one visible/enabled Capture target; successful create completed. New safe exception metadata branches were source reviewed but not forced through native failure.
  Evidence / build / date recorded: saved-capture-escalation-create-20261001-01, docs/stabilization/reports/saved-capture-escalation-verify-20261001.json
- EXT-F-0002-T09 · member: Partial. Realownedrow cleanup restoredoriginalabsence afterwarmwrites andpostfullreloaddriverfailure. Remainingfailurevariants notallnativelytested; sourceguards independentlycoveredstrictprogress/concurrentrefusal.
  Evidence / build / date recorded: profile-member-retest-189-01, .research/profile-member-retest189.json
- EXT-F-0002-T10 · member: Pass. Independent strict full reload observed saved identity/org/token while Account was initially guest, then exact signed-in control appeared under existing readiness bound; all reload cases passed and original absence restored.
  Evidence / build / date recorded: profile-member-final-189-05, 2026-10-04T01:29:17.055381+00:00, ['.research/profile-member-final-189-native.json', 'docs/stabilization/resource-journals/profile-member-final-189-05.jsonl', '.research/profile-escalated-boundary-peer.json']

**Other remaining work:** Concrete procedure and evidence required before executing each control.; EXT-D-0136 closed: startup owner metadata race repaired; independent actual-wrapper retest and hostedCI37245762934 pass. No product coverage promoted.


## Release infrastructure

### Validate and publish exact release candidate (EXT-F-0003)

**Role status:** guest: Unverified · member: Unverified · admin: Unverified. **Cases:** 11. **Controls:** 7.

**Next:** Run the remaining role cases in the extension and attach a result.

**Linked defects:** [EXT-D-0002](defects/EXT-D-0002.json) (closed), [EXT-D-0003](defects/EXT-D-0003.json) (closed), [EXT-D-0004](defects/EXT-D-0004.json) (closed), [EXT-D-0005](defects/EXT-D-0005.json) (closed), [EXT-D-0013](defects/EXT-D-0013.json) (closed), [EXT-D-0016](defects/EXT-D-0016.json) (closed), [EXT-D-0017](defects/EXT-D-0017.json) (closed), [EXT-D-0019](defects/EXT-D-0019.json) (closed), [EXT-D-0020](defects/EXT-D-0020.json) (closed), [EXT-D-0085](defects/EXT-D-0085.json) (closed), [EXT-D-0092](defects/EXT-D-0092.json) (closed), [EXT-D-0116](defects/EXT-D-0116.json) (closed), [EXT-D-0140](defects/EXT-D-0140.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-0003-T01 Refuse red candidate publication | Pass | Pass | Pass | EXT-F-0003-C03 |
| EXT-F-0003-T02 Validate final generated candidate before push | Pass | Pass | Pass | EXT-F-0003-C02 |
| EXT-F-0003-T03 Reconcile concurrent main before candidate assembly | Pass | Pass | Pass | EXT-F-0003-C01 |
| EXT-F-0003-T04 Revalidate after remote race | Pass | Pass | Pass | EXT-F-0003-C04 |
| EXT-F-0003-T05 Serialize checks/build and promote unpacked output | Pass | Pass | Pass | EXT-F-0003-C05 |
| EXT-F-0003-T06 Match commit, tag, zips and bundle receipt | Pass | Pass | Pass | EXT-F-0003-C06 |
| EXT-F-0003-T07 Refuse stale dependency graph before expensive validation | Pass | Pass | Pass | No control mapped |
| EXT-F-0003-T08 Refuse a CI lint-red release candidate | Pass | Pass | Pass | EXT-F-0003-C03 |
| EXT-F-0003-T09 Await asynchronous UI readiness in integration assertions | Unverified | Unverified | Unverified | EXT-F-0003-C03 |
| EXT-F-0003-T10 Settle sidepanel lazy imports before test teardown | Unverified | Unverified | Unverified | No control mapped |
| EXT-F-0003-T11 Main verification survives subsequent evidence pushes | Pass | Pass | Pass | EXT-F-0003-C11 |

**Recorded case details and evidence:**

- EXT-F-0003-T01 · guest: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T01 · member: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T01 · admin: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T02 · guest: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T02 · member: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T02 · admin: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T03 · guest: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T03 · member: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T03 · admin: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T04 · guest: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T04 · member: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T04 · admin: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T05 · guest: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T05 · member: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T05 · admin: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T06 · guest: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T06 · member: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T06 · admin: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T07 · guest: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T07 · member: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T07 · admin: Pass. Auth-independent release pipeline acceptance; exact source/case evidence and limitations in owner adjudication.
  Evidence / build / date recorded: release-stabilization-008, ['docs/stabilization/reports/infrastructure-coverage-audit.json', 'docs/stabilization/reports/infrastructure-owner-adjudication.json', 'docs/stabilization/runs/release-stabilization-008.json']
- EXT-F-0003-T08 · guest: Pass. Auth-independent engineering behavior shared by every mode; actual lint-red refusal and exact-candidate green publication, independently verified by ci-gate-runtime-peer and release018-peer.
- EXT-F-0003-T08 · member: Pass. Auth-independent engineering behavior shared by every mode; actual lint-red refusal and exact-candidate green publication, independently verified by ci-gate-runtime-peer and release018-peer.
- EXT-F-0003-T08 · admin: Pass. Auth-independent engineering behavior shared by every mode; actual lint-red refusal and exact-candidate green publication, independently verified by ci-gate-runtime-peer and release018-peer.
- EXT-F-0003-T11 · guest: Pass. Shared auth-independent CI infrastructure: active main37102258819 and subsequent37102380063 finished successfully despite intervening pushes. Does not certify product or release gate health.
  Evidence / build / date recorded: main-ci-continuity-20261003, ['docs/stabilization/defects/EXT-D-0092.json', '.research/guarded-phases-peer.json']
- EXT-F-0003-T11 · member: Pass. Shared auth-independent CI infrastructure: active main37102258819 and subsequent37102380063 finished successfully despite intervening pushes. Does not certify product or release gate health.
  Evidence / build / date recorded: main-ci-continuity-20261003, ['docs/stabilization/defects/EXT-D-0092.json', '.research/guarded-phases-peer.json']
- EXT-F-0003-T11 · admin: Pass. Shared auth-independent CI infrastructure: active main37102258819 and subsequent37102380063 finished successfully despite intervening pushes. Does not certify product or release gate health.
  Evidence / build / date recorded: main-ci-continuity-20261003, ['docs/stabilization/defects/EXT-D-0092.json', '.research/guarded-phases-peer.json']

**Other remaining work:** Real successful release proven; exhaustive operational feature acceptance still needs per-case evidence reconciliation.; T08 CI lint parity requires the root-owned guarded red/green release fixture before full feature cells can pass.


## Navigation / shell

### Navigate sidepanel tabs and recover inaccessible selection (EXT-F-1001)

**Role status:** guest: Partial · member: Unverified · admin: Partial. **Cases:** 18. **Controls:** 8.

**Next:** Finish the missing criteria and repeat the partial case in the extension.

**Linked defects:** [EXT-D-0001](defects/EXT-D-0001.json) (closed), [EXT-D-0026](defects/EXT-D-0026.json) (closed), [EXT-D-0078](defects/EXT-D-0078.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1001-T01 guest: sidepanel navigation and stale selection | Unverified | N/A | N/A | EXT-F-1001-C01 |
| EXT-F-1001-T02 member: sidepanel navigation and stale selection | N/A | Unverified | N/A | EXT-F-1001-C01 |
| EXT-F-1001-T03 admin: sidepanel navigation and stale selection | N/A | N/A | Unverified | EXT-F-1001-C01 |
| EXT-F-1001-T04 guest: Capture needs-you badge | Unverified | N/A | N/A | EXT-F-1001-C02 |
| EXT-F-1001-T05 member: Capture needs-you badge | N/A | Unverified | N/A | EXT-F-1001-C02 |
| EXT-F-1001-T06 admin: Capture needs-you badge | N/A | N/A | Unverified | EXT-F-1001-C02 |
| EXT-F-1001-T07 guest: Open Vault assistance shortcut | Unverified | N/A | N/A | EXT-F-1001-C03 |
| EXT-F-1001-T08 member: Open Vault assistance shortcut | N/A | Unverified | N/A | EXT-F-1001-C03 |
| EXT-F-1001-T09 admin: Open Vault assistance shortcut | N/A | N/A | Unverified | EXT-F-1001-C03 |
| EXT-F-1001-T10 guest: User avatar | Unverified | N/A | N/A | EXT-F-1001-C04 |
| EXT-F-1001-T11 member: User avatar | N/A | Unverified | N/A | EXT-F-1001-C04 |
| EXT-F-1001-T12 admin: User avatar | N/A | N/A | Unverified | EXT-F-1001-C04 |
| EXT-F-1001-T13 guest: Lazy view load | Pass | N/A | N/A | EXT-F-1001-C05 |
| EXT-F-1001-T14 member: Lazy view load | N/A | Unverified | N/A | EXT-F-1001-C05 |
| EXT-F-1001-T15 admin: Lazy view load | N/A | N/A | Unverified | EXT-F-1001-C05 |
| EXT-F-1001-T16 Shared site access discovery | Partial | Unverified | Partial | EXT-F-1001-C06 |
| EXT-F-1001-T17 Explicit persistent grant and temporary-access preservation | Partial | Unverified | Partial | EXT-F-1001-C07 |
| EXT-F-1001-T18 Explicit reload recovers withheld page action | Partial | Unverified | Partial | EXT-F-1001-C08 |

**Recorded case details and evidence:**

- EXT-F-1001-T03 · admin: Unverified. D26 is repaired, independently retested and closed. Scoped warm navigation passes; persisted selection across role transitions and reload remains unverified, so the full T03 case is not promoted.
  Evidence / build / date recorded: d26-d29-native092, ['docs/stabilization/runs/contained-navigation-dev089-001.json', 'docs/stabilization/runs/contained-navigation-dev089-002.json', 'test-results/contained-navigation-dev089-002.evidence.json', 'docs/stabilization/reports/contained-navigation-dev089-002-peer.json', 'docs/stabilization/defects/EXT-D-0026.json', 'docs/stabilization/runs/d26-d29-native092.json', 'docs/stabilization/reports/auth-integration-peer.json']
- EXT-F-1001-T13 · guest: Pass. pass_original_render_repro_twice
  Evidence / build / date recorded: render-retest-001, docs/stabilization/runs/render-retest-001.json
- EXT-F-1001-T16 · guest: Partial. Fresh guest verified exact-origin Deny/Allow, separate reload and populated IANA SEO; Escape, tab switch, cross-origin navigation, panel reopen and non-HTTP target were exercised. Temporary contains=false access, navigation during permission sheet, stale SEO completion and unsupported permissions API remain unverified.
  Evidence / build / date recorded: site-access-guest-sol-20261002-01, docs/stabilization/reports/site-access-guest-native-20261002.json
- EXT-F-1001-T16 · admin: Partial. Actual Chrome owned profile and loaded175 folder/version verified before/after extension Reload. Withheld Prepare recovered through exact-origin Allow plus separate Reload; fresh Prepare757ms/3steps. Completed Prepare and Snapshot clear on same-URL reload. Admin Deny, controlled late results, failure retry and broad remaining controls unverified.
  Evidence / build / date recorded: siteaccess-prepare-pathchecked-sol-20261002-01, docs/stabilization/reports/siteaccess-prepare-pathchecked-native-20261002.json
- EXT-F-1001-T17 · guest: Partial. Fresh guest verified exact-origin Deny/Allow, separate reload and populated IANA SEO; Escape, tab switch, cross-origin navigation, panel reopen and non-HTTP target were exercised. Temporary contains=false access, navigation during permission sheet, stale SEO completion and unsupported permissions API remain unverified.
  Evidence / build / date recorded: site-access-guest-sol-20261002-01, docs/stabilization/reports/site-access-guest-native-20261002.json
- EXT-F-1001-T17 · admin: Partial. Actual Chrome owned profile and loaded175 folder/version verified before/after extension Reload. Withheld Prepare recovered through exact-origin Allow plus separate Reload; fresh Prepare757ms/3steps. Completed Prepare and Snapshot clear on same-URL reload. Admin Deny, controlled late results, failure retry and broad remaining controls unverified.
  Evidence / build / date recorded: siteaccess-prepare-pathchecked-sol-20261002-01, docs/stabilization/reports/siteaccess-prepare-pathchecked-native-20261002.json
- EXT-F-1001-T18 · guest: Partial. Fresh guest verified exact-origin Deny/Allow, separate reload and populated IANA SEO; Escape, tab switch, cross-origin navigation, panel reopen and non-HTTP target were exercised. Temporary contains=false access, navigation during permission sheet, stale SEO completion and unsupported permissions API remain unverified.
  Evidence / build / date recorded: site-access-guest-sol-20261002-01, docs/stabilization/reports/site-access-guest-native-20261002.json
- EXT-F-1001-T18 · admin: Partial. Actual Chrome owned profile and loaded175 folder/version verified before/after extension Reload. Withheld Prepare recovered through exact-origin Allow plus separate Reload; fresh Prepare757ms/3steps. Completed Prepare and Snapshot clear on same-URL reload. Admin Deny, controlled late results, failure retry and broad remaining controls unverified.
  Evidence / build / date recorded: siteaccess-prepare-pathchecked-sol-20261002-01, docs/stabilization/reports/siteaccess-prepare-pathchecked-native-20261002.json


## Popup / options / mic permission

### Use popup shortcuts and microphone permission entrypoint (EXT-F-1002)

**Role status:** guest: Unverified · member: Unverified · admin: Unverified. **Cases:** 20. **Controls:** 6.

**Next:** Run the remaining role cases in the extension and attach a result.

**Linked defects:** [EXT-D-0008](defects/EXT-D-0008.json) (closed), [EXT-D-0010](defects/EXT-D-0010.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1002-T01 guest: Open chat in unpacked popup | Unverified | N/A | N/A | EXT-F-1002-C01 |
| EXT-F-1002-T02 member: Open chat in unpacked popup | N/A | Unverified | N/A | EXT-F-1002-C01 |
| EXT-F-1002-T03 admin: Open chat in unpacked popup | N/A | N/A | Unverified | EXT-F-1002-C01 |
| EXT-F-1002-T04 guest: Capture page in unpacked popup | Unverified | N/A | N/A | EXT-F-1002-C02 |
| EXT-F-1002-T05 member: Capture page in unpacked popup | N/A | Unverified | N/A | EXT-F-1002-C02 |
| EXT-F-1002-T06 admin: Capture page in unpacked popup | N/A | N/A | Unverified | EXT-F-1002-C02 |
| EXT-F-1002-T07 guest: Sign in | Unverified | N/A | N/A | EXT-F-1002-C03 |
| EXT-F-1002-T08 member: Sign in | N/A | Unverified | N/A | EXT-F-1002-C03 |
| EXT-F-1002-T09 admin: Sign in | N/A | N/A | Unverified | EXT-F-1002-C03 |
| EXT-F-1002-T10 guest: Allow microphone | Unverified | N/A | N/A | EXT-F-1002-C04 |
| EXT-F-1002-T11 member: Allow microphone | N/A | Unverified | N/A | EXT-F-1002-C04 |
| EXT-F-1002-T12 admin: Allow microphone | N/A | N/A | Unverified | EXT-F-1002-C04 |
| EXT-F-1002-T13 guest: Options page | Unverified | N/A | N/A | EXT-F-1002-C05 |
| EXT-F-1002-T14 member: Options page | N/A | Unverified | N/A | EXT-F-1002-C05 |
| EXT-F-1002-T15 admin: Options page | N/A | N/A | Unverified | EXT-F-1002-C05 |
| EXT-F-1002-T16 guest: Store toolbar action opens sidepanel | Unverified | N/A | N/A | EXT-F-1002-C06 |
| EXT-F-1002-T17 member: Store toolbar action opens sidepanel | N/A | Unverified | N/A | EXT-F-1002-C06 |
| EXT-F-1002-T18 admin: Store toolbar action opens sidepanel | N/A | N/A | Unverified | EXT-F-1002-C06 |
| EXT-F-1002-T19 member: Capture page reports launch failure and permits retry | N/A | Unverified | N/A | EXT-F-1002-C02 |
| EXT-F-1002-T20 admin: Capture page reports launch failure and permits retry | N/A | N/A | Unverified | EXT-F-1002-C02 |

**Recorded case details and evidence:**

- EXT-F-1002-T01 · guest: Unverified. Owned isolated CFT setup completed with disclosed temporary WEB_ORIGIN workaround, but native control bound a preexisting shared window; no toolbar input sent, warm/reload cases unverified. D103 tracks canonical startup failure separately.
  Evidence / build / date recorded: popup-owned-toolbar-189-01, .research/popup-owned-toolbar-smoke.json
- EXT-F-1002-T04 · guest: Unverified. Owned isolated CFT setup completed with disclosed temporary WEB_ORIGIN workaround, but native control bound a preexisting shared window; no toolbar input sent, warm/reload cases unverified. D103 tracks canonical startup failure separately.
  Evidence / build / date recorded: popup-owned-toolbar-189-01, .research/popup-owned-toolbar-smoke.json


## Settings

### Review and change extension settings (EXT-F-1003)

**Role status:** guest: Partial · member: Partial · admin: Partial. **Cases:** 92. **Controls:** 39.

**Next:** Finish the missing criteria and repeat the partial case in the extension.

**Linked defects:** [EXT-D-0001](defects/EXT-D-0001.json) (closed), [EXT-D-0006](defects/EXT-D-0006.json) (closed), [EXT-D-0007](defects/EXT-D-0007.json) (closed), [EXT-D-0009](defects/EXT-D-0009.json) (closed), [EXT-D-0011](defects/EXT-D-0011.json) (closed), [EXT-D-0012](defects/EXT-D-0012.json) (closed), [EXT-D-0015](defects/EXT-D-0015.json) (closed), [EXT-D-0084](defects/EXT-D-0084.json) (closed), [EXT-D-0086](defects/EXT-D-0086.json) (closed), [EXT-D-0087](defects/EXT-D-0087.json) (closed), [EXT-D-0093](defects/EXT-D-0093.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1003-T01 guest: Organization selector | Pass | N/A | N/A | EXT-F-1003-C01 |
| EXT-F-1003-T02 member: Organization selector | N/A | Unverified | N/A | EXT-F-1003-C01 |
| EXT-F-1003-T03 admin: Organization selector | N/A | N/A | Pass | EXT-F-1003-C01 |
| EXT-F-1003-T04 guest: Theme | Partial | N/A | N/A | EXT-F-1003-C02 |
| EXT-F-1003-T05 member: Theme | N/A | Partial | N/A | EXT-F-1003-C02 |
| EXT-F-1003-T06 admin: Theme | N/A | N/A | Partial | EXT-F-1003-C02 |
| EXT-F-1003-T07 guest: Default agent | Pass | N/A | N/A | EXT-F-1003-C03 |
| EXT-F-1003-T08 member: Default agent | N/A | Unverified | N/A | EXT-F-1003-C03 |
| EXT-F-1003-T09 admin: Default agent | N/A | N/A | Pass | EXT-F-1003-C03 |
| EXT-F-1003-T10 guest: Default mode | Pass | N/A | N/A | EXT-F-1003-C04 |
| EXT-F-1003-T11 member: Default mode | N/A | Unverified | N/A | EXT-F-1003-C04 |
| EXT-F-1003-T12 admin: Default mode | N/A | N/A | Unverified | EXT-F-1003-C04 |
| EXT-F-1003-T13 guest: Default speed | Pass | N/A | N/A | EXT-F-1003-C05 |
| EXT-F-1003-T14 member: Default speed | N/A | Unverified | N/A | EXT-F-1003-C05 |
| EXT-F-1003-T15 admin: Default speed | N/A | N/A | Pass | EXT-F-1003-C05 |
| EXT-F-1003-T16 guest: Share page identity & email content | Unverified | N/A | N/A | EXT-F-1003-C06 |
| EXT-F-1003-T17 member: Share page identity & email content | N/A | Unverified | N/A | EXT-F-1003-C06 |
| EXT-F-1003-T18 admin: Share page identity & email content | N/A | N/A | Unverified | EXT-F-1003-C06 |
| EXT-F-1003-T19 guest: Offer to save logins to Vault | Unverified | N/A | N/A | EXT-F-1003-C07 |
| EXT-F-1003-T20 member: Offer to save logins to Vault | N/A | Unverified | N/A | EXT-F-1003-C07 |
| EXT-F-1003-T21 admin: Offer to save logins to Vault | N/A | N/A | Unverified | EXT-F-1003-C07 |
| EXT-F-1003-T22 guest: Advanced agent capabilities | Pass | N/A | N/A | EXT-F-1003-C08 |
| EXT-F-1003-T23 member: Advanced agent capabilities | N/A | Unverified | N/A | EXT-F-1003-C08 |
| EXT-F-1003-T24 admin: Advanced agent capabilities | N/A | N/A | Unverified | EXT-F-1003-C08 |
| EXT-F-1003-T25 guest: Audit key access denial | N/A | N/A | N/A | EXT-F-1003-C09 |
| EXT-F-1003-T26 member: Audit key access denial | N/A | Unverified | N/A | EXT-F-1003-C09 |
| EXT-F-1003-T27 admin: Audit key | N/A | N/A | Unverified | EXT-F-1003-C09 |
| EXT-F-1003-T28 guest: Collapsible groups | Pass | N/A | N/A | EXT-F-1003-C10 |
| EXT-F-1003-T29 member: Collapsible groups | N/A | Unverified | N/A | EXT-F-1003-C10 |
| EXT-F-1003-T30 admin: Collapsible groups | N/A | N/A | Pass | EXT-F-1003-C10 |
| EXT-F-1003-T31 guest: Offer saved logins on sign-in forms | Unverified | N/A | N/A | EXT-F-1003-C11 |
| EXT-F-1003-T32 member: Offer saved logins on sign-in forms | N/A | Unverified | N/A | EXT-F-1003-C11 |
| EXT-F-1003-T33 admin: Offer saved logins on sign-in forms | N/A | N/A | Unverified | EXT-F-1003-C11 |
| EXT-F-1003-T34 guest: Show password suggestions on websites | Unverified | N/A | N/A | EXT-F-1003-C12 |
| EXT-F-1003-T35 member: Show password suggestions on websites | N/A | Unverified | N/A | EXT-F-1003-C12 |
| EXT-F-1003-T36 admin: Show password suggestions on websites | N/A | N/A | Unverified | EXT-F-1003-C12 |
| EXT-F-1003-T37 guest: Deep clean | Pass | N/A | N/A | EXT-F-1003-C13 |
| EXT-F-1003-T38 member: Deep clean | N/A | Unverified | N/A | EXT-F-1003-C13 |
| EXT-F-1003-T39 admin: Deep clean | N/A | N/A | Unverified | EXT-F-1003-C13 |
| EXT-F-1003-T40 guest: Auto-scrape on load | Partial | N/A | N/A | EXT-F-1003-C14 |
| EXT-F-1003-T41 member: Auto-scrape on load | N/A | Unverified | N/A | EXT-F-1003-C14 |
| EXT-F-1003-T42 admin: Auto-scrape on load | N/A | N/A | Unverified | EXT-F-1003-C14 |
| EXT-F-1003-T43 guest: Desktop bridge pairing | Partial | N/A | N/A | EXT-F-1003-C15 |
| EXT-F-1003-T44 member: Desktop bridge pairing | N/A | Partial | N/A | EXT-F-1003-C15 |
| EXT-F-1003-T45 admin: Desktop bridge pairing | N/A | N/A | Partial | EXT-F-1003-C15 |
| EXT-F-1003-T46 guest: Desktop engine port | Partial | N/A | N/A | EXT-F-1003-C16 |
| EXT-F-1003-T47 member: Desktop engine port | N/A | Partial | N/A | EXT-F-1003-C16 |
| EXT-F-1003-T48 admin: Desktop engine port | N/A | N/A | Partial | EXT-F-1003-C16 |
| EXT-F-1003-T49 guest: Clear local data | Pass | N/A | N/A | EXT-F-1003-C17 |
| EXT-F-1003-T50 member: Clear local data | N/A | Pass | N/A | EXT-F-1003-C17 |
| EXT-F-1003-T51 admin: Clear local data | N/A | N/A | Pass | EXT-F-1003-C17 |
| EXT-F-1003-T52 guest: Settings sign-in/sign-out | Unverified | N/A | N/A | EXT-F-1003-C18 |
| EXT-F-1003-T53 member: Settings sign-in/sign-out | N/A | Unverified | N/A | EXT-F-1003-C18 |
| EXT-F-1003-T54 admin: Settings sign-in/sign-out | N/A | N/A | Unverified | EXT-F-1003-C18 |
| EXT-F-1003-T55 Required capability: DevTools Protocol | N/A | N/A | Unverified | EXT-F-1003-C19 |
| EXT-F-1003-T56 Optional permission: Cookies | N/A | N/A | Unverified | EXT-F-1003-C20 |
| EXT-F-1003-T57 Optional permission: Page archive (MHTML) | N/A | N/A | Unverified | EXT-F-1003-C21 |
| EXT-F-1003-T58 Optional permission: Clipboard read | N/A | N/A | Pass | EXT-F-1003-C22 |
| EXT-F-1003-T59 Optional permission: Tab video capture | N/A | N/A | Unverified | EXT-F-1003-C23 |
| EXT-F-1003-T60 Audit key export | N/A | N/A | Pass | EXT-F-1003-C24, EXT-F-1003-C38 |
| EXT-F-1003-T61 Audit key re-key confirmation | N/A | N/A | Unverified | EXT-F-1003-C25 |
| EXT-F-1003-T62 Audit receipt origin filters | N/A | N/A | Unverified | EXT-F-1003-C26 |
| EXT-F-1003-T63 Advanced capabilities member denial | Unverified | Unverified | N/A | EXT-F-1003-C27 |
| EXT-F-1003-T64 guest: Ask again for a never-capture site | Unverified | N/A | N/A | EXT-F-1003-C28 |
| EXT-F-1003-T65 member: Ask again for a never-capture site | N/A | Unverified | N/A | EXT-F-1003-C28 |
| EXT-F-1003-T66 admin: Ask again for a never-capture site | N/A | N/A | Unverified | EXT-F-1003-C28 |
| EXT-F-1003-T67 guest: choose both Auto-scrape modes | Pass | N/A | N/A | EXT-F-1003-C29 |
| EXT-F-1003-T68 member: choose both Auto-scrape modes | N/A | Unverified | N/A | EXT-F-1003-C29 |
| EXT-F-1003-T69 admin: choose both Auto-scrape modes | N/A | N/A | Unverified | EXT-F-1003-C29 |
| EXT-F-1003-T70 guest: About browser readiness and extension update status | Unverified | N/A | N/A | EXT-F-1003-C10, EXT-F-1003-C30, EXT-F-1003-C31 |
| EXT-F-1003-T71 member: About browser readiness and extension update status | N/A | Unverified | N/A | EXT-F-1003-C10, EXT-F-1003-C30, EXT-F-1003-C31 |
| EXT-F-1003-T72 admin: About browser readiness and extension update status | N/A | N/A | Unverified | EXT-F-1003-C10, EXT-F-1003-C30, EXT-F-1003-C31 |
| EXT-F-1003-T73 guest: Account identity and role | Unverified | N/A | N/A | EXT-F-1003-C32 |
| EXT-F-1003-T74 member: Account identity and role | N/A | Unverified | N/A | EXT-F-1003-C32 |
| EXT-F-1003-T75 admin: Account identity and role | N/A | N/A | Unverified | EXT-F-1003-C32 |
| EXT-F-1003-T76 guest: Organization archive filter visibility | Unverified | N/A | N/A | EXT-F-1003-C33 |
| EXT-F-1003-T77 member: Organization archive filter | N/A | Unverified | N/A | EXT-F-1003-C33 |
| EXT-F-1003-T78 admin: Organization archive filter | N/A | N/A | Unverified | EXT-F-1003-C33 |
| EXT-F-1003-T79 guest: Desktop bridge status and health | Unverified | N/A | N/A | EXT-F-1003-C34 |
| EXT-F-1003-T80 member: Desktop bridge status and health | N/A | Unverified | N/A | EXT-F-1003-C34 |
| EXT-F-1003-T81 admin: Desktop bridge status and health | N/A | N/A | Unverified | EXT-F-1003-C34 |
| EXT-F-1003-T85 admin: Retry permission status read | N/A | N/A | Unverified | EXT-F-1003-C35 |
| EXT-F-1003-T82 guest: Retry saving preferences | Pass | N/A | N/A | EXT-F-1003-C36 |
| EXT-F-1003-T83 member: Retry saving preferences | N/A | Pass | N/A | EXT-F-1003-C36 |
| EXT-F-1003-T84 admin: Retry saving preferences | N/A | N/A | Pass | EXT-F-1003-C36 |
| EXT-F-1003-T86 Audit details read failure and retry | N/A | N/A | Pass | EXT-F-1003-C09, EXT-F-1003-C37 |
| EXT-F-1003-T87 Audit rotation failure before mutation | N/A | N/A | Pass | EXT-F-1003-C25 |
| EXT-F-1003-T88 Successful rotation with failed details refresh | N/A | N/A | Pass | EXT-F-1003-C25, EXT-F-1003-C37 |
| EXT-F-1003-T89 Audit key late persistence failure | N/A | N/A | Pass | EXT-F-1003-C25, EXT-F-1003-C37 |
| EXT-F-1003-T90 Concurrent audit key rotation preserves receipt verification | N/A | N/A | Pass | EXT-F-1003-C09, EXT-F-1003-C25 |
| EXT-F-1003-T91 Audit storage locking unavailable recovery | N/A | N/A | Pass | EXT-F-1003-C09, EXT-F-1003-C24, EXT-F-1003-C25, EXT-F-1003-C37 |
| EXT-F-1003-T92 Archived organization management link and guest visibility | Unverified | Unverified | Unverified | EXT-F-1003-C39 |

**Recorded case details and evidence:**

- EXT-F-1003-T01 · guest: Pass. Native Chrome guest controls matched all expected criteria warm and after full extension Reload; ID/path/version0.2.51 verified, resource healthy.
  Evidence / build / date recorded: guest-settings-007, docs/stabilization/runs/guest-settings-007.json
- EXT-F-1003-T03 · admin: Pass. Initialunset did not chooseimplicitly; explicitfixture selected, Actingas and fullreload persistence verified. Nonexistent clear-step corrected from source/UI.
  Evidence / build / date recorded: admin-org-001, docs/stabilization/runs/admin-org-001.json
- EXT-F-1003-T04 · guest: Partial. Six native cases: changed Light/System saves, rejected Dark write with visible error/Retry, retry Dark persistence after panel reload, and latest rapid System choice before/after panel reload. Rendered theme appearance and full extension Reload not established by this run.
  Evidence / build / date recorded: hosted-settings-37115406435, ['.research/settings-all-modes-evidence-peer.json', '.research/settings-acceptance-record.json']
- EXT-F-1003-T05 · member: Partial. Six native cases: changed Light/System saves, rejected Dark write with visible error/Retry, retry Dark persistence after panel reload, and latest rapid System choice before/after panel reload. Rendered theme appearance and full extension Reload not established by this run.
  Evidence / build / date recorded: settings-mounted-member-full6-20261003-01, ['.research/settings-all-modes-evidence-peer.json', '.research/settings-mounted-native.json']
- EXT-F-1003-T06 · admin: Partial. Six native cases: changed Light/System saves, rejected Dark write with visible error/Retry, retry Dark persistence after panel reload, and latest rapid System choice before/after panel reload. Rendered theme appearance and full extension Reload not established by this run.
  Evidence / build / date recorded: settings-mounted-admin-full6-20261003-01, ['.research/settings-all-modes-evidence-peer.json', '.research/settings-mounted-native.json']
- EXT-F-1003-T07 · guest: Pass. Native Chrome guest controls matched all expected criteria warm and after full extension Reload; ID/path/version0.2.51 verified, resource healthy.
  Evidence / build / date recorded: guest-settings-007, docs/stabilization/runs/guest-settings-007.json
- EXT-F-1003-T09 · admin: Pass. FreshSol visual+AX/detail reconciled sameQuickTestAgent plus2memberbadge; actualchosenidentity persisted afterfullreload, originalMatrxBrowserAgent restored.
  Evidence / build / date recorded: admin-default-agent-002, docs/stabilization/runs/admin-default-agent-002.json
- EXT-F-1003-T10 · guest: Pass. pass_restored_Ask_before_acting
  Evidence / build / date recorded: render-retest-001, docs/stabilization/runs/render-retest-001.json
- EXT-F-1003-T13 · guest: Pass. pass_restored_Fast
  Evidence / build / date recorded: render-retest-001, docs/stabilization/runs/render-retest-001.json
- EXT-F-1003-T15 · admin: Pass. Actual adminUI on0.2.51; full control criteria includingreload verified, System/Fast/groups restored; resourcehealthy.
  Evidence / build / date recorded: admin-settings-local-001, docs/stabilization/runs/admin-settings-local-001.json
- EXT-F-1003-T16 · guest: Unverified.
  Evidence / build / date recorded: guest-settings-002, docs/stabilization/runs/guest-settings-002.json
- EXT-F-1003-T22 · guest: Pass. Bounded actual guest controls before/after reload; see exact per-criterion observations. Does not exercise D84 rejected storage/retry or D86 overlapping writes. T70 retains unverified branches.
  Evidence / build / date recorded: hosted-settings-37099860144, ['docs/stabilization/runs/hosted-settings-20261003.json', '.research/settings-hosted-retest.json']
- EXT-F-1003-T25 · guest: N/A. Audit key is admin-only: source isAdmin gate and actual guest T22 evidence confirm absence. Negative access remains covered byT22/T63; this does not waive member/direct-state checks.
  Evidence / build / date recorded: ['docs/stabilization/reports/guest-settings-applicability.json', 'docs/stabilization/runs/guest-settings-local-003.json']
- EXT-F-1003-T28 · guest: Pass.
  Evidence / build / date recorded: guest-settings-002, docs/stabilization/runs/guest-settings-002.json
- EXT-F-1003-T30 · admin: Pass. Actual adminUI on0.2.51; full control criteria includingreload verified, System/Fast/groups restored; resourcehealthy.
  Evidence / build / date recorded: admin-settings-local-001, docs/stabilization/runs/admin-settings-local-001.json
- EXT-F-1003-T31 · guest: Unverified.
  Evidence / build / date recorded: guest-settings-002, docs/stabilization/runs/guest-settings-002.json
- EXT-F-1003-T34 · guest: Unverified.
  Evidence / build / date recorded: guest-settings-002, docs/stabilization/runs/guest-settings-002.json
- EXT-F-1003-T37 · guest: Pass. Bounded actual guest controls before/after reload; see exact per-criterion observations. Does not exercise D84 rejected storage/retry or D86 overlapping writes. T70 retains unverified branches.
  Evidence / build / date recorded: hosted-settings-37099860144, ['docs/stabilization/runs/hosted-settings-20261003.json', '.research/settings-hosted-retest.json']
- EXT-F-1003-T40 · guest: Partial. Actual profile and Loaded from path verified before and after reload. Auto-scrape On persisted; no-send context preview displayed Page content/count only. Restored Off and Capture.
  Evidence / build / date recorded: guest-autoscrape-native-20261002-01, docs/stabilization/reports/guest-autoscrape-native-20261002.json
- EXT-F-1003-T43 · guest: Partial.
  Evidence / build / date recorded: desktop-settings-guest-20261003-independent01, ['.research/desktop-settings-independent-native.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T44 · member: Partial.
  Evidence / build / date recorded: desktop-settings-member-20261003-independent01, ['.research/desktop-settings-independent-native.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T45 · admin: Partial.
  Evidence / build / date recorded: desktop-settings-admin-final-20261003-01, ['.research/desktop-settings-admin-final.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T46 · guest: Partial.
  Evidence / build / date recorded: desktop-settings-guest-20261003-independent01, ['.research/desktop-settings-independent-native.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T47 · member: Partial.
  Evidence / build / date recorded: desktop-settings-member-20261003-independent01, ['.research/desktop-settings-independent-native.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T48 · admin: Partial.
  Evidence / build / date recorded: desktop-settings-admin-final-20261003-01, ['.research/desktop-settings-admin-final.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T49 · guest: Pass.
  Evidence / build / date recorded: desktop-settings-guest-20261003-independent01, ['.research/desktop-settings-independent-native.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T50 · member: Pass.
  Evidence / build / date recorded: desktop-settings-member-20261003-independent01, ['.research/desktop-settings-independent-native.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T51 · admin: Pass.
  Evidence / build / date recorded: desktop-settings-admin-final-20261003-01, ['.research/desktop-settings-admin-final.json', '.research/desktop-settings-guard-proof.json', '.research/settings-forget-reset-final.json']
- EXT-F-1003-T55 · admin: Unverified.
  Evidence / build / date recorded: permissions-auth-native-sol, docs/stabilization/runs/permissions-auth-native-sol.json
- EXT-F-1003-T56 · admin: Unverified. All three initialoff restored; on/off and reload verified. Chrome offeredno Cookiesdenialdialog; denialcriterion unverified.
  Evidence / build / date recorded: admin-permissions-001, docs/stabilization/runs/admin-permissions-001.json
- EXT-F-1003-T57 · admin: Unverified.
  Evidence / build / date recorded: permissions-auth-native-sol, docs/stabilization/runs/permissions-auth-native-sol.json
- EXT-F-1003-T58 · admin: Pass. All three initialoff restored; on/off and reload verified. RealChrome deny leftoff andaccept turnedon; allcasecriteria observed.
  Evidence / build / date recorded: admin-permissions-001, docs/stabilization/runs/admin-permissions-001.json
- EXT-F-1003-T59 · admin: Unverified.
  Evidence / build / date recorded: permissions-auth-native-sol, docs/stabilization/runs/permissions-auth-native-sol.json
- EXT-F-1003-T60 · admin: Pass. Actual clipboard rejection rendered failure; explicit retry copied the public JWK without rotating the key.
  Evidence / build / date recorded: audit-final-native-20261003-02, ['.research/audit-final-native.json', '.research/audit-receipts-peer.json']
- EXT-F-1003-T67 · guest: Pass. Capture and Scroll & capture each persisted after full extension Reload. Restored Capture and verified after final reload.
  Evidence / build / date recorded: guest-autoscrape-native-20261002-01, docs/stabilization/reports/guest-autoscrape-native-20261002.json
- EXT-F-1003-T70 · guest: Unverified. Bounded actual guest controls before/after reload; see exact per-criterion observations. Does not exercise D84 rejected storage/retry or D86 overlapping writes. T70 retains unverified branches.
  Evidence / build / date recorded: hosted-settings-37099860144, ['docs/stabilization/runs/hosted-settings-20261003.json', '.research/settings-hosted-retest.json']
- EXT-F-1003-T72 · admin: Unverified.
  Evidence / build / date recorded: release-native-verification, docs/stabilization/runs/release-native-verification.json
- EXT-F-1003-T82 · guest: Pass. Six native cases: changed Light/System saves, rejected Dark write with visible error/Retry, retry Dark persistence after panel reload, and latest rapid System choice before/after panel reload. The actual Retry save control clears the failure and persists the latest choice; no other preference-control coverage inferred.
  Evidence / build / date recorded: hosted-settings-37115406435, ['.research/settings-all-modes-evidence-peer.json', '.research/settings-acceptance-record.json']
- EXT-F-1003-T83 · member: Pass. Six native cases: changed Light/System saves, rejected Dark write with visible error/Retry, retry Dark persistence after panel reload, and latest rapid System choice before/after panel reload. The actual Retry save control clears the failure and persists the latest choice; no other preference-control coverage inferred.
  Evidence / build / date recorded: settings-mounted-member-full6-20261003-01, ['.research/settings-all-modes-evidence-peer.json', '.research/settings-mounted-native.json']
- EXT-F-1003-T84 · admin: Pass. Six native cases: changed Light/System saves, rejected Dark write with visible error/Retry, retry Dark persistence after panel reload, and latest rapid System choice before/after panel reload. The actual Retry save control clears the failure and persists the latest choice; no other preference-control coverage inferred.
  Evidence / build / date recorded: settings-mounted-admin-full6-20261003-01, ['.research/settings-all-modes-evidence-peer.json', '.research/settings-mounted-native.json']
- EXT-F-1003-T86 · admin: Pass. Actual new-document read rejection rendered failure; details retry recovered with zero active-key writes.
  Evidence / build / date recorded: audit-final-native-20261003-02, ['.research/audit-final-native.json', '.research/audit-receipts-peer.json']
- EXT-F-1003-T87 · admin: Pass. Pre-mutation history failure preserved the key; fresh confirmation rotated successfully. The prior product-signed receipt verified and its tampered copy failed.
  Evidence / build / date recorded: audit-final-native-20261003-02, ['.research/audit-final-native.json', '.research/audit-receipts-peer.json']
- EXT-F-1003-T88 · admin: Pass. Successful rotation followed by a failed details refresh remained acknowledged; retry recovered without another rotation.
  Evidence / build / date recorded: audit-final-native-20261003-02, ['.research/audit-final-native.json', '.research/audit-receipts-peer.json']
- EXT-F-1003-T89 · admin: Pass. An uncertain persisted active-key write blocked further mutation until read recovery; the prior genuine receipt verified and its tampered copy failed.
  Evidence / build / date recorded: audit-final-native-20261003-02, ['.research/audit-final-native.json', '.research/audit-receipts-peer.json']
- EXT-F-1003-T90 · admin: Pass. Two same-origin contexts serialized rotations and signing; three distinct product-signed generations verified after both contexts reloaded, and all tampered copies failed. Uses the actual bundled product verifier, not the receipt-dialog UI.
  Evidence / build / date recorded: audit-final-native-20261003-02, ['.research/audit-final-native.json', '.research/audit-receipts-peer.json']
- EXT-F-1003-T91 · admin: Pass. Missing Web Locks at initial audit-card mount in an already authenticated shell disabled mutation and export; restoring capability plus details retry recovered without history mutation. Cold extension/auth-shell startup is not covered.
  Evidence / build / date recorded: audit-final-native-20261003-02, ['.research/audit-final-native.json', '.research/audit-receipts-peer.json']


## Profile

### Edit and persist personal profile (EXT-F-1004)

**Role status:** guest: N/A · member: Partial · admin: Partial. **Cases:** 28. **Controls:** 17.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0095, EXT-D-0108, EXT-D-0110, EXT-D-0111, EXT-D-0114

**Linked defects:** [EXT-D-0094](defects/EXT-D-0094.json) (closed), [EXT-D-0095](defects/EXT-D-0095.json) (fixed), [EXT-D-0104](defects/EXT-D-0104.json) (closed), [EXT-D-0105](defects/EXT-D-0105.json) (closed), [EXT-D-0108](defects/EXT-D-0108.json) (fixed), [EXT-D-0109](defects/EXT-D-0109.json) (closed), [EXT-D-0110](defects/EXT-D-0110.json) (fixed), [EXT-D-0111](defects/EXT-D-0111.json) (fixed), [EXT-D-0114](defects/EXT-D-0114.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1004-T01 member: Back | N/A | Pass | N/A | EXT-F-1004-C01 |
| EXT-F-1004-T02 admin: Back | N/A | N/A | Partial | EXT-F-1004-C01 |
| EXT-F-1004-T03 member: Save / Discard | N/A | Pass | N/A | EXT-F-1004-C02 |
| EXT-F-1004-T04 admin: Save / Discard | N/A | N/A | Partial | EXT-F-1004-C02 |
| EXT-F-1004-T05 member: Identity fields | N/A | Pass | N/A | EXT-F-1004-C03 |
| EXT-F-1004-T06 admin: Identity fields | N/A | N/A | Unverified | EXT-F-1004-C03 |
| EXT-F-1004-T07 member: Phones | N/A | Unverified | N/A | EXT-F-1004-C04 |
| EXT-F-1004-T08 admin: Phones | N/A | N/A | Unverified | EXT-F-1004-C04 |
| EXT-F-1004-T09 member: Emails | N/A | Unverified | N/A | EXT-F-1004-C05 |
| EXT-F-1004-T10 admin: Emails | N/A | N/A | Unverified | EXT-F-1004-C05 |
| EXT-F-1004-T11 member: Web and social handles | N/A | Unverified | N/A | EXT-F-1004-C06 |
| EXT-F-1004-T12 admin: Web and social handles | N/A | N/A | Unverified | EXT-F-1004-C06 |
| EXT-F-1004-T13 member: Shipping address | N/A | Unverified | N/A | EXT-F-1004-C07 |
| EXT-F-1004-T14 admin: Shipping address | N/A | N/A | Unverified | EXT-F-1004-C07 |
| EXT-F-1004-T15 member: Billing address same as shipping | N/A | Unverified | N/A | EXT-F-1004-C08 |
| EXT-F-1004-T16 admin: Billing address same as shipping | N/A | N/A | Unverified | EXT-F-1004-C08 |
| EXT-F-1004-T17 member: Employment | N/A | Pass | N/A | EXT-F-1004-C09 |
| EXT-F-1004-T18 admin: Employment | N/A | N/A | Unverified | EXT-F-1004-C09 |
| EXT-F-1004-T19 member: Emergency contacts | N/A | Unverified | N/A | EXT-F-1004-C10 |
| EXT-F-1004-T20 admin: Emergency contacts | N/A | N/A | Unverified | EXT-F-1004-C10 |
| EXT-F-1004-T21 member: Profile section expanders | N/A | Pass | N/A | EXT-F-1004-C11 |
| EXT-F-1004-T22 admin: Profile section expanders | N/A | N/A | Unverified | EXT-F-1004-C11 |
| EXT-F-1004-T23 guest: verify visibility denial | N/A | N/A | N/A | EXT-F-1004-C12 |
| EXT-F-1004-T24 Email/date native input constraints | N/A | Unverified | Unverified | EXT-F-1004-C13 |
| EXT-F-1004-T25 Profile load failure recovery | N/A | Partial | Partial | EXT-F-1004-C14 |
| EXT-F-1004-T26 Profile save failure and retry | N/A | Partial | Unverified | EXT-F-1004-C15 |
| EXT-F-1004-T27 Backend profile field constraints | N/A | Unverified | Unverified | EXT-F-1004-C16 |
| EXT-F-1004-T28 First profile save names active organization and existing profile stays filed | N/A | Partial | Unverified | EXT-F-1004-C02, EXT-F-1004-C17 |

**Recorded case details and evidence:**

- EXT-F-1004-T01 · member: Pass.
  Evidence / build / date recorded: profile-member-final-189-05, Development0.2.189, source b4b9f0c4efd4e79d9910a7e8dc589f312fe8bced, CI37164174445/artifact11288542496, 2026-10-04T01:29:17.055381+00:00, ['.research/profile-member-final-189-native.json', 'docs/stabilization/resource-journals/profile-member-final-189-05.jsonl']
- EXT-F-1004-T02 · admin: Partial.
  Evidence / build / date recorded: profile-independent-20261003-01, receipt-bound development artifact; CI 37150495327 / artifact 11283802431 / source ac49ac2f, 2026-10-03T20:16:36Z, .research/profile-independent-acceptance.json; docs/stabilization/resource-journals/profile-independent-20261003-01.jsonl
- EXT-F-1004-T03 · member: Pass.
  Evidence / build / date recorded: profile-member-final-189-05, Development0.2.189, source b4b9f0c4efd4e79d9910a7e8dc589f312fe8bced, CI37164174445/artifact11288542496, 2026-10-04T01:29:17.055381+00:00, ['.research/profile-member-final-189-native.json', 'docs/stabilization/resource-journals/profile-member-final-189-05.jsonl']
- EXT-F-1004-T04 · admin: Partial.
  Evidence / build / date recorded: profile-independent-20261003-01, receipt-bound development artifact; CI 37150495327 / artifact 11283802431 / source ac49ac2f, 2026-10-03T20:16:36Z, .research/profile-independent-acceptance.json; docs/stabilization/resource-journals/profile-independent-20261003-01.jsonl
- EXT-F-1004-T05 · member: Pass. Independent frozen189 member run verified actual warm/reload controls, saved-field persistence where applicable, normal UI value restoration and exact original row absence. Root matched raw90c2e27e and journale20fe07c hashes. No latest-main or Store installation claim.
  Evidence / build / date recorded: profile-fields-reload-fixed-189-08, Frozen development189/sourceb4b9f0c4/CI37164174445/artifact11288542496, 2026-10-04T03:52:44.728959+00:00, .research/profile-fields-reload-fixed-native.json
- EXT-F-1004-T17 · member: Pass. Independent frozen189 member run verified actual warm/reload controls, saved-field persistence where applicable, normal UI value restoration and exact original row absence. Root matched raw90c2e27e and journale20fe07c hashes. No latest-main or Store installation claim.
  Evidence / build / date recorded: profile-fields-reload-fixed-189-08, Frozen development189/sourceb4b9f0c4/CI37164174445/artifact11288542496, 2026-10-04T03:52:44.728959+00:00, .research/profile-fields-reload-fixed-native.json
- EXT-F-1004-T21 · member: Pass. Independent frozen189 member run verified actual warm/reload controls, saved-field persistence where applicable, normal UI value restoration and exact original row absence. Root matched raw90c2e27e and journale20fe07c hashes. No latest-main or Store installation claim.
  Evidence / build / date recorded: profile-fields-reload-fixed-189-08, Frozen development189/sourceb4b9f0c4/CI37164174445/artifact11288542496, 2026-10-04T03:52:44.728959+00:00, .research/profile-fields-reload-fixed-native.json
- EXT-F-1004-T22 · admin: Unverified. Billing reexpand runner failed; product outcome unknown, EXT-D-0110. Reload not reached.
  Evidence / build / date recorded: profile-admin-fields-189-06, .research/profile-admin-resource-retest.json
- EXT-F-1004-T25 · member: Partial.
  Evidence / build / date recorded: profile-member-final-189-05, Development0.2.189, source b4b9f0c4efd4e79d9910a7e8dc589f312fe8bced, CI37164174445/artifact11288542496, 2026-10-04T01:29:17.055381+00:00, ['.research/profile-member-final-189-native.json', 'docs/stabilization/resource-journals/profile-member-final-189-05.jsonl']
- EXT-F-1004-T25 · admin: Partial.
  Evidence / build / date recorded: profile-independent-20261003-01, receipt-bound development artifact; CI 37150495327 / artifact 11283802431 / source ac49ac2f, 2026-10-03T20:16:36Z, .research/profile-independent-acceptance.json; docs/stabilization/resource-journals/profile-independent-20261003-01.jsonl
- EXT-F-1004-T26 · member: Partial.
  Evidence / build / date recorded: profile-member-final-189-05, Development0.2.189, source b4b9f0c4efd4e79d9910a7e8dc589f312fe8bced, CI37164174445/artifact11288542496, 2026-10-04T01:29:17.055381+00:00, ['.research/profile-member-final-189-native.json', 'docs/stabilization/resource-journals/profile-member-final-189-05.jsonl']
- EXT-F-1004-T28 · member: Partial.
  Evidence / build / date recorded: profile-member-final-189-05, Development0.2.189, source b4b9f0c4efd4e79d9910a7e8dc589f312fe8bced, CI37164174445/artifact11288542496, 2026-10-04T01:29:17.055381+00:00, ['.research/profile-member-final-189-native.json', 'docs/stabilization/resource-journals/profile-member-final-189-05.jsonl']


## Debug log

### Inspect logs and extension identity (EXT-F-1005)

**Role status:** guest: N/A · member: N/A · admin: Partial. **Cases:** 53. **Controls:** 53.

**Next:** Finish the missing criteria and repeat the partial case in the extension.

**Linked defects:** [EXT-D-0027](defects/EXT-D-0027.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1005-T01 Extension identity copy | N/A | N/A | Unverified | EXT-F-1005-C01 |
| EXT-F-1005-T02 Backend environment selector | N/A | N/A | Unverified | EXT-F-1005-C02 |
| EXT-F-1005-T03 Custom backend URL override | N/A | N/A | Unverified | EXT-F-1005-C03 |
| EXT-F-1005-T04 Backend health ping | N/A | N/A | Unverified | EXT-F-1005-C04 |
| EXT-F-1005-T05 Context shape selector | N/A | N/A | Unverified | EXT-F-1005-C05 |
| EXT-F-1005-T06 Agent overrides panel | N/A | N/A | Unverified | EXT-F-1005-C06 |
| EXT-F-1005-T07 Admin model override picker | N/A | N/A | Unverified | EXT-F-1005-C07 |
| EXT-F-1005-T12 Reset all admin overrides | N/A | N/A | Unverified | EXT-F-1005-C12 |
| EXT-F-1005-T13 Log / Bridges subview tabs | N/A | N/A | Unverified | EXT-F-1005-C13 |
| EXT-F-1005-T14 Log search | N/A | N/A | Pass | EXT-F-1005-C14 |
| EXT-F-1005-T15 Log pause and resume | N/A | N/A | Pass | EXT-F-1005-C15 |
| EXT-F-1005-T16 Copy and download filtered logs | N/A | N/A | Unverified | EXT-F-1005-C16 |
| EXT-F-1005-T17 Clear event log | N/A | N/A | Pass | EXT-F-1005-C17 |
| EXT-F-1005-T18 Verbose console setting | N/A | N/A | Partial | EXT-F-1005-C18 |
| EXT-F-1005-T21 Event tag filters | N/A | N/A | Unverified | EXT-F-1005-C21 |
| EXT-F-1005-T22 Expand event details and empty state | N/A | N/A | Pass | EXT-F-1005-C22 |
| EXT-F-1005-T23 Admin Debug denial | N/A | N/A | N/A | EXT-F-1005-C23 |
| EXT-F-1005-T24 Verify restricted-role denial | N/A | N/A | N/A | EXT-F-1005-C53 |
| EXT-F-1005-T54 Source filter: auth | N/A | N/A | Unverified | EXT-F-1005-C54 |
| EXT-F-1005-T25 Source filter: api | N/A | N/A | Unverified | EXT-F-1005-C24 |
| EXT-F-1005-T26 Source filter: stream | N/A | N/A | Unverified | EXT-F-1005-C25 |
| EXT-F-1005-T27 Source filter: pilot-stream | N/A | N/A | Unverified | EXT-F-1005-C26 |
| EXT-F-1005-T28 Source filter: pilot | N/A | N/A | Unverified | EXT-F-1005-C27 |
| EXT-F-1005-T29 Source filter: scrape | N/A | N/A | Unverified | EXT-F-1005-C28 |
| EXT-F-1005-T30 Source filter: desktop | N/A | N/A | Unverified | EXT-F-1005-C29 |
| EXT-F-1005-T31 Source filter: desktop-ws-offscreen | N/A | N/A | Unverified | EXT-F-1005-C30 |
| EXT-F-1005-T32 Source filter: supabase | N/A | N/A | Unverified | EXT-F-1005-C31 |
| EXT-F-1005-T33 Source filter: frontend-bridge | N/A | N/A | Unverified | EXT-F-1005-C32 |
| EXT-F-1005-T34 Source filter: audio | N/A | N/A | Unverified | EXT-F-1005-C33 |
| EXT-F-1005-T35 Source filter: sw | N/A | N/A | Unverified | EXT-F-1005-C34 |
| EXT-F-1005-T36 Source filter: msg | N/A | N/A | Unverified | EXT-F-1005-C35 |
| EXT-F-1005-T37 Source filter: ui | N/A | N/A | Unverified | EXT-F-1005-C36 |
| EXT-F-1005-T38 Source filter: sys | N/A | N/A | Unverified | EXT-F-1005-C37 |
| EXT-F-1005-T39 Source filters: all | N/A | N/A | Unverified | EXT-F-1005-C38 |
| EXT-F-1005-T40 Source filters: none | N/A | N/A | Unverified | EXT-F-1005-C39 |
| EXT-F-1005-T55 Level filter: info | N/A | N/A | Unverified | EXT-F-1005-C55 |
| EXT-F-1005-T41 Level filter: success | N/A | N/A | Unverified | EXT-F-1005-C40 |
| EXT-F-1005-T42 Level filter: warn | N/A | N/A | Unverified | EXT-F-1005-C41 |
| EXT-F-1005-T43 Level filter: error | N/A | N/A | Unverified | EXT-F-1005-C42 |
| EXT-F-1005-T44 Level filters: all | N/A | N/A | Unverified | EXT-F-1005-C43 |
| EXT-F-1005-T45 Level filters: none | N/A | N/A | Unverified | EXT-F-1005-C44 |
| EXT-F-1005-T56 Admin request flag: debug | N/A | N/A | Unverified | EXT-F-1005-C56 |
| EXT-F-1005-T46 Admin request flag: snapshot | N/A | N/A | Unverified | EXT-F-1005-C45 |
| EXT-F-1005-T47 Admin request flag: block_mode | N/A | N/A | Unverified | EXT-F-1005-C46 |
| EXT-F-1005-T48 Admin request flag: is_version | N/A | N/A | Unverified | EXT-F-1005-C47 |
| EXT-F-1005-T49 Admin request flag: allow_context_create | N/A | N/A | Unverified | EXT-F-1005-C48 |
| EXT-F-1005-T50 Admin request flag: memory | N/A | N/A | Unverified | EXT-F-1005-C49 |
| EXT-F-1005-T57 Iteration limit: max_iterations | N/A | N/A | Unverified | EXT-F-1005-C57 |
| EXT-F-1005-T51 Iteration limit: max_retries_per_iteration | N/A | N/A | Unverified | EXT-F-1005-C50 |
| EXT-F-1005-T58 Memory model override | N/A | N/A | Unverified | EXT-F-1005-C58 |
| EXT-F-1005-T52 Memory scope override | N/A | N/A | Unverified | EXT-F-1005-C51 |
| EXT-F-1005-T59 Raw JSON override: cache_bypass | N/A | N/A | Unverified | EXT-F-1005-C59 |
| EXT-F-1005-T53 Raw JSON override: config_overrides | N/A | N/A | Unverified | EXT-F-1005-C52 |

**Recorded case details and evidence:**

- EXT-F-1005-T13 · admin: Unverified. Switched Log → Bridges → Log. Both selected subviews rendered their intended content; Logs retained its current 113-row state when revisited, while Bridges showed its existing channel and health state. No bridge action was invoked.
  Evidence / build / date recorded: admin-debug-filters-001, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T14 · admin: Pass. Warm Debug 012, reload Debug 011, and service-error Debug 010 each restored the exact ordered visible-row signature sequence after message and natural detail-only searches, accounting for arrivals. T14 case acceptance is supported on release 0.2.79; signatures prove rendered visible rows, not hidden event IDs or detail JSON byte identity.
  Evidence / build / date recorded: debug-log-controls-012, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json', 'docs/stabilization/runs/debug-log-controls-003.json', 'docs/stabilization/runs/debug-log-controls-004.json', 'docs/stabilization/reports/debug-log-controls-003-runtime-peer.json', 'docs/stabilization/reports/debug-log-controls-004-runtime-peer.json', 'docs/stabilization/runs/debug-log-controls-009.json', 'docs/stabilization/reports/debug009-runtime-peer.json', 'docs/stabilization/runs/debug-log-controls-010.json', 'docs/stabilization/reports/debug010-runtime-peer.json', 'docs/stabilization/runs/debug-log-controls-011.json', 'docs/stabilization/reports/debug011-runtime-peer.json', 'docs/stabilization/runs/debug-log-controls-012.json', 'docs/stabilization/reports/debug012-runtime-peer.json']
- EXT-F-1005-T15 · admin: Pass. Pause held 71 visible rows while the total rose to 81 during a real selected-backend outage; Resume then displayed 81. Combined with the accepted warm and real-reload runs, all declared case dimensions pass.
  Evidence / build / date recorded: debug-log-controls-009, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json', 'docs/stabilization/runs/debug-log-controls-003.json', 'docs/stabilization/runs/debug-log-controls-004.json', 'docs/stabilization/reports/debug-log-controls-003-runtime-peer.json', 'docs/stabilization/reports/debug-log-controls-004-runtime-peer.json', 'docs/stabilization/runs/debug-log-controls-009.json', 'docs/stabilization/reports/debug009-runtime-peer.json']
- EXT-F-1005-T16 · admin: Unverified. Verified .90 real trusted Copy all: exact 11 filtered rows of 63 natural rows, Copied feedback and exact 802-byte download; temporary observation permission and prior clipboard restored. Original D27 observation failure resolved. Full case remains unverified because reload and service-error dimensions were not exercised.
  Evidence / build / date recorded: debug-export-dev090-001, ['docs/stabilization/runs/debug-export-dev089-002.json', 'test-results/debug-log-export-9b53131c-e362-401c-8647-4e3d3b0eb28a.json', 'docs/stabilization/reports/debug-seo-dev089-002-peer.json', 'docs/stabilization/runs/debug-export-dev090-001.json', 'docs/stabilization/reports/debug-export-dev090-001-peer.json']
- EXT-F-1005-T17 · admin: Pass. Clear produced zero displayed/total rows and the no-events state during a real selected-backend outage. The pre-clear error badge was present and the reviewed positive predicate confirms it cleared. Combined with accepted warm and reload runs, all declared case dimensions pass.
  Evidence / build / date recorded: ['docs/stabilization/runs/debug-log-controls-003.json', 'docs/stabilization/runs/debug-log-controls-004.json', 'docs/stabilization/reports/debug-log-controls-003-runtime-peer.json', 'docs/stabilization/reports/debug-log-controls-004-runtime-peer.json', 'docs/stabilization/runs/debug-log-controls-009.json', 'docs/stabilization/reports/debug009-runtime-peer.json']
- EXT-F-1005-T18 · admin: Partial. The same natural Bridges Re-discover event was observed on the owned side-panel CDP target with one console match when verbose was on and none when off; setting persistence across real panel reload and restoration also passed. Warning/error invariance, feed behavior after subsequent events/reload, and service-error dimension remain unverified. No full T18 pass.
  Evidence / build / date recorded: debug-export-dev089-002, ['docs/stabilization/runs/debug-export-dev089-002.json', 'test-results/debug-log-export-9b53131c-e362-401c-8647-4e3d3b0eb28a.json', 'docs/stabilization/reports/debug-seo-dev089-002-peer.json', 'docs/stabilization/runs/debug-export-dev090-001.json', 'docs/stabilization/reports/debug-export-dev090-001-peer.json']
- EXT-F-1005-T21 · admin: Unverified. The current event set exposed no event-tag filter row or dynamic tag pills, so all/none and newly observed tag behavior could not be exercised. No event was created to manufacture a tag.
  Evidence / build / date recorded: admin-debug-filters-001, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T22 · admin: Pass. During a real selected-backend outage, a natural detail row expanded/collapsed, a no-detail row remained inert, and no-match/no-events states remained distinct. Combined with accepted warm and reload runs, all declared case dimensions pass.
  Evidence / build / date recorded: debug-log-controls-009, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json', 'docs/stabilization/runs/debug-log-controls-003.json', 'docs/stabilization/runs/debug-log-controls-004.json', 'docs/stabilization/reports/debug-log-controls-003-runtime-peer.json', 'docs/stabilization/reports/debug-log-controls-004-runtime-peer.json', 'docs/stabilization/runs/debug-log-controls-009.json', 'docs/stabilization/reports/debug009-runtime-peer.json']
- EXT-F-1005-T54 · admin: Unverified. The selected auth pill removed two rows and restored the full set when re-enabled.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T25 · admin: Unverified. The selected api pill removed eight rows and restored the full set when re-enabled.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T26 · admin: Unverified. Pill interaction was exercised; no positive stream rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T27 · admin: Unverified. Pill interaction was exercised; no positive pilot-stream rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T28 · admin: Unverified. Pill interaction was exercised; no positive pilot rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T29 · admin: Unverified. The selected scrape pill removed one row and restored the full set when re-enabled.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T30 · admin: Unverified. The selected desktop pill removed 63 rows and restored the full set when re-enabled.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T31 · admin: Unverified. Pill interaction was exercised; no positive matching rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T32 · admin: Unverified. Pill interaction was exercised; no positive matching rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T33 · admin: Unverified. Pill interaction was exercised; no positive matching rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T34 · admin: Unverified. Pill interaction was exercised; no positive matching rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T35 · admin: Unverified. Pill interaction was exercised; no positive matching rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T36 · admin: Unverified. The selected msg pill removed 56 rows and restored the full set when re-enabled.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T37 · admin: Unverified. Pill interaction was exercised; no positive matching rows were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T38 · admin: Unverified. The selected sys pill removed two rows and restored the full set when re-enabled.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T39 · admin: Unverified. Source=all restored all source pills and the 113-row filtered set after the source=none check.
  Evidence / build / date recorded: admin-debug-filters-001, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T40 · admin: Unverified. Source=none deselected all source pills, reduced the row count to 0, and showed ‘No events match the current filter.’
  Evidence / build / date recorded: admin-debug-filters-001, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T55 · admin: Unverified. The selected info pill removed 126 rows and restored the full set when re-enabled.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T41 · admin: Unverified. The selected success pill removed six rows and restored the full set when re-enabled.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T42 · admin: Unverified. Pill interaction was exercised; no positive warn events were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T43 · admin: Unverified. Pill interaction was exercised; no positive error events were available to verify row removal/restoration.
  Evidence / build / date recorded: admin-debug-filter-matrix-001, ['docs/stabilization/runs/admin-debug-filter-matrix-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T44 · admin: Unverified. Level=all showed all four level pills selected and restored the 113-row set.
  Evidence / build / date recorded: admin-debug-filters-001, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']
- EXT-F-1005-T45 · admin: Unverified. Level=none deselected all four level pills, reduced the row count to 0, and showed ‘No events match the current filter.’
  Evidence / build / date recorded: admin-debug-filters-001, ['docs/stabilization/runs/admin-debug-filters-001.json', 'docs/stabilization/reports/debug-acceptance-peer.json']


## Debug bridges

### Inspect and exercise integration bridges (EXT-F-1006)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 30. **Controls:** 30.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0081

**Linked defects:** [EXT-D-0081](defects/EXT-D-0081.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1006-T02 Backend health test ping | N/A | N/A | Unverified | EXT-F-1006-C02 |
| EXT-F-1006-T03 Backend live tool surface and loaded categories | N/A | N/A | Unverified | EXT-F-1006-C03 |
| EXT-F-1006-T04 Desktop rediscovery | N/A | N/A | Unverified | EXT-F-1006-C04 |
| EXT-F-1006-T05 Desktop re-pair confirmation | N/A | N/A | Unverified | EXT-F-1006-C05 |
| EXT-F-1006-T06 Desktop clear port override | N/A | N/A | Unverified | EXT-F-1006-C06 |
| EXT-F-1006-T07 Desktop port override validation | N/A | N/A | Unverified | EXT-F-1006-C07 |
| EXT-F-1006-T09 Desktop HTTP tool selection and call | N/A | N/A | Unverified | EXT-F-1006-C09 |
| EXT-F-1006-T11 Frontend inbound capture | N/A | N/A | Unverified | EXT-F-1006-C11 |
| EXT-F-1006-T13 Frontend broadcast publish validation | N/A | N/A | Unverified | EXT-F-1006-C13 |
| EXT-F-1006-T15 WebMCP tool call | N/A | N/A | Unverified | EXT-F-1006-C15 |
| EXT-F-1006-T16 Register extension tools on page | N/A | N/A | Unverified | EXT-F-1006-C16 |
| EXT-F-1006-T18 Admin Bridges denial | N/A | N/A | N/A | EXT-F-1006-C18 |
| EXT-F-1006-T19 Verify restricted-role denial | N/A | N/A | N/A | EXT-F-1006-C30 |
| EXT-F-1006-T31 Bridge panel: AI Dream backend | N/A | N/A | Unverified | EXT-F-1006-C31 |
| EXT-F-1006-T20 Bridge panel: Matrx Local desktop engine | N/A | N/A | Unverified | EXT-F-1006-C19 |
| EXT-F-1006-T21 Bridge panel: Matrx Frontend | N/A | N/A | Unverified | EXT-F-1006-C20 |
| EXT-F-1006-T22 Bridge panel: WebMCP | N/A | N/A | Unverified | EXT-F-1006-C21 |
| EXT-F-1006-T23 Bridge panel: Combined event log | N/A | N/A | Unverified | EXT-F-1006-C22 |
| EXT-F-1006-T32 Desktop HTTP RPC: Health | N/A | N/A | Unverified | EXT-F-1006-C32 |
| EXT-F-1006-T24 Desktop HTTP RPC: Version | N/A | N/A | Unverified | EXT-F-1006-C23 |
| EXT-F-1006-T25 Desktop HTTP RPC: Capabilities | N/A | N/A | Unverified | EXT-F-1006-C24 |
| EXT-F-1006-T33 WebSocket Connect | N/A | N/A | Unverified | EXT-F-1006-C33 |
| EXT-F-1006-T26 WebSocket Disconnect | N/A | N/A | Unverified | EXT-F-1006-C25 |
| EXT-F-1006-T27 WebSocket Force reconnect | N/A | N/A | Unverified | EXT-F-1006-C26 |
| EXT-F-1006-T34 Frontend Broadcast Connect | N/A | N/A | Unverified | EXT-F-1006-C34 |
| EXT-F-1006-T28 Frontend Broadcast Disconnect | N/A | N/A | Unverified | EXT-F-1006-C27 |
| EXT-F-1006-T35 WebMCP availability | N/A | N/A | Unverified | EXT-F-1006-C35 |
| EXT-F-1006-T29 WebMCP list page tools | N/A | N/A | Unverified | EXT-F-1006-C28 |
| EXT-F-1006-T36 Combined log pause/resume | N/A | N/A | Unverified | EXT-F-1006-C36 |
| EXT-F-1006-T30 Combined log clear | N/A | N/A | Unverified | EXT-F-1006-C29 |


## Scrape

### Capture and manage current page scrape (EXT-F-1007)

**Role status:** guest: Partial · member: Partial · admin: Unverified. **Cases:** 32. **Controls:** 34.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0022, EXT-D-0059, EXT-D-0118, EXT-D-0127, EXT-D-0128, EXT-D-0133, EXT-D-0138, EXT-D-0139

**Linked defects:** [EXT-D-0001](defects/EXT-D-0001.json) (closed), [EXT-D-0018](defects/EXT-D-0018.json) (closed), [EXT-D-0022](defects/EXT-D-0022.json) (fixed), [EXT-D-0059](defects/EXT-D-0059.json) (in-fix), [EXT-D-0115](defects/EXT-D-0115.json) (retest-pass), [EXT-D-0118](defects/EXT-D-0118.json) (fixed), [EXT-D-0122](defects/EXT-D-0122.json) (closed), [EXT-D-0123](defects/EXT-D-0123.json) (retest-pass), [EXT-D-0124](defects/EXT-D-0124.json) (closed), [EXT-D-0125](defects/EXT-D-0125.json) (closed), [EXT-D-0126](defects/EXT-D-0126.json) (closed), [EXT-D-0127](defects/EXT-D-0127.json) (fixed), [EXT-D-0128](defects/EXT-D-0128.json) (fixed), [EXT-D-0129](defects/EXT-D-0129.json) (closed), [EXT-D-0130](defects/EXT-D-0130.json) (closed), [EXT-D-0131](defects/EXT-D-0131.json) (closed), [EXT-D-0132](defects/EXT-D-0132.json) (closed), [EXT-D-0133](defects/EXT-D-0133.json) (fixed), [EXT-D-0135](defects/EXT-D-0135.json) (closed), [EXT-D-0137](defects/EXT-D-0137.json) (closed), [EXT-D-0138](defects/EXT-D-0138.json) (fixed), [EXT-D-0139](defects/EXT-D-0139.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1007-T01 Fast capture | Partial | Partial | Unverified | EXT-F-1007-C01 |
| EXT-F-1007-T02 Deep capture | Partial | Partial | Unverified | EXT-F-1007-C02 |
| EXT-F-1007-T03 Recapture unsaved edits guard | Partial | Unverified | Unverified | EXT-F-1007-C03 |
| EXT-F-1007-T04 Save capture as a Source | Unverified | Unverified | Unverified | EXT-F-1007-C04, EXT-F-1007-C21 |
| EXT-F-1007-T05 Article markdown edit/apply | Unverified | Unverified | Unverified | EXT-F-1007-C05 |
| EXT-F-1007-T06 Article markdown cancel | Pass | Unverified | Unverified | EXT-F-1007-C06 |
| EXT-F-1007-T07 Article scroll sync | Unverified | Unverified | Unverified | EXT-F-1007-C07 |
| EXT-F-1007-T08 Scrape result tabs | Partial | Partial | Unverified | EXT-F-1007-C08 |
| EXT-F-1007-T09 Copy capture and section data | Unverified | Unverified | Unverified | EXT-F-1007-C09 |
| EXT-F-1007-T10 Remove image | Pass | Partial | Unverified | EXT-F-1007-C10 |
| EXT-F-1007-T11 Add image URL validation | Pass | Partial | Unverified | EXT-F-1007-C11 |
| EXT-F-1007-T12 Video actions | Pass | Partial | Unverified | EXT-F-1007-C12 |
| EXT-F-1007-T13 Link actions | Pass | Partial | Unverified | EXT-F-1007-C13 |
| EXT-F-1007-T14 Capture error recovery | Partial | Unverified | Unverified | EXT-F-1007-C14 |
| EXT-F-1007-T15 Admin capture diagnostics gate | Unverified | Unverified | Unverified | EXT-F-1007-C15 |
| EXT-F-1007-T16 Diagnose Missing/Unwanted picker | Unverified | Unverified | Unverified | EXT-F-1007-C16 |
| EXT-F-1007-T17 Diagnose result actions | Unverified | Unverified | Unverified | EXT-F-1007-C17 |
| EXT-F-1007-T18 Highlight regions handoff | Unverified | Unverified | Unverified | EXT-F-1007-C18 |
| EXT-F-1007-T19 Add current page to project | Unverified | Unverified | Unverified | EXT-F-1007-C19 |
| EXT-F-1007-T20 No current capture empty state | Pass | Partial | Unverified | EXT-F-1007-C20 |
| EXT-F-1007-T21 Save a capture as a Source and follow its success state | N/A | Unverified | Unverified | EXT-F-1007-C04, EXT-F-1007-C21 |
| EXT-F-1007-T22 Retain and retry a refused or unreachable save | Unverified | Unverified | Unverified | EXT-F-1007-C04, EXT-F-1007-C22, EXT-F-1007-C23 |
| EXT-F-1007-T23 Discard an unsaved capture only after confirmation | Unverified | Unverified | Unverified | EXT-F-1007-C22, EXT-F-1007-C24 |
| EXT-F-1007-T24 Save edited article text and preserve the original capture | N/A | Unverified | Unverified | EXT-F-1007-C04, EXT-F-1007-C05, EXT-F-1007-C25 |
| EXT-F-1007-T25 Unsaved capture survives closing and reopening the panel | Unverified | Unverified | Unverified | EXT-F-1007-C22, EXT-F-1007-C23, EXT-F-1007-C26 |
| EXT-F-1007-T26 Saved-page lookup failure is not reported as unsaved | Unverified | Unverified | Unverified | EXT-F-1007-C27 |
| EXT-F-1007-T27 Show not-yet-a-Source state with its next action | N/A | Unverified | Unverified | EXT-F-1007-C28 |
| EXT-F-1007-T28 Preserve inline chart, caption and surrounding HTML labels | Unverified | Unverified | Unverified | EXT-F-1007-C01, EXT-F-1007-C02, EXT-F-1007-C08 |
| EXT-F-1007-T29 Optional filing follows Source landing and can be skipped | N/A | Unverified | Unverified | EXT-F-1007-C29, EXT-F-1007-C30, EXT-F-1007-C31 |
| EXT-F-1007-T30 Late save cannot mark another workspace or capture saved | N/A | Unverified | Unverified | EXT-F-1007-C32 |
| EXT-F-1007-T31 Unsaved retry owns the held URL save action | Unverified | Unverified | Unverified | EXT-F-1007-C22, EXT-F-1007-C23, EXT-F-1007-C33 |
| EXT-F-1007-T32 Retry unavailable active page identity without stale capture | Unverified | Unverified | Unverified | EXT-F-1007-C34, EXT-F-1007-C01, EXT-F-1007-C02 |

**Recorded case details and evidence:**

- EXT-F-1007-T01 · guest: Partial. Frozen development244 guest ARM: Fast busy disable and real capture before/after full reload verified. Case expected error recovery is not exhausted; T14 natural recovery remains unverified.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T01 · member: Partial. Headed Chrome verified via actual CDP command line; warm substeps observed. Full extension reload and post-reload capture not yet exercised. Empty-media harness failure stops later acceptance.
  Evidence / build / date recorded: 37263606882, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T04:38:29.178906+00:00, .research/headed-member-native.json
- EXT-F-1007-T02 · guest: Partial. Frozen development244 guest ARM: Warm deep capture and unsaved-edit confirmation verified; deep failure retry and post-reload deep capture remain unverified.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T02 · member: Partial. Headed Chrome verified via actual CDP command line; warm substeps observed. Deep failure retry mode and post-reload deep capture remain unverified. Empty-media harness failure stops later acceptance.
  Evidence / build / date recorded: 37263606882, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T04:38:29.178906+00:00, .research/headed-member-native.json
- EXT-F-1007-T03 · guest: Partial. Trusted exact dialog Cancel retained edited state/idle deep button; second request confirmed Re-capture and deep mode completed. Evidence is native script assertion contract plus subsequent deep result; no separate dialog screenshot. Other auth/mode variants unverified.
  Evidence / build / date recorded: 37222954472, .research/scrape231-recapture-native.json
- EXT-F-1007-T05 · guest: Unverified.
  Evidence / build / date recorded: render-retest-001, docs/stabilization/runs/render-retest-001.json
- EXT-F-1007-T06 · guest: Pass. pass_cancel_discarded_draft_and_recapture_cleanup
  Evidence / build / date recorded: render-retest-001, docs/stabilization/runs/render-retest-001.json
- EXT-F-1007-T08 · guest: Partial. Frozen development244 guest ARM: All six populated panes verified warm and after full reload; image/video empty states verified. Normal600 viewport emulation now observed, but exhaustive per-pane empty-state coverage remains unverified.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T08 · member: Partial. Headed Chrome verified via actual CDP command line; warm substeps observed. Image and video empty states and reload lifecycle need full observation. Empty-media harness failure stops later acceptance.
  Evidence / build / date recorded: 37263606882, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T04:38:29.178906+00:00, .research/headed-member-native.json
- EXT-F-1007-T10 · guest: Pass. Frozen development244 guest ARM: Exact image removals through empty state warm and after full reload verified.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T10 · member: Partial. Headed Chrome verified via actual CDP command line; warm substeps observed. Repeat controls after full extension reload. Empty-media harness failure stops later acceptance.
  Evidence / build / date recorded: 37263606882, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T04:38:29.178906+00:00, .research/headed-member-native.json
- EXT-F-1007-T11 · guest: Pass. Frozen development244 guest ARM: Blank image rejection, valid URL/alt addition and Cancel clearing verified warm and after full reload.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T11 · member: Partial. Headed Chrome verified via actual CDP command line; warm substeps observed. Repeat controls after full extension reload. Empty-media harness failure stops later acceptance.
  Evidence / build / date recorded: 37263606882, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T04:38:29.178906+00:00, .research/headed-member-native.json
- EXT-F-1007-T12 · guest: Pass. Frozen development244 guest ARM: Video Open/return, exact remove/add, blank rejection, Copy feedback and exact clipboard equality after observation-only scoped grant restored; warm and reload verified.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T12 · member: Partial. Headed Chrome verified via actual CDP command line; warm substeps observed. Repeat controls after full extension reload; verify native link and clipboard outcomes. Empty-media harness failure stops later acceptance.
  Evidence / build / date recorded: 37263606882, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T04:38:29.178906+00:00, .research/headed-member-native.json
- EXT-F-1007-T13 · guest: Pass. Frozen development244 guest ARM: Link Open/Copy/remove/blank rejection/add/Cancel verified warm and reload; exact clipboard equality after scoped read grant and permission restoration. Raw partial refers solely to other auth modes, separately unverified.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T13 · member: Partial. Headed Chrome verified via actual CDP command line; warm substeps observed. Repeat controls after full extension reload; guest/admin modes remain unverified by this receipt. Empty-media harness failure stops later acceptance.
  Evidence / build / date recorded: 37263606882, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T04:38:29.178906+00:00, .research/headed-member-native.json
- EXT-F-1007-T14 · guest: Partial. Frozen development244 guest ARM: Restricted-page error/Dismiss verified; natural recoverable Reload/Try again/deep retry remain unverified.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T20 · guest: Pass. Frozen development244 guest ARM: Initial and full-reload empty state verified; original worker/panel retired and exact replacements observed.
  Evidence / build / date recorded: 37251782627, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T01:45:35.094250+00:00, .research/guest-scrape-normal-native.json
- EXT-F-1007-T20 · member: Partial. Headed Chrome verified via actual CDP command line; warm substeps observed. Navigation and reload lifecycle remain to be exercised. Empty-media harness failure stops later acceptance.
  Evidence / build / date recorded: 37263606882, development0.2.244/sourceb8158702/CI37233480033/artifact11315305224, 2026-10-05T04:38:29.178906+00:00, .research/headed-member-native.json

**Other remaining work:** Source landing, refusal/retry, organization authorization, and server persistence require live member/admin evidence; guest Save must show sign-in remedy while retaining the device-local capture. Endpoint/RLS behavior is a runtime readiness gap, not a source-census blocker.; D59 document identity: candidate a021ae82 remains partial; guarded peer a702ba6c passes narrow capture tests/compile but finds mixed-document Diagnose bundle and refresh status race. Native guest/member/admin retest pending; reports/scrape-document-peer.json.


## SEO

### Audit page SEO and manage audit history (EXT-F-1008)

**Role status:** guest: Partial · member: Unverified · admin: Unverified. **Cases:** 14. **Controls:** 14.

**Next:** Finish the missing criteria and repeat the partial case in the extension.

**Linked defects:** [EXT-D-0021](defects/EXT-D-0021.json) (closed), [EXT-D-0076](defects/EXT-D-0076.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1008-T01 Auto-audit on URL navigation | Partial | Unverified | Unverified | EXT-F-1008-C01 |
| EXT-F-1008-T02 Manual audit/re-audit | Partial | Unverified | Unverified | EXT-F-1008-C02 |
| EXT-F-1008-T03 Restricted/unreachable page | Partial | Unverified | Unverified | EXT-F-1008-C03 |
| EXT-F-1008-T04 Save audit and failure recovery | Unverified | Unverified | Unverified | EXT-F-1008-C04 |
| EXT-F-1008-T05 History open/close and saved snapshot | Unverified | Unverified | Unverified | EXT-F-1008-C05 |
| EXT-F-1008-T06 History empty/loading/error states | Unverified | Unverified | Unverified | EXT-F-1008-C06 |
| EXT-F-1008-T07 Copy audit formats and role gate | Partial | Unverified | Unverified | EXT-F-1008-C07 |
| EXT-F-1008-T08 Live versus saved diff/verdict | Unverified | Unverified | Unverified | EXT-F-1008-C08 |
| EXT-F-1008-T09 SEO details and links | Partial | Unverified | Unverified | EXT-F-1008-C09 |
| EXT-F-1008-T10 AI recommendation start/stop/retry | Unverified | Unverified | Unverified | EXT-F-1008-C10 |
| EXT-F-1008-T11 AI recommendation copy/regenerate/agent link | Unverified | Unverified | Unverified | EXT-F-1008-C11 |
| EXT-F-1008-T12 Stage one SEO fix in Chat | Unverified | Unverified | Unverified | EXT-F-1008-C12 |
| EXT-F-1008-T13 Stage all SEO fixes in Chat | Unverified | Unverified | Unverified | EXT-F-1008-C13 |
| EXT-F-1008-T14 Copy missing social meta tags | Unverified | Unverified | Unverified | EXT-F-1008-C14 |

**Recorded case details and evidence:**

- EXT-F-1008-T01 · guest: Partial. Bounded native checks pass on exact CI artifact; full case dimensions remain unverified. Original guest spinner D76 independently retested and closed. One Wikipedia metadata-door candidate unavailable.
  Evidence / build / date recorded: seo-current-ci-20261002-02, ['docs/stabilization/runs/seo-current-ci-20261002-02.json', 'docs/stabilization/reports/seo-native-final-peer-20261002.json']
- EXT-F-1008-T02 · guest: Partial. Bounded native checks pass on exact CI artifact; full case dimensions remain unverified. Original guest spinner D76 independently retested and closed. One Wikipedia metadata-door candidate unavailable.
  Evidence / build / date recorded: seo-current-ci-20261002-02, ['docs/stabilization/runs/seo-current-ci-20261002-02.json', 'docs/stabilization/reports/seo-native-final-peer-20261002.json']
- EXT-F-1008-T03 · guest: Partial. Bounded native checks pass on exact CI artifact; full case dimensions remain unverified. Original guest spinner D76 independently retested and closed. One Wikipedia metadata-door candidate unavailable.
  Evidence / build / date recorded: seo-current-ci-20261002-02, ['docs/stabilization/runs/seo-current-ci-20261002-02.json', 'docs/stabilization/reports/seo-native-final-peer-20261002.json']
- EXT-F-1008-T07 · guest: Partial. Bounded native checks pass on exact CI artifact; full case dimensions remain unverified. Original guest spinner D76 independently retested and closed. One Wikipedia metadata-door candidate unavailable.
  Evidence / build / date recorded: seo-current-ci-20261002-02, ['docs/stabilization/runs/seo-current-ci-20261002-02.json', 'docs/stabilization/reports/seo-native-final-peer-20261002.json']
- EXT-F-1008-T09 · guest: Partial. Bounded native checks pass on exact CI artifact; full case dimensions remain unverified. Original guest spinner D76 independently retested and closed. One Wikipedia metadata-door candidate unavailable.
  Evidence / build / date recorded: seo-current-ci-20261002-02, ['docs/stabilization/runs/seo-current-ci-20261002-02.json', 'docs/stabilization/reports/seo-native-final-peer-20261002.json']


## Screenshots

### Capture, view, copy and delete screenshots (EXT-F-1009)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 9. **Controls:** 9.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0036, EXT-D-0038, EXT-D-0059, EXT-D-0082, EXT-D-0145, EXT-D-0146

**Linked defects:** [EXT-D-0030](defects/EXT-D-0030.json) (closed), [EXT-D-0031](defects/EXT-D-0031.json) (closed), [EXT-D-0032](defects/EXT-D-0032.json) (closed), [EXT-D-0033](defects/EXT-D-0033.json) (closed), [EXT-D-0034](defects/EXT-D-0034.json) (closed), [EXT-D-0035](defects/EXT-D-0035.json) (closed), [EXT-D-0036](defects/EXT-D-0036.json) (fixed), [EXT-D-0037](defects/EXT-D-0037.json) (closed), [EXT-D-0038](defects/EXT-D-0038.json) (fixed), [EXT-D-0059](defects/EXT-D-0059.json) (in-fix), [EXT-D-0082](defects/EXT-D-0082.json) (fixed), [EXT-D-0145](defects/EXT-D-0145.json) (fixed), [EXT-D-0146](defects/EXT-D-0146.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1009-T01 Refresh screenshot gallery | N/A | Unverified | Unverified | EXT-F-1009-C01 |
| EXT-F-1009-T02 Visible screenshot capture | N/A | Unverified | Unverified | EXT-F-1009-C02 |
| EXT-F-1009-T03 Full-page screenshot capture | N/A | Unverified | Unverified | EXT-F-1009-C03 |
| EXT-F-1009-T04 View loaded screenshot locally and open Files | N/A | Unverified | Unverified | EXT-F-1009-C04 |
| EXT-F-1009-T05 Public screenshot sharing and link management | N/A | Unverified | Unverified | EXT-F-1009-C05 |
| EXT-F-1009-T06 Delete screenshot confirmation and outcome | N/A | Unverified | Unverified | EXT-F-1009-C06 |
| EXT-F-1009-T07 Preview lazy-load and failed image | N/A | Unverified | Unverified | EXT-F-1009-C07 |
| EXT-F-1009-T08 Screenshot gallery loading/empty/error states | N/A | Unverified | Unverified | EXT-F-1009-C08 |
| EXT-F-1009-T09 Verify restricted-role denial | N/A | N/A | N/A | EXT-F-1009-C09 |

**Recorded case details and evidence:**

- EXT-F-1009-T01 · admin: Unverified.
  Evidence / build / date recorded: screenshot-controls-dev095-003, docs/stabilization/runs/screenshot-controls-dev095-003.json
- EXT-F-1009-T02 · admin: Unverified.
  Evidence / build / date recorded: screenshot-capture-dev094-002, docs/stabilization/runs/screenshot-capture-dev094-002.json
- EXT-F-1009-T03 · admin: Unverified.
  Evidence / build / date recorded: screenshot-fullpage-dev095-003, docs/stabilization/runs/screenshot-fullpage-dev095-003.json
- EXT-F-1009-T04 · admin: Unverified.
  Evidence / build / date recorded: screenshot-controls-dev095-003, docs/stabilization/runs/screenshot-controls-dev095-003.json
- EXT-F-1009-T05 · admin: Unverified.
  Evidence / build / date recorded: screenshot-controls-dev095-003, docs/stabilization/runs/screenshot-controls-dev095-003.json
- EXT-F-1009-T06 · admin: Unverified.
  Evidence / build / date recorded: screenshot-controls-dev095-003, docs/stabilization/runs/screenshot-controls-dev095-003.json
- EXT-F-1009-T07 · admin: Unverified.
  Evidence / build / date recorded: screenshot-capture-dev094-002, docs/stabilization/runs/screenshot-capture-dev094-002.json
- EXT-F-1009-T08 · admin: Unverified.
  Evidence / build / date recorded: gallery-d37-dev096-001, docs/stabilization/runs/gallery-d37-dev096-001.json
- EXT-F-1009-T09 · guest: N/A. Excluded by source audience registry; negative case confirms inaccessible view.
  Evidence / build / date recorded: screenshot-guest-dev093-002, docs/stabilization/runs/screenshot-guest-dev093-002.json


## Highlights

### Create, attach and route highlights (EXT-F-1010)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 21. **Controls:** 21.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0059

**Linked defects:** [EXT-D-0059](defects/EXT-D-0059.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1010-T01 Enable highlighter overlay | N/A | Unverified | Unverified | EXT-F-1010-C01 |
| EXT-F-1010-T02 Stop highlighter overlay | N/A | Unverified | Unverified | EXT-F-1010-C02 |
| EXT-F-1010-T03 Text highlight capture | N/A | Unverified | Unverified | EXT-F-1010-C03 |
| EXT-F-1010-T04 Element highlight capture | N/A | Unverified | Unverified | EXT-F-1010-C04 |
| EXT-F-1010-T05 Side-panel Text/Element modes | N/A | Unverified | Unverified | EXT-F-1010-C05 |
| EXT-F-1010-T06 Overlay Text/Element modes | N/A | Unverified | Unverified | EXT-F-1010-C06 |
| EXT-F-1010-T07 Clear highlights on this page | N/A | Unverified | Unverified | EXT-F-1010-C07 |
| EXT-F-1010-T08 Overlay stop toolbar control | N/A | Unverified | Unverified | EXT-F-1010-C08 |
| EXT-F-1010-T09 Scope: this page | N/A | Unverified | Unverified | EXT-F-1010-C09 |
| EXT-F-1010-T10 Scope: this site | N/A | Unverified | Unverified | EXT-F-1010-C10 |
| EXT-F-1010-T11 Scope: all highlights | N/A | Unverified | Unverified | EXT-F-1010-C11 |
| EXT-F-1010-T12 Attach one highlight | N/A | Unverified | Unverified | EXT-F-1010-C12 |
| EXT-F-1010-T13 Detach one highlight | N/A | Unverified | Unverified | EXT-F-1010-C13 |
| EXT-F-1010-T14 Clear all attached highlights | N/A | Unverified | Unverified | EXT-F-1010-C14 |
| EXT-F-1010-T15 Open Chat from attachment tray | N/A | Unverified | Unverified | EXT-F-1010-C15 |
| EXT-F-1010-T16 Delete highlight confirmation | N/A | Unverified | Unverified | EXT-F-1010-C16 |
| EXT-F-1010-T17 Attach all visible highlights | N/A | Unverified | Unverified | EXT-F-1010-C17 |
| EXT-F-1010-T18 Send element highlights to Data | N/A | Unverified | Unverified | EXT-F-1010-C18 |
| EXT-F-1010-T19 Send text highlights to Scrape | N/A | Unverified | Unverified | EXT-F-1010-C19 |
| EXT-F-1010-T20 Highlights loading/empty state | N/A | Unverified | Unverified | EXT-F-1010-C20 |
| EXT-F-1010-T21 Restricted audience denial | N/A | N/A | N/A | EXT-F-1010-C21 |


## Guidance

### Create and maintain browser guidance (EXT-F-1011)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 24. **Controls:** 24.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0082

**Linked defects:** [EXT-D-0082](defects/EXT-D-0082.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1011-T01 Open/close Add menu | N/A | Unverified | Unverified | EXT-F-1011-C01 |
| EXT-F-1011-T02 Capture screenshot guidance | N/A | Unverified | Unverified | EXT-F-1011-C02 |
| EXT-F-1011-T03 Start GIF recording | N/A | Unverified | Unverified | EXT-F-1011-C03 |
| EXT-F-1011-T04 Stop and save GIF | N/A | Unverified | Unverified | EXT-F-1011-C04 |
| EXT-F-1011-T05 Discard GIF recording | N/A | Unverified | Unverified | EXT-F-1011-C05 |
| EXT-F-1011-T06 Start demo recording | N/A | Unverified | Unverified | EXT-F-1011-C06 |
| EXT-F-1011-T07 Stop demo recording chip | N/A | Unverified | Unverified | EXT-F-1011-C07 |
| EXT-F-1011-T08 Demo name and description | N/A | Unverified | Unverified | EXT-F-1011-C08 |
| EXT-F-1011-T09 Save demo recording | N/A | Unverified | Unverified | EXT-F-1011-C09 |
| EXT-F-1011-T10 Discard demo recording | N/A | Unverified | Unverified | EXT-F-1011-C10 |
| EXT-F-1011-T11 Note caption and body | N/A | Unverified | Unverified | EXT-F-1011-C11 |
| EXT-F-1011-T12 Save note | N/A | Unverified | Unverified | EXT-F-1011-C12 |
| EXT-F-1011-T13 Cancel note | N/A | Unverified | Unverified | EXT-F-1011-C13 |
| EXT-F-1011-T14 Dismiss guidance error | N/A | Unverified | Unverified | EXT-F-1011-C14 |
| EXT-F-1011-T15 Guidance filters | N/A | Unverified | Unverified | EXT-F-1011-C15 |
| EXT-F-1011-T16 Expand guidance row | N/A | Unverified | Unverified | EXT-F-1011-C16 |
| EXT-F-1011-T17 Delete guidance confirmation | N/A | Unverified | Unverified | EXT-F-1011-C17 |
| EXT-F-1011-T18 Edit note preview | N/A | Unverified | Unverified | EXT-F-1011-C18 |
| EXT-F-1011-T19 Screenshot annotate editor | N/A | Unverified | Unverified | EXT-F-1011-C19 |
| EXT-F-1011-T20 Open guidance screenshot/GIF | N/A | Unverified | Unverified | EXT-F-1011-C20 |
| EXT-F-1011-T21 Replay demo confirmation | N/A | Unverified | Unverified | EXT-F-1011-C21 |
| EXT-F-1011-T22 Demo body missing state | N/A | Unverified | Unverified | EXT-F-1011-C22 |
| EXT-F-1011-T23 Guidance loading/empty state | N/A | Unverified | Unverified | EXT-F-1011-C23 |
| EXT-F-1011-T24 Restricted audience denial | N/A | N/A | N/A | EXT-F-1011-C24 |


## Showcase

### Discover, save and replay site extraction patterns (EXT-F-1012)

**Role status:** guest: N/A · member: N/A · admin: Partial. **Cases:** 60. **Controls:** 50.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0040, EXT-D-0041, EXT-D-0042, EXT-D-0043, EXT-D-0044, EXT-D-0046, EXT-D-0047, EXT-D-0048, EXT-D-0054, EXT-D-0057, EXT-D-0059

**Linked defects:** [EXT-D-0039](defects/EXT-D-0039.json) (closed), [EXT-D-0040](defects/EXT-D-0040.json) (fixed), [EXT-D-0041](defects/EXT-D-0041.json) (fixed), [EXT-D-0042](defects/EXT-D-0042.json) (in-fix), [EXT-D-0043](defects/EXT-D-0043.json) (fixed), [EXT-D-0044](defects/EXT-D-0044.json) (fixed), [EXT-D-0045](defects/EXT-D-0045.json) (closed), [EXT-D-0046](defects/EXT-D-0046.json) (fixed), [EXT-D-0047](defects/EXT-D-0047.json) (in-fix), [EXT-D-0048](defects/EXT-D-0048.json) (fixed), [EXT-D-0049](defects/EXT-D-0049.json) (closed), [EXT-D-0050](defects/EXT-D-0050.json) (closed), [EXT-D-0052](defects/EXT-D-0052.json) (closed), [EXT-D-0053](defects/EXT-D-0053.json) (closed), [EXT-D-0054](defects/EXT-D-0054.json) (fixed), [EXT-D-0055](defects/EXT-D-0055.json) (closed), [EXT-D-0057](defects/EXT-D-0057.json) (fixed), [EXT-D-0058](defects/EXT-D-0058.json) (closed), [EXT-D-0059](defects/EXT-D-0059.json) (in-fix), [EXT-D-0078](defects/EXT-D-0078.json) (closed), [EXT-D-0141](defects/EXT-D-0141.json) (closed), [EXT-D-0142](defects/EXT-D-0142.json) (closed), [EXT-D-0143](defects/EXT-D-0143.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1012-T01 Subtab navigation | N/A | N/A | Unverified | EXT-F-1012-C01 |
| EXT-F-1012-T02 Doctor run | N/A | N/A | Unverified | EXT-F-1012-C02 |
| EXT-F-1012-T03 Doctor copy diagnostic | N/A | N/A | Unverified | EXT-F-1012-C03 |
| EXT-F-1012-T04 Doctor finding navigation | N/A | N/A | Partial | EXT-F-1012-C04 |
| EXT-F-1012-T05 Recipes show all | N/A | N/A | Unverified | EXT-F-1012-C05 |
| EXT-F-1012-T06 Apply recipe | N/A | N/A | Unverified | EXT-F-1012-C06 |
| EXT-F-1012-T07 Prepare option switches | N/A | N/A | Unverified | EXT-F-1012-C07 |
| EXT-F-1012-T08 Run Prepare | N/A | N/A | Partial | EXT-F-1012-C08 |
| EXT-F-1012-T09 Run Snapshot | N/A | N/A | Partial | EXT-F-1012-C09 |
| EXT-F-1012-T10 JSON-LD quick filters | N/A | N/A | Partial | EXT-F-1012-C10 |
| EXT-F-1012-T11 Run JSON-LD extraction | N/A | N/A | Partial | EXT-F-1012-C11 |
| EXT-F-1012-T12 Microdata quick filters | N/A | N/A | Unverified | EXT-F-1012-C12 |
| EXT-F-1012-T13 Run Microdata extraction | N/A | N/A | Unverified | EXT-F-1012-C13 |
| EXT-F-1012-T14 Choose table index | N/A | N/A | Partial | EXT-F-1012-C14 |
| EXT-F-1012-T15 Run table extraction | N/A | N/A | Partial | EXT-F-1012-C15 |
| EXT-F-1012-T16 Framework source selector | N/A | N/A | Unverified | EXT-F-1012-C16 |
| EXT-F-1012-T17 Reload framework tree | N/A | N/A | Unverified | EXT-F-1012-C17 |
| EXT-F-1012-T18 Framework key path query | N/A | N/A | Partial | EXT-F-1012-C18 |
| EXT-F-1012-T19 AI Extract request fields | N/A | N/A | Unverified | EXT-F-1012-C19 |
| EXT-F-1012-T20 Run/cancel AI extraction | N/A | N/A | Unverified | EXT-F-1012-C20 |
| EXT-F-1012-T21 Reset AI pattern | N/A | N/A | Unverified | EXT-F-1012-C21 |
| EXT-F-1012-T22 Save AI pattern | N/A | N/A | Unverified | EXT-F-1012-C22 |
| EXT-F-1012-T23 List Pattern enter/cancel picker | N/A | N/A | Partial | EXT-F-1012-C23 |
| EXT-F-1012-T24 List Pattern picker finish/restart | N/A | N/A | Partial | EXT-F-1012-C24 |
| EXT-F-1012-T25 List Pattern field editor | N/A | N/A | Unverified | EXT-F-1012-C25 |
| EXT-F-1012-T26 List Pattern copy menus | N/A | N/A | Unverified | EXT-F-1012-C26 |
| EXT-F-1012-T27 List Pattern add selector | N/A | N/A | Unverified | EXT-F-1012-C27 |
| EXT-F-1012-T28 List Pattern picker clear/cancel/done | N/A | N/A | Unverified | EXT-F-1012-C28 |
| EXT-F-1012-T29 Run List Pattern | N/A | N/A | Partial | EXT-F-1012-C29 |
| EXT-F-1012-T30 Network capture start/stop | N/A | N/A | Unverified | EXT-F-1012-C30 |
| EXT-F-1012-T31 Network reload and clear | N/A | N/A | Unverified | EXT-F-1012-C31 |
| EXT-F-1012-T32 Network filter and event selection | N/A | N/A | Unverified | EXT-F-1012-C32 |
| EXT-F-1012-T33 Patterns refresh and retry | N/A | N/A | Partial | EXT-F-1012-C33 |
| EXT-F-1012-T34 Rename saved pattern | N/A | N/A | Partial | EXT-F-1012-C34 |
| EXT-F-1012-T35 Delete saved pattern | N/A | N/A | Partial | EXT-F-1012-C35 |
| EXT-F-1012-T36 Run saved pattern | N/A | N/A | Partial | EXT-F-1012-C36 |
| EXT-F-1012-T37 Showcase admin access gate | N/A | N/A | Unverified | EXT-F-1012-C37 |
| EXT-F-1012-T38 Restricted audience denial | N/A | N/A | N/A | EXT-F-1012-C38, EXT-F-1012-C49 |
| EXT-F-1012-T39 manual_css: preview/save/reopen/replay round trip | N/A | N/A | Partial | EXT-F-1012-C39 |
| EXT-F-1012-T40 json_ld: preview/save/reopen/replay round trip | N/A | N/A | Partial | EXT-F-1012-C39 |
| EXT-F-1012-T41 og_meta: preview/save/reopen/replay round trip | N/A | N/A | Partial | EXT-F-1012-C39 |
| EXT-F-1012-T42 auto_table: preview/save/reopen/replay round trip | N/A | N/A | Partial | EXT-F-1012-C39 |
| EXT-F-1012-T43 next_data: preview/save/reopen/replay round trip | N/A | N/A | Partial | EXT-F-1012-C39 |
| EXT-F-1012-T44 ai_extract: preview/save/reopen/replay round trip | N/A | N/A | Unverified | EXT-F-1012-C39 |
| EXT-F-1012-T45 list_pattern: preview/save/reopen/replay round trip | N/A | N/A | Partial | EXT-F-1012-C39 |
| EXT-F-1012-T46 microdata: preview/save/reopen/replay round trip | N/A | N/A | Partial | EXT-F-1012-C39 |
| EXT-F-1012-T47 network_capture: preview/save/reopen/replay round trip | N/A | N/A | Unverified | EXT-F-1012-C39 |
| EXT-F-1012-T48 Saved result destination and explicit append recovery | N/A | N/A | Unverified | EXT-F-1012-C40 |
| EXT-F-1012-T49 Result view/copy and shared execution consumers | N/A | N/A | Partial | EXT-F-1012-C41 |
| EXT-F-1012-T50 Selected Network request matcher survives save and interactive replay | N/A | N/A | Partial | EXT-F-1012-C42 |
| EXT-F-1012-T51 Seeded field picking and nested-list scope selection | N/A | N/A | Partial | EXT-F-1012-C43, EXT-F-1012-C24 |
| EXT-F-1012-T52 Saved pattern route guidance, exact scope and truthful no-match replay | N/A | N/A | Partial | EXT-F-1012-C33, EXT-F-1012-C36, EXT-F-1012-C39 |
| EXT-F-1012-T53 Network exact and explicit URL filter semantics | N/A | N/A | Partial | EXT-F-1012-C42, EXT-F-1012-C44 |
| EXT-F-1012-T54 Network POST payload-bound replay and updated same-request data | N/A | N/A | Unverified | EXT-F-1012-C42, EXT-F-1012-C45 |
| EXT-F-1012-T55 Network ambiguous, late, reloaded and truncated replay outcomes | N/A | N/A | Unverified | EXT-F-1012-C31, EXT-F-1012-C36, EXT-F-1012-C42, EXT-F-1012-C44, EXT-F-1012-C45 |
| EXT-F-1012-T56 Network and Framework literal dotted JSON keys | N/A | N/A | Unverified | EXT-F-1012-C18, EXT-F-1012-C42, EXT-F-1012-C46 |
| EXT-F-1012-T57 Network replay captures initial request and isolates document provenance | N/A | N/A | Unverified | EXT-F-1012-C31, EXT-F-1012-C36, EXT-F-1012-C42, EXT-F-1012-C47 |
| EXT-F-1012-T58 Network saved matcher and name do not retain credential-bearing URLs | N/A | N/A | Partial | EXT-F-1012-C42, EXT-F-1012-C48 |
| EXT-F-1012-T59 Page-load discovery approval, exact save and repeat replay | N/A | N/A | Pass | EXT-F-1012-C49, EXT-F-1012-C39, EXT-F-1012-C36, EXT-F-1012-C45 |
| EXT-F-1012-T60 Saved replay approval host hydration and terminal handling | N/A | N/A | Unverified | EXT-F-1012-C36, EXT-F-1012-C50 |

**Recorded case details and evidence:**

- EXT-F-1012-T04 · admin: Partial.
  Evidence / build / date recorded: showcase-installed-d43-001, docs/stabilization/runs/showcase-installed-d43-001.json
- EXT-F-1012-T08 · admin: Partial. Authenticated native admin on exact imported CI development artifact 0.2.176; all six bounded Prepare cases passed, including held late success/rejection after navigation to a distinct full URL with changed top-frame documentId. Same-origin demo route only. Snapshot on this artifact, remaining T08 controls/dimensions, and Store/public-release acceptance remain unverified.
  Evidence / build / date recorded: prepare-local-native-20261003-08, .research/prepare-native-acceptance-peer.json
- EXT-F-1012-T09 · admin: Partial.
  Evidence / build / date recorded: snapshot-d59-final-peer-20261003-02, ['.research/snapshot-final-native-peer.json', '.research/snapshot-current-native.json']
- EXT-F-1012-T10 · admin: Partial. Type chip and blank/matching/nonexistent filters verified on actual Google Article page. Auth-transition, service-error and broader chips remain unverified.
  Evidence / build / date recorded: showcase-structured-journal-retest-20260928, ['docs/stabilization/reports/showcase-structured-journal-retest.json']
- EXT-F-1012-T11 · admin: Partial. Blank/matching returned current BreadcrumbList; nonexistent shows honest no-match; changed-page live no-JSONLD state verified. Auth/fault dimensions remain unverified.
  Evidence / build / date recorded: showcase-structured-journal-retest-20260928, ['docs/stabilization/reports/showcase-structured-journal-retest.json']
- EXT-F-1012-T14 · admin: Partial. Bounded native9ea6687b PASS: Wikipedia detected3tables; selected/extracted allindices0/1/2, yielding241x6,14x1,2x1 and correct targetlabels. Auth-transition/service-error dimensions remain unverified; fullcase partial.
  Evidence / build / date recorded: showcase-tables-native-20260928, ['docs/stabilization/reports/showcase-tables-native.json', 'docs/stabilization/runs/showcase-tables-native-20260928.json']
- EXT-F-1012-T15 · admin: Partial. Bounded native9ea6687b PASS: sourcevisible World/India population values and6headers match table0; otherindices returned distinctcontents. Real example.org reports No tables and disabled extraction. Auth-transition/service-error and later reloadbehavior unverified; fullcase partial.
  Evidence / build / date recorded: showcase-tables-native-20260928, ['docs/stabilization/reports/showcase-tables-native.json', 'docs/stabilization/runs/showcase-tables-native-20260928.json']
- EXT-F-1012-T18 · admin: Partial. Nuxt decodedsemanticpathreturnsnuxt/nuxt; nativepreview/save/reopen/replay andrefresh pass onexplicitlyReloaded78ff463f; old7.repo clearreselecterror. Alternateframeworksources/auth/serviceerror dimensionsnotfullynativeverified; no wholecasepass.
  Evidence / build / date recorded: showcase-nuxt-admitted-native-retry-20260928-1244, ['docs/stabilization/reports/showcase-nuxt-admitted-native-retry.json', 'docs/stabilization/reports/showcase-nuxt-guarded-peer.json']
- EXT-F-1012-T23 · admin: Partial. The .109 live run entered Pick more fields, restarted the picker, selected a nested candidate, then canceled. Existing outer-list root/item selectors, both fields, and the 249-row preview remained. This is partial evidence for cancel preservation only; general picker entry, other states, reload, and error dimensions remain unverified.
  Evidence / build / date recorded: showcase-installed-d45-001, ['docs/stabilization/runs/showcase-installed-d45-001.json']
- EXT-F-1012-T24 · admin: Partial. The .109 live run exercised Restart and Done. Same-scope Done appended event_datetime while preserving the two existing fields and yielded 249 rows. A changed nested scope with zero fields committed its root/item selectors, left Extract disabled, and cleared the old preview; Cancel retained the original scope and preview. Partial D45 substeps only; the broader picker flow and reload/error dimensions remain unverified. Native37395727468 on frozen0.2.307 now passes genuine old EXIT rejection after A-to-B replacement, B card/field selection, Done,3expected rows/titles, repick overlay Cancel and ordinary page click. D143 closed. Broader scope choices, reload/error dimensions, remaining D42 cases and newer0.2.309 remain unverified; no whole-case promotion.
  Evidence / build / date recorded: showcase-repick-native-37395727468, ['docs/stabilization/runs/showcase-installed-d43-001.json', 'docs/stabilization/runs/showcase-installed-d45-001.json', '.research/showcase-reveal-native.json', 'docs/stabilization/runs/showcase-repick-native-37395727468.json', '.research/showcase-repick-native-final.json']
- EXT-F-1012-T29 · admin: Partial. On the real calendar, extraction of the configured outer event list displayed 249 rows with sampled distinct event titles/localities. Reopened saved List Pattern replay displayed 249 rows with the same first visible samples. On a same-host event-detail route, explicit Run returned no matching data and no rows. The UI showed only the first 200 of 249; source-change, full-row audit, reload, and other failure dimensions remain unverified.
  Evidence / build / date recorded: showcase-installed-d45-001, ['docs/stabilization/runs/showcase-installed-d43-001.json', 'docs/stabilization/runs/showcase-installed-d45-001.json']
- EXT-F-1012-T33 · admin: Partial. Patterns Refresh was clicked after rename and the refreshed list still showed the exact renamed owned recipe. Load-error retry was not exercised, so this is partial evidence for normal refresh only.
  Evidence / build / date recorded: showcase-installed-list-management-001, ['docs/stabilization/runs/showcase-installed-list-management-001.json']
- EXT-F-1012-T34 · admin: Partial. Renamed the exact owned List recipe from “Codex D45 fixture 20260927-2229Z” to “Codex D45 fixture 20260927-2229Z cleanup.” The new title persisted after Patterns Refresh and after leaving/reopening Patterns; its LIST type, OK status, and 249-row last-run summary remained. No-op and Cancel rename paths remain unverified.
  Evidence / build / date recorded: showcase-installed-list-management-001, ['docs/stabilization/runs/showcase-installed-list-management-001.json']
- EXT-F-1012-T35 · admin: Partial. Opened Delete for the exact renamed owned List fixture after confirming its title, LIST type, source calendar route, event_title/locality config, and 249-row result. The dialog named that exact fixture and warned deletion was permanent; Cancel was clicked and the pattern remained in the refreshed/reopened list. Confirmed deletion and absence are not verified; the fixture remains intentionally retained.
  Evidence / build / date recorded: showcase-installed-list-management-001, ['docs/stabilization/runs/showcase-installed-list-management-001.json']
- EXT-F-1012-T36 · admin: Partial. The retained List Pattern was run on its source route and returned 249 rows with matching visible samples. Copy JSON was selected from the product menu, which advertised pretty-printed JSON of all rows, but no success feedback appeared and copied contents were not inspected. The table displayed only 200 rows. Broader run states and output correctness remain unverified.
  Evidence / build / date recorded: showcase-installed-list-management-001, ['docs/stabilization/runs/showcase-installed-d45-001.json', 'docs/stabilization/runs/showcase-installed-list-management-001.json']
- EXT-F-1012-T39 · admin: Partial. Existing native evidence linked to this lifecycle case: real Data field picking, manual_css save with retained exact ID60b0c5bb-b4d4-4642-857a-2924b56445d5, Data refresh/replay and Showcase saved replay preserve the 719594-character field. Later explicitly reloaded native replay binds the actual URL including query/fragment. Draft-change isolation, wrong-route/missing-structure, service-error and broader source-change behavior remain unverified; this is evidence reconciliation, not a new run or whole-case pass.
  Evidence / build / date recorded: data-picker-long-native-20260928-01, ['docs/stabilization/reports/data-picker-long-native.json', 'docs/stabilization/reports/showcase-ai-copy-native-retest.json']
- EXT-F-1012-T40 · admin: Partial. Native JSONLD preview→draftchangedtoNewsArticle→save→leave/reopen→replay preserved executedBreadcrumbList config; exactowned91349863-4a89-4bd5-9248-8785ba1ec3fc. Existing savedJSONLD on404 shows no-match and routeguidance. Service-error remains unverified.
  Evidence / build / date recorded: structured-save-nav-20260928-1201, ['docs/stabilization/reports/showcase-structured-journal-retest.json', 'docs/stabilization/reports/showcase-structured-save-navigation.json']
- EXT-F-1012-T41 · admin: Partial. SavedOG recipe replay verified afterReload onArticle and404 with honestroutewarning/currentfields. Individual metadata compared againstactualpublicHTML source. NewOG save in resource-valid session and service-error/same-route mutation remain unverified; prior oldsave run lacked resourceproof.
  Evidence / build / date recorded: structured-save-nav-20260928-1201, ['docs/stabilization/reports/showcase-structured-journal-retest.json', 'docs/stabilization/reports/showcase-structured-save-navigation.json']
- EXT-F-1012-T42 · admin: Partial. Bounded native9ea6687b PASS: UI preview/save/reopen/replay yields241rows; saved exactrow e6c0a2d9-0786-4a8f-9c7e-d1feb0b8c500 stays table_index0 despite draft1. Manual wrongroute warns explicitly and returns51currentpage rows while saved route/config/count241 remain unchanged. Browser-reload persistence and missing-structure/service-error paths unverified; fullcase partial.
  Evidence / build / date recorded: showcase-tables-native-20260928, ['docs/stabilization/reports/showcase-tables-native.json', 'docs/stabilization/runs/showcase-tables-native-20260928.json']
- EXT-F-1012-T43 · admin: Partial. Nuxt decodedsemanticpathreturnsnuxt/nuxt; nativepreview/save/reopen/replay andrefresh pass onexplicitlyReloaded78ff463f; old7.repo clearreselecterror. Alternateframeworksources/auth/serviceerror dimensionsnotfullynativeverified; no wholecasepass.
  Evidence / build / date recorded: showcase-nuxt-admitted-native-retry-20260928-1244, ['docs/stabilization/reports/showcase-nuxt-admitted-native-retry.json', 'docs/stabilization/reports/showcase-nuxt-guarded-peer.json']
- EXT-F-1012-T45 · admin: Partial. Saved List Pattern recipe “Codex D45 fixture 20260927-2229Z” on /vegas-edm-event-calendar/, left the builder, reopened Patterns, and replayed 249 rows with the same first visible event_title/locality samples. The UI exposed no record ID; 2026-09-27T22:29:53Z is the observed time immediately after “Pattern saved,” not a verified creation timestamp. Fixture remains intentionally retained. Partial: only 200 rows were visible, no reload or changed-source replay was tested, and deletion/cleanup was not tested.
  Evidence / build / date recorded: showcase-installed-d45-001, ['docs/stabilization/runs/showcase-installed-d43-001.json', 'docs/stabilization/runs/showcase-installed-d45-001.json']
- EXT-F-1012-T46 · admin: Partial.
  Evidence / build / date recorded: showcase-live-microdata-001, docs/stabilization/runs/showcase-live-microdata-001.json
- EXT-F-1012-T49 · admin: Partial. Data and Showcase replay preserve the full 719594-character book field in JSON, AI and TSV. D53 and D55 closed: native AI copy includes correct page source URL/kind, including query and fragment after rerun. D54 quote-bearing cells and spreadsheet paste remain open; native Network provenance and broader failure/shared-consumer dimensions remain unverified. Native AFI table TSV pasted into Google Sheets A1:F101 with exact quotation/character cells intact. This resolves the quote-bearing-cell paste gap only; quote-bearing headers, multiline spreadsheet paste and Data quote-case remain unverified.
  Evidence / build / date recorded: data-picker-long-native-20260928-01, ['docs/stabilization/reports/data-picker-long-native.json', 'docs/stabilization/reports/showcase-export-guarded-runtime.json', 'docs/stabilization/reports/showcase-ai-copy-native-retest.json', 'docs/stabilization/reports/tsv-quote-native.json']
- EXT-F-1012-T50 · admin: Partial. On JSONPlaceholder, selected the actual captured 200 GET /todos/1 response, saved its exact URL matcher as an owned Network pattern, left Network for Patterns, and ran it. Pattern Run reloaded the page; after clicking visible Run script, the product matched one request and returned one row with userId=1, id=1, title=delectus aut autem, completed=false, matching the captured preview. Partial same-host interactive GET evidence only; multiple requests, changed source/data, errors and broader reload dimensions remain unverified.
  Evidence / build / date recorded: showcase-installed-d48-network-001, ['docs/stabilization/runs/showcase-installed-d48-network-001.json']
- EXT-F-1012-T51 · admin: Partial. The .109 live run kept the outer #wideeventsList / div.wideeventwrapper scope and existing fields when Canceling a nested-scope pick; same-scope Done appended event_datetime and extracted 249 rows. Explicitly Done-ing a selected nested scope with zero fields adopted that scope and cleared the prior preview. Partial evidence for scope retention, field addition, and scope choice; Doctor-seeded flow, actual extraction from the alternate nested scope, and full rows remain unverified. Native37395727468 on frozen0.2.307 now passes genuine old EXIT rejection after A-to-B replacement, B card/field selection, Done,3expected rows/titles, repick overlay Cancel and ordinary page click. D143 closed. Broader scope choices, reload/error dimensions, remaining D42 cases and newer0.2.309 remain unverified; no whole-case promotion.
  Evidence / build / date recorded: showcase-repick-native-37395727468, ['docs/stabilization/runs/showcase-installed-d43-001.json', 'docs/stabilization/runs/showcase-installed-d45-001.json', '.research/showcase-reveal-native.json', 'docs/stabilization/runs/showcase-repick-native-37395727468.json', '.research/showcase-repick-native-final.json']
- EXT-F-1012-T52 · admin: Partial. On the same-host event-detail route, Patterns showed saved-route applicability guidance while Run remained available. Explicit Run returned the visible no-matching-data message and no rows; the saved card retained its prior OK/249-row health summary. This is partial route-guidance/no-match evidence only. Missing-root broadening elsewhere, Microdata no-match, stale completions, sibling callers, and exact cleanup remain unverified; the owned recipe is intentionally retained because no UI record ID was exposed.
  Evidence / build / date recorded: showcase-installed-d45-001, ['docs/stabilization/runs/showcase-installed-d45-001.json']
- EXT-F-1012-T53 · admin: Partial. The selected GET preview displayed Exact URL mode and explanatory text that exact matching includes query and literal asterisks. A synthetic matcher edit showed credential masking controls, then the original exact noncredential URL was restored before save. No competing requests proved query, numeric path, relative URL or wildcard behavior; partial control/display evidence only.
  Evidence / build / date recorded: showcase-installed-d48-network-001, ['docs/stabilization/runs/showcase-installed-d48-network-001.json']
- EXT-F-1012-T56 · admin: Unverified. Engineering4a997c33 passed wrong-row baseline red,28focusedtests,compile and independent rerun. Current installed9ea6687b includes fix, but Network/Framework exact-key save/reopen/replay native acceptance remains UNVERIFIED. Bounded publictarget researchcd906160 found no verified genuine literal/nested collision; illustrative fixtures and429searchresults were not treated as proof.
  Evidence / build / date recorded: ['docs/stabilization/reports/showcase-d46-implementation.json', 'docs/stabilization/reports/showcase-d46-final-peer.json', 'docs/stabilization/reports/showcase-d46-public-targets.json']
- EXT-F-1012-T57 · admin: Unverified. Independent accepted bounded native evidence: current-first37558902653/frozen0.2.337; old-first37562111314/frozen0.2.338; real public initial capture/save/completed replay and UI cleanup37571487114/frozen0.2.344; stale-only refusal/fresh recovery37582763499/frozen0.2.347; manual-prior native37588499593/frozen0.2.350 with delayed manual server finish and exact current-only saved result. Source higher-old-sequence, manual-channel merge and prior-run binding guards have retained mutants, assertion output, valid resource journals and independent review. Original missing-output qualification is lifted only for those retained runs. Fresh peer93d69b96 accepts bounded native prior-saved retry37600370555 on frozen0.2.354/c53c6e0a/artifact11470764778 with reviewed QA f52c1f74: held saved-run request arrival1 precedes firstfinish2; distinct second context/binding and positive trace; exact second current-only idle saved result and live page before and after HTTP200 release; prior_saved_finished=true and prior_saved_aborted=false. Initial old-document request abort is a separate lifecycle. No old binding callback observed. Three current-run resource journals valid; ownedrecipe removed; both temporary secrets independently absent. FullT57 remains unverified pending whole-case closure audit; no newer-runtime/package acceptance. Original prior-saved37597422020 failed an inverted driver navigation-order assertion; independently diagnosed and repaired, guarded21/21 and fresh source review accepted before retry. Overall panel quiescence, org/mask observations and cancellation are not established; do not promote other cases.
  Evidence / build / date recorded: showcase-d47-prior-saved-native-37600370555-1, ['docs/stabilization/runs/showcase-network-current-001.json', 'docs/stabilization/runs/showcase-d49-native-retest-001.json', 'docs/stabilization/reports/showcase-d49-final-acceptance.json', 'docs/stabilization/reports/showcase-d49-standalone-peer.json', 'docs/stabilization/reports/showcase-request-identity.json', 'docs/stabilization/reports/showcase-discovery-native-acceptance.json', 'docs/stabilization/reports/showcase-d47-current-evidence-peer.json', '.research/d47-root-observer-native-20261007.json', '.research/d47-native-result-peer-20261007.json', '.research/d47-owned-recipe-cleanup-20261007.json', '.research/d47-settled-native-20261007.json', '.research/d47-settled-native-peer-20261007.json', '.research/d47-oldfirst-native-20261007.json', '.research/d47-oldfirst-native-peer-20261007.json', '.research/d47-public-endpoint-native-20261007.json', '.research/d47-public-terminal-peer-20261007.json', '.research/d47-isolation-guards-20261007.json', '.research/d47-isolation-guards-peer-20261007.json', '.research/d47-manual-mutation-repair-20261007.json', '.research/d47-manual-final-peer-20261007.json', '.research/d47-stale-diagnostic-native-20261007.json', '.research/d47-stale-resource-peer-20261007.json', '.research/d47-stale-arm-native-20261007.json', '.research/d47-stale-arm-native-peer-20261007.json', '.research/d47-remaining-isolation-20261007.json', '.research/d47-higher-old-causal-peer-20261007.json', '.research/d47-manual-native-20261007.json', '.research/d47-manual-native-receipt-peer-20261007.json', '.research/d47-manual-prior-oracle-20261007.json', '.research/d47-manual-oracle-final-peer-20261007.json', '.research/d47-manual-priorrun-causal-20261007.json', '.research/d47-manual-priorrun-causal-peer-20261007.json', '.research/d47-prior-saved-native-retest-20261007.json', '.research/d47-prior-saved-retest-peer-20261007.json', '.research/d47-prior-saved-native-diagnosis-20261007.json', '.research/d47-navigation-order-peer-20261007.json']
- EXT-F-1012-T58 · admin: Partial. Using only synthetic credential-shaped query values in the editable matcher, recognized api_key displayed as [credential] with checked disabled recognized-key control. An unfamiliar teamtoken key exposed a user-checkable Treat as credential option and displayed [credential] after selection. Matcher was restored to the observed public noncredential URL before saving; no credential-bearing pattern was persisted or reopened. Partial visible UI control evidence only; safe save/name persistence, rotation and ambiguity remain unverified.
  Evidence / build / date recorded: showcase-installed-d48-network-001, ['docs/stabilization/runs/showcase-installed-d48-network-001.json']
- EXT-F-1012-T59 · admin: Pass. Bounded admin T59 PASS: D49 initial exact capture/save/reopen/two10rowreplays, approval-denial, attached Stop/unmount/navigation/tab-switch cleanup and empty-response recovery passed on8b0f8adc. D50 nativeea12133a on explicitly reloaded9ea6687b repeats10rows with fresh1sage and remounted1mage; source/runtime error handling28tests and mutation proofs pass. D49/D50closed. Native forced metadata failure/exact DBtimestamp unmeasured; broader T57 old-document provenance, other methods and modes remain unverified, no wholefeaturehealth claim.
  Evidence / build / date recorded: showcase-d50-native-20260928, ['docs/stabilization/reports/showcase-initial-discovery-source-peer.json', 'docs/stabilization/reports/showcase-initial-discovery-revised-peer.json', 'docs/stabilization/reports/showcase-discovery-native-acceptance.json', 'docs/stabilization/reports/showcase-discovery-repeat-cleanup.json', 'docs/stabilization/reports/showcase-discovery-active-lifecycle.json', 'docs/stabilization/reports/showcase-discovery-empty-recovery.json', 'docs/stabilization/reports/showcase-run-timestamp-runtime.json', 'docs/stabilization/reports/showcase-run-timestamp-native.json']


## Token broker

### Mint and exercise short-lived broker credentials (EXT-F-1013)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 11. **Controls:** 11.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1013-T01 Audience input | N/A | N/A | Unverified | EXT-F-1013-C01 |
| EXT-F-1013-T02 Tier policy selector | N/A | N/A | Unverified | EXT-F-1013-C02 |
| EXT-F-1013-T04 Mint cached credential | N/A | N/A | Unverified | EXT-F-1013-C04 |
| EXT-F-1013-T05 Mint force fresh credential | N/A | N/A | Unverified | EXT-F-1013-C05 |
| EXT-F-1013-T06 Refresh broker snapshot | N/A | N/A | Unverified | EXT-F-1013-C06 |
| EXT-F-1013-T07 Invalidate cached credential | N/A | N/A | Unverified | EXT-F-1013-C07 |
| EXT-F-1013-T08 Proxied gateway request | N/A | N/A | Unverified | EXT-F-1013-C08 |
| EXT-F-1013-T09 Broker admin denial | N/A | N/A | N/A | EXT-F-1013-C09 |
| EXT-F-1013-T10 Verify restricted-role denial | N/A | N/A | N/A | EXT-F-1013-C11 |
| EXT-F-1013-T12 TTL input | N/A | N/A | Unverified | EXT-F-1013-C12 |
| EXT-F-1013-T11 Model input | N/A | N/A | Unverified | EXT-F-1013-C10 |


## Content-page overlays / context menus / commands

### Use context menu, page overlays and extension commands (EXT-F-1014)

**Role status:** guest: Partial · member: Unverified · admin: Unverified. **Cases:** 19. **Controls:** 19.

**Next:** Finish the missing criteria and repeat the partial case in the extension.

**Linked defects:** [EXT-D-0100](defects/EXT-D-0100.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1014-T01 Ask Matrx about selection menu | Unverified | Unverified | Unverified | EXT-F-1014-C01 |
| EXT-F-1014-T02 Save this site as prospect menu | Unverified | Unverified | Unverified | EXT-F-1014-C02 |
| EXT-F-1014-T03 Save study set menu | Unverified | Unverified | Unverified | EXT-F-1014-C03 |
| EXT-F-1014-T04 Open Matrx side panel menu | Unverified | Unverified | Unverified | EXT-F-1014-C04 |
| EXT-F-1014-T05 Menu registration and reinstallation | Unverified | Unverified | Unverified | EXT-F-1014-C05 |
| EXT-F-1014-T06 Content bridge scrape request | Unverified | Unverified | Unverified | EXT-F-1014-C06 |
| EXT-F-1014-T07 SPA navigation notification | Unverified | Unverified | Unverified | EXT-F-1014-C07 |
| EXT-F-1014-T08 Page scroll subscription | Unverified | Unverified | Unverified | EXT-F-1014-C08 |
| EXT-F-1014-T09 Credential save prompt buttons | Unverified | Unverified | Unverified | EXT-F-1014-C09 |
| EXT-F-1014-T10 Inline saved-login suggestion chooser | Partial | Unverified | Unverified | EXT-F-1014-C10 |
| EXT-F-1014-T11 Inline suggestion keyboard navigation | Unverified | Unverified | Unverified | EXT-F-1014-C11 |
| EXT-F-1014-T12 Highlighter text selector overlay | Unverified | Unverified | Unverified | EXT-F-1014-C12 |
| EXT-F-1014-T13 Highlighter element hover/click | Unverified | Unverified | Unverified | EXT-F-1014-C13 |
| EXT-F-1014-T14 Highlighter overlay clear/stop toolbar | Unverified | Unverified | Unverified | EXT-F-1014-C14 |
| EXT-F-1014-T15 Diagnose picker select/cancel | Unverified | Unverified | Unverified | EXT-F-1014-C15 |
| EXT-F-1014-T16 Data picker candidate controls | Unverified | Unverified | Unverified | EXT-F-1014-C16 |
| EXT-F-1014-T17 List pattern picker controls | Unverified | Unverified | Unverified | EXT-F-1014-C17 |
| EXT-F-1014-T18 WebMCP page bridge protocol | Unverified | Unverified | Unverified | EXT-F-1014-C18 |
| EXT-F-1014-T19 Extension command registration | Unverified | Unverified | Unverified | EXT-F-1014-C19 |

**Recorded case details and evidence:**

- EXT-F-1014-T10 · guest: Partial. D100originalreload/pointerfailure no longerreproduces inexactCIdevelopment189 b4b9f0c4; strictlifecycle andruntimeerrors0→0 verified. Warmchooser/fill, member/admin andotherdimensionsremainunverified.
  Evidence / build / date recorded: d100-native-credential-01, .research/d100-native-acceptance.json


## Profile/auth/org picker

### Authentication and active organization selection (EXT-F-1015)

**Role status:** guest: Unverified · member: Unverified · admin: Unverified. **Cases:** 41. **Controls:** 20.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0069

**Linked defects:** [EXT-D-0029](defects/EXT-D-0029.json) (closed), [EXT-D-0069](defects/EXT-D-0069.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1015-T01 guest: Organization picker appears for held request | Unverified | N/A | N/A | EXT-F-1015-C01 |
| EXT-F-1015-T02 member: Organization picker appears for held request | N/A | Unverified | N/A | EXT-F-1015-C01 |
| EXT-F-1015-T03 admin: Organization picker appears for held request | N/A | N/A | Unverified | EXT-F-1015-C01 |
| EXT-F-1015-T04 member: Organization list loading and retry | N/A | Unverified | N/A | EXT-F-1015-C02 |
| EXT-F-1015-T05 admin: Organization list loading and retry | N/A | N/A | Unverified | EXT-F-1015-C02 |
| EXT-F-1015-T06 member: Select organization | N/A | Unverified | N/A | EXT-F-1015-C03 |
| EXT-F-1015-T07 admin: Select organization | N/A | N/A | Unverified | EXT-F-1015-C03 |
| EXT-F-1015-T08 guest: Picker cannot be dismissed while choice is required | Unverified | N/A | N/A | EXT-F-1015-C04 |
| EXT-F-1015-T09 member: Picker cannot be dismissed while choice is required | N/A | Unverified | N/A | EXT-F-1015-C04 |
| EXT-F-1015-T10 admin: Picker cannot be dismissed while choice is required | N/A | N/A | Unverified | EXT-F-1015-C04 |
| EXT-F-1015-T11 member: No memberships | N/A | Unverified | N/A | EXT-F-1015-C05 |
| EXT-F-1015-T12 admin: No memberships | N/A | N/A | Unverified | EXT-F-1015-C05 |
| EXT-F-1015-T13 guest: Close empty-state picker | Unverified | N/A | N/A | EXT-F-1015-C06 |
| EXT-F-1015-T14 member: Close empty-state picker | N/A | Unverified | N/A | EXT-F-1015-C06 |
| EXT-F-1015-T15 admin: Close empty-state picker | N/A | N/A | Unverified | EXT-F-1015-C06 |
| EXT-F-1015-T16 member: Choose failure | N/A | Unverified | N/A | EXT-F-1015-C07 |
| EXT-F-1015-T17 admin: Choose failure | N/A | N/A | Unverified | EXT-F-1015-C07 |
| EXT-F-1015-T18 guest: External active-org resolution | Unverified | N/A | N/A | EXT-F-1015-C08 |
| EXT-F-1015-T19 member: External active-org resolution | N/A | Unverified | N/A | EXT-F-1015-C08 |
| EXT-F-1015-T20 admin: External active-org resolution | N/A | N/A | Unverified | EXT-F-1015-C08 |
| EXT-F-1015-T21 member: Settings organization selector | N/A | Unverified | N/A | EXT-F-1015-C09 |
| EXT-F-1015-T22 admin: Settings organization selector | N/A | N/A | Unverified | EXT-F-1015-C09 |
| EXT-F-1015-T23 guest: Avatar account menu | Unverified | N/A | N/A | EXT-F-1015-C10 |
| EXT-F-1015-T24 member: Avatar account menu | N/A | Unverified | N/A | EXT-F-1015-C10 |
| EXT-F-1015-T25 admin: Avatar account menu | N/A | N/A | Unverified | EXT-F-1015-C10 |
| EXT-F-1015-T26 member: User-menu Profile route | N/A | Unverified | N/A | EXT-F-1015-C11 |
| EXT-F-1015-T27 admin: User-menu Profile route | N/A | N/A | Unverified | EXT-F-1015-C11 |
| EXT-F-1015-T28 guest: User-menu Preferences route | Unverified | N/A | N/A | EXT-F-1015-C12 |
| EXT-F-1015-T29 member: User-menu Preferences route | N/A | Unverified | N/A | EXT-F-1015-C12 |
| EXT-F-1015-T30 admin: User-menu Preferences route | N/A | N/A | Unverified | EXT-F-1015-C12 |
| EXT-F-1015-T31 member: Sign out from user menu | N/A | Unverified | N/A | EXT-F-1015-C13 |
| EXT-F-1015-T32 admin: Sign out from user menu | N/A | N/A | Unverified | EXT-F-1015-C13 |
| EXT-F-1015-T33 guest: Retry sign-in after auth error | Unverified | N/A | N/A | EXT-F-1015-C14 |
| EXT-F-1015-T34 member: Retry sign-in after auth error | N/A | Unverified | N/A | EXT-F-1015-C14 |
| EXT-F-1015-T35 admin: Retry sign-in after auth error | N/A | N/A | Unverified | EXT-F-1015-C14 |
| EXT-F-1015-T36 Safari sign-in completes through its owned authorization tab | Unverified | N/A | N/A | EXT-F-1015-C15 |
| EXT-F-1015-T37 Safari sign-in cancellation and callback failures remain recoverable | Unverified | N/A | N/A | EXT-F-1015-C14, EXT-F-1015-C16, EXT-F-1015-C17 |
| EXT-F-1015-T38 Organization-required notice retires after selection | N/A | Unverified | Unverified | EXT-F-1015-C18 |
| EXT-F-1015-T39 Persisted admin gate across contexts and storage outages | Unverified | Unverified | Unverified | No control mapped |
| EXT-F-1015-T40 Archived organization cannot be a work target and stale choice requires explicit recovery | N/A | Unverified | Unverified | EXT-F-1015-C03, EXT-F-1015-C09, EXT-F-1015-C19 |
| EXT-F-1015-T41 Archive discovery stays separate from active organization selection | N/A | Unverified | Unverified | EXT-F-1015-C01, EXT-F-1015-C09, EXT-F-1015-C20 |

**Recorded case details and evidence:**

- EXT-F-1015-T35 · admin: Unverified.
  Evidence / build / date recorded: auth-role-failure-dev093-001, docs/stabilization/runs/auth-role-failure-dev093-001.json


## Keyboard commands

### Keyboard shortcut registrations (EXT-F-1016)

**Role status:** guest: N/A · member: N/A · admin: N/A. **Cases:** 1. **Controls:** 1.

**Next:** No outstanding case in this inventory. Recheck after relevant changes.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-1016-T01 Confirm no keyboard commands are registered | N/A | N/A | N/A | EXT-F-1016-C01 |


## Tasks side-panel

### Review and organize scrape task queue (EXT-F-2001)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 7. **Controls:** 55.

**Next:** Add cases for 3 uncovered control(s), then verify them in the extension.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2001-T01 Guest cannot open Tasks | N/A | N/A | N/A | EXT-F-2001-C01, EXT-F-2001-C19, EXT-F-2001-C20, EXT-F-2001-C21, EXT-F-2001-C23 |
| EXT-F-2001-T02 Queue search, project, grouping and sorting | N/A | Unverified | Unverified | EXT-F-2001-C02, EXT-F-2001-C04, EXT-F-2001-C18, EXT-F-2001-C03, EXT-F-2001-C19, EXT-F-2001-C20, EXT-F-2001-C21, EXT-F-2001-C05, EXT-F-2001-C22, EXT-F-2001-C06, EXT-F-2001-C23, EXT-F-2001-C22, EXT-F-2001-C24, EXT-F-2001-C25, EXT-F-2001-C26, EXT-F-2001-C27, EXT-F-2001-C28, EXT-F-2001-C29, EXT-F-2001-C30, EXT-F-2001-C31, EXT-F-2001-C32, EXT-F-2001-C33, EXT-F-2001-C34, EXT-F-2001-C35, EXT-F-2001-C36, EXT-F-2001-C37 |
| EXT-F-2001-T03 Nested queue filters and reset | N/A | Unverified | Unverified | EXT-F-2001-C07, EXT-F-2001-C24, EXT-F-2001-C25, EXT-F-2001-C26, EXT-F-2001-C27, EXT-F-2001-C28, EXT-F-2001-C08, EXT-F-2001-C29, EXT-F-2001-C38, EXT-F-2001-C39, EXT-F-2001-C40, EXT-F-2001-C41, EXT-F-2001-C42, EXT-F-2001-C43, EXT-F-2001-C44, EXT-F-2001-C45, EXT-F-2001-C46, EXT-F-2001-C47 |
| EXT-F-2001-T04 Row selection and bulk action menu | N/A | Unverified | Unverified | EXT-F-2001-C09, EXT-F-2001-C30, EXT-F-2001-C31, EXT-F-2001-C32, EXT-F-2001-C33, EXT-F-2001-C12, EXT-F-2001-C10, EXT-F-2001-C34, EXT-F-2001-C35, EXT-F-2001-C36, EXT-F-2001-C37, EXT-F-2001-C11, EXT-F-2001-C48 |
| EXT-F-2001-T05 Single source open, capture, enrich, and verdict | N/A | Unverified | Unverified | EXT-F-2001-C13, EXT-F-2001-C38, EXT-F-2001-C39, EXT-F-2001-C14, EXT-F-2001-C40, EXT-F-2001-C15, EXT-F-2001-C41, EXT-F-2001-C42, EXT-F-2001-C43, EXT-F-2001-C44, EXT-F-2001-C45, EXT-F-2001-C46, EXT-F-2001-C47, EXT-F-2001-C49, EXT-F-2001-C50, EXT-F-2001-C51, EXT-F-2001-C52 |
| EXT-F-2001-T06 Paste-only source submission | N/A | Unverified | Unverified | EXT-F-2001-C16, EXT-F-2001-C48 |
| EXT-F-2001-T07 Parallel run session inspection and dismissal | N/A | Unverified | Unverified | EXT-F-2001-C17, EXT-F-2001-C49, EXT-F-2001-C50, EXT-F-2001-C51, EXT-F-2001-C52 |

**Controls without a mapped case:** EXT-F-2001-C53 Select all projects; EXT-F-2001-C54 Select all domains; EXT-F-2001-C55 Choose queue sort option

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Tasks capture flow

### Capture and submit a queued page (EXT-F-2002)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 27.

**Next:** Add cases for 2 uncovered control(s), then verify them in the extension.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2002-T01 Capture, continue, paste, retry, and resolve owned queued sources | N/A | Unverified | Unverified | EXT-F-2002-C01, EXT-F-2002-C02, EXT-F-2002-C03, EXT-F-2002-C04, EXT-F-2002-C05, EXT-F-2002-C06, EXT-F-2002-C09, EXT-F-2002-C11, EXT-F-2002-C12, EXT-F-2002-C13, EXT-F-2002-C14, EXT-F-2002-C15, EXT-F-2002-C16, EXT-F-2002-C17, EXT-F-2002-C18, EXT-F-2002-C19, EXT-F-2002-C20, EXT-F-2002-C21, EXT-F-2002-C22, EXT-F-2002-C23, EXT-F-2002-C24, EXT-F-2002-C25, EXT-F-2002-C26, EXT-F-2002-C27, EXT-F-2002-C28 |

**Controls without a mapped case:** EXT-F-2002-C08 Open capture-level picker; EXT-F-2002-C10 Cancel paste-only editor

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.; Disposable member/admin fixture provisioning and cleanup ownership remain unverified; no runtime execution or acceptance is authorized by this source-only procedure update.


## Lists side-panel

### Review conversation plans and task lists (EXT-F-2003)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 6. **Controls:** 36.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2003-T01 Guest cannot open Lists | N/A | N/A | N/A | EXT-F-2003-C01, EXT-F-2003-C13, EXT-F-2003-C14, EXT-F-2003-C15 |
| EXT-F-2003-T02 Expand conversation and open in Chat | N/A | Unverified | Unverified | EXT-F-2003-C01, EXT-F-2003-C13, EXT-F-2003-C14, EXT-F-2003-C15, EXT-F-2003-C16, EXT-F-2003-C17 |
| EXT-F-2003-T03 Wipe confirmation and cancel/confirm | N/A | Unverified | Unverified | EXT-F-2003-C04, EXT-F-2003-C16, EXT-F-2003-C17, EXT-F-2003-C18, EXT-F-2003-C19, EXT-F-2003-C27, EXT-F-2003-C28, EXT-F-2003-C29, EXT-F-2003-C30, EXT-F-2003-C31, EXT-F-2003-C32, EXT-F-2003-C35 |
| EXT-F-2003-T04 Task completion, edit, and removal | N/A | Unverified | Unverified | EXT-F-2003-C06, EXT-F-2003-C05, EXT-F-2003-C18, EXT-F-2003-C09, EXT-F-2003-C19, EXT-F-2003-C28, EXT-F-2003-C07, EXT-F-2003-C29, EXT-F-2003-C30, EXT-F-2003-C10, EXT-F-2003-C20, EXT-F-2003-C21, EXT-F-2003-C22, EXT-F-2003-C23, EXT-F-2003-C33, EXT-F-2003-C34, EXT-F-2003-C36 |
| EXT-F-2003-T05 User todo lifecycle | N/A | Unverified | Unverified | EXT-F-2003-C21, EXT-F-2003-C22, EXT-F-2003-C20, EXT-F-2003-C23, EXT-F-2003-C24, EXT-F-2003-C25, EXT-F-2003-C26 |
| EXT-F-2003-T06 Task panel controls and empty conversation | N/A | Unverified | Unverified | EXT-F-2003-C02, EXT-F-2003-C12, EXT-F-2003-C03, EXT-F-2003-C11, EXT-F-2003-C21, EXT-F-2003-C08, EXT-F-2003-C27, EXT-F-2003-C25, EXT-F-2003-C26, EXT-F-2003-C24 |

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Agenda side-panel

### Create and manage scheduled agenda tasks (EXT-F-2004)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 7. **Controls:** 48.

**Next:** Add cases for 16 uncovered control(s), then verify them in the extension.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2004-T01 Guest cannot open Agenda | N/A | N/A | N/A | EXT-F-2004-C01 |
| EXT-F-2004-T02 Create valid one-shot task and reload | N/A | Unverified | Unverified | EXT-F-2004-C02, EXT-F-2004-C03, EXT-F-2004-C04, EXT-F-2004-C05, EXT-F-2004-C06, EXT-F-2004-C07, EXT-F-2004-C01, EXT-F-2004-C11, EXT-F-2004-C21, EXT-F-2004-C22, EXT-F-2004-C23, EXT-F-2004-C24, EXT-F-2004-C25, EXT-F-2004-C30, EXT-F-2004-C14, EXT-F-2004-C11, EXT-F-2004-C14, EXT-F-2004-C15, EXT-F-2004-C20, EXT-F-2004-C21, EXT-F-2004-C22 |
| EXT-F-2004-T03 Conditional schedule fields and validation | N/A | Unverified | Unverified | EXT-F-2004-C23, EXT-F-2004-C26, EXT-F-2004-C27, EXT-F-2004-C28, EXT-F-2004-C29, EXT-F-2004-C23, EXT-F-2004-C24, EXT-F-2004-C25, EXT-F-2004-C26, EXT-F-2004-C27, EXT-F-2004-C28, EXT-F-2004-C29, EXT-F-2004-C30 |
| EXT-F-2004-T04 Cancel and discard new task | N/A | Unverified | Unverified | EXT-F-2004-C12, EXT-F-2004-C13, EXT-F-2004-C12, EXT-F-2004-C13, EXT-F-2004-C19 |
| EXT-F-2004-T05 Run, pause, and resume existing task | N/A | Unverified | Unverified | EXT-F-2004-C08, EXT-F-2004-C09, EXT-F-2004-C15, EXT-F-2004-C16, EXT-F-2004-C17, EXT-F-2004-C16, EXT-F-2004-C17 |
| EXT-F-2004-T06 Delete task confirmation and cascade | N/A | Unverified | Unverified | EXT-F-2004-C10, EXT-F-2004-C18, EXT-F-2004-C19, EXT-F-2004-C20, EXT-F-2004-C18 |
| EXT-F-2004-T07 Task create carries selected organization or shows recovery remedy | N/A | Unverified | Unverified | EXT-F-2004-C07, EXT-F-2004-C47, EXT-F-2004-C48 |

**Controls without a mapped case:** EXT-F-2004-C31 Choose one-shot trigger; EXT-F-2004-C32 Choose interval trigger; EXT-F-2004-C33 Choose heartbeat trigger; EXT-F-2004-C34 Choose cron trigger; EXT-F-2004-C35 Choose context-match trigger; EXT-F-2004-C36 Choose Ask auth mode; EXT-F-2004-C37 Choose Auto auth mode; EXT-F-2004-C38 Choose Any surface; EXT-F-2004-C39 Choose Chrome extension surface; EXT-F-2004-C40 Choose Desktop surface; EXT-F-2004-C41 Choose Web surface; EXT-F-2004-C42 Choose Mobile surface; EXT-F-2004-C43 Choose Sandbox surface; EXT-F-2004-C44 Observe invalid cron expression; EXT-F-2004-C45 Observe missing context-match condition; EXT-F-2004-C46 Observe new task loading/empty state

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Data side-panel

### Extract structured data from the active page (EXT-F-2005)

**Role status:** guest: Unverified · member: Unverified · admin: Partial. **Cases:** 4. **Controls:** 31.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0054

**Linked defects:** [EXT-D-0053](defects/EXT-D-0053.json) (closed), [EXT-D-0054](defects/EXT-D-0054.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2005-T01 Guest extraction and sign-in save gate | Unverified | N/A | N/A | EXT-F-2005-C14, EXT-F-2005-C15, EXT-F-2005-C16, EXT-F-2005-C03, EXT-F-2005-C12, EXT-F-2005-C13 |
| EXT-F-2005-T02 Matched pattern run, copy variants, and retry | N/A | Unverified | Unverified | EXT-F-2005-C01, EXT-F-2005-C02, EXT-F-2005-C17, EXT-F-2005-C04, EXT-F-2005-C05, EXT-F-2005-C06 |
| EXT-F-2005-T03 Manual field pattern lifecycle and extracted rows | N/A | Unverified | Partial | EXT-F-2005-C14, EXT-F-2005-C15, EXT-F-2005-C03, EXT-F-2005-C12, EXT-F-2005-C11, EXT-F-2005-C07, EXT-F-2005-C08, EXT-F-2005-C09, EXT-F-2005-C10 |
| EXT-F-2005-T04 Non-matching page and active-tab boundary | N/A | Unverified | Unverified | EXT-F-2005-C02, EXT-F-2005-C07 |

**Recorded case details and evidence:**

- EXT-F-2005-T03 · admin: Partial. Actualfieldpicker/manualCSSsave/Data+Showcase replay JSON/AI/TSV preserve719594charbookfield identicalhash; Data refreshreplaypasses. D53closed; D54quotes/spreadsheetpaste open; ShowcaseAIURLmissingD55; broaderauth/cancel/failurestatesunverified.
  Evidence / build / date recorded: data-picker-long-native-20260928-01, ['docs/stabilization/reports/data-picker-long-native.json', 'docs/stabilization/reports/showcase-export-guarded-runtime.json']

**Controls without a mapped case:** EXT-F-2005-C18 Picker hover highlight; EXT-F-2005-C19 Picker click page element; EXT-F-2005-C20 Picker Done; EXT-F-2005-C21 Picker Cancel; EXT-F-2005-C22 Picker Clear; EXT-F-2005-C23 Copy saved pattern Selectors text; EXT-F-2005-C24 Copy saved pattern For AI agent; EXT-F-2005-C25 Copy saved pattern Full JSON admin option; EXT-F-2005-C26 Copy extracted rows TSV; EXT-F-2005-C27 Copy extracted rows JSON; EXT-F-2005-C28 Copy extracted rows For AI agent; EXT-F-2005-C29 Observe auto extraction running; EXT-F-2005-C30 Observe auto extraction success; EXT-F-2005-C31 Observe auto extraction failure

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Notes side-panel

### Find and create notes (EXT-F-2006)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 3. **Controls:** 13.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0061, EXT-D-0062, EXT-D-0069

**Linked defects:** [EXT-D-0061](defects/EXT-D-0061.json) (fixed), [EXT-D-0062](defects/EXT-D-0062.json) (fixed), [EXT-D-0069](defects/EXT-D-0069.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2006-T01 Guest cannot open Notes | N/A | N/A | N/A | EXT-F-2006-C01 |
| EXT-F-2006-T02 Find notes by search and folder | N/A | Unverified | Unverified | EXT-F-2006-C02, EXT-F-2006-C03, EXT-F-2006-C04, EXT-F-2006-C05 |
| EXT-F-2006-T03 Create first note and empty/loading states | N/A | Unverified | Unverified | EXT-F-2006-C01, EXT-F-2006-C06, EXT-F-2006-C11, EXT-F-2006-C12, EXT-F-2006-C13 |

**Controls without a mapped case:** EXT-F-2006-C07 Select all folders; EXT-F-2006-C08 Select named folder; EXT-F-2006-C09 Clear notes search; EXT-F-2006-C10 Choose note in selector

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Notes editor

### Edit, preview, organize, and delete a note (EXT-F-2007)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 4. **Controls:** 27.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0063, EXT-D-0067, EXT-D-0068

**Linked defects:** [EXT-D-0063](defects/EXT-D-0063.json) (fixed), [EXT-D-0067](defects/EXT-D-0067.json) (fixed), [EXT-D-0068](defects/EXT-D-0068.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2007-T01 Edit, preview, and autosave note fields | N/A | Unverified | Unverified | EXT-F-2007-C02, EXT-F-2007-C03, EXT-F-2007-C04, EXT-F-2007-C05, EXT-F-2007-C06 |
| EXT-F-2007-T02 Append each active-page content type | N/A | Unverified | Unverified | EXT-F-2007-C10, EXT-F-2007-C11, EXT-F-2007-C12, EXT-F-2007-C13, EXT-F-2007-C14, EXT-F-2007-C15, EXT-F-2007-C16 |
| EXT-F-2007-T03 Delete note and cancel confirmation | N/A | Unverified | Unverified | EXT-F-2007-C07, EXT-F-2007-C09, EXT-F-2007-C08, EXT-F-2007-C01 |
| EXT-F-2007-T04 Detail-read failure, missing note, and retry | N/A | Unverified | Unverified | EXT-F-2007-C01, EXT-F-2007-C27 |

**Controls without a mapped case:** EXT-F-2007-C17 Open append-from-page menu; EXT-F-2007-C18 Close append-from-page menu; EXT-F-2007-C19 Append page URL and title; EXT-F-2007-C20 Append selected page text; EXT-F-2007-C21 Append readable page text; EXT-F-2007-C22 Append page links; EXT-F-2007-C23 Append page metadata; EXT-F-2007-C24 Append from restricted page; EXT-F-2007-C25 Edit note folder to no folder; EXT-F-2007-C26 Preview markdown after autosave

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Files side-panel

### Browse files and saved captures (EXT-F-2008)

**Role status:** guest: N/A · member: Partial · admin: Partial. **Cases:** 4. **Controls:** 28.

**Next:** Add cases for 13 uncovered control(s), then verify them in the extension.

**Linked defects:** [EXT-D-0064](defects/EXT-D-0064.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2008-T01 Guest cannot open Files | N/A | N/A | N/A | EXT-F-2008-C01 |
| EXT-F-2008-T02 Search library and screenshots | N/A | Partial | Partial | EXT-F-2008-C01, EXT-F-2008-C03, EXT-F-2008-C04, EXT-F-2008-C05, EXT-F-2008-C02 |
| EXT-F-2008-T03 Open and attach file/screenshot | N/A | Unverified | Unverified | EXT-F-2008-C06, EXT-F-2008-C08, EXT-F-2008-C09, EXT-F-2008-C11 |
| EXT-F-2008-T04 Inspect family navigation and pagination | N/A | Unverified | Unverified | EXT-F-2008-C07, EXT-F-2008-C10, EXT-F-2008-C12, EXT-F-2008-C13, EXT-F-2008-C14, EXT-F-2008-C15 |

**Recorded case details and evidence:**

- EXT-F-2008-T02 · member: Partial. Exact173 clean exclusive native run: both Files tabs error/Retry/no-false-empty and real successful-read recovery passed; reviewer identity and canonical non-admin assignment response proved. Search and other full-case actions untested.
  Evidence / build / date recorded: files-member-d64-20261002-003, docs/stabilization/reports/files-member-acceptance-20261002.json
- EXT-F-2008-T02 · admin: Partial. Exact173 admin: failed reads show error/Retry without false-empty claim; both tabs recover after successful read. Search and other full-case actions untested.
  Evidence / build / date recorded: files-fresh-acceptance-20261001-002, docs/stabilization/reports/files-fresh-acceptance-20261001.json

**Controls without a mapped case:** EXT-F-2008-C16 Inspect binary ancestry graph; EXT-F-2008-C17 Page backward through binary ancestry; EXT-F-2008-C18 Page forward through binary ancestry; EXT-F-2008-C19 Inspect processed-result graph; EXT-F-2008-C20 Page backward through processed ancestry; EXT-F-2008-C21 Page forward through processed ancestry; EXT-F-2008-C22 Inspect representation badges; EXT-F-2008-C23 Inspect capability badges; EXT-F-2008-C24 Observe family empty state; EXT-F-2008-C25 Observe attachment failure; EXT-F-2008-C26 Observe no active conversation gate; EXT-F-2008-C27 Detach file from current chat; EXT-F-2008-C28 Detach screenshot from current chat

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Saved captures side-panel

### Search and manage saved captures (EXT-F-2009)

**Role status:** guest: N/A · member: Unverified · admin: Partial. **Cases:** 8. **Controls:** 39.

**Next:** Add cases for 9 uncovered control(s), then verify them in the extension.

**Linked defects:** [EXT-D-0065](defects/EXT-D-0065.json) (retest-pass)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2009-T01 Guest cannot open saved captures | N/A | N/A | N/A | EXT-F-2009-C01 |
| EXT-F-2009-T02 Find and open saved capture | N/A | Unverified | Partial | EXT-F-2009-C01, EXT-F-2009-C02, EXT-F-2009-C03, EXT-F-2009-C04, EXT-F-2009-C05 |
| EXT-F-2009-T03 Edit Source text and inspect original and structured representations | N/A | Unverified | Unverified | EXT-F-2009-C11, EXT-F-2009-C14, EXT-F-2009-C15, EXT-F-2009-C16, EXT-F-2009-C17, EXT-F-2009-C18, EXT-F-2009-C19, EXT-F-2009-C27, EXT-F-2009-C28, EXT-F-2009-C29, EXT-F-2009-C30, EXT-F-2009-C32, EXT-F-2009-C33 |
| EXT-F-2009-T04 Delete capture and recover from detail errors | N/A | Unverified | Unverified | EXT-F-2009-C06, EXT-F-2009-C07, EXT-F-2009-C08, EXT-F-2009-C09, EXT-F-2009-C10, EXT-F-2009-C20 |
| EXT-F-2009-T05 Open Source in web app and inspect source host and original file | N/A | Unverified | Unverified | EXT-F-2009-C31, EXT-F-2009-C35, EXT-F-2009-C36 |
| EXT-F-2009-T06 Unreadable saved captures are disclosed and retryable | N/A | Unverified | Unverified | EXT-F-2009-C01, EXT-F-2009-C37 |
| EXT-F-2009-T07 Show Source author identity with unreadable-name fallback | N/A | Unverified | Unverified | EXT-F-2009-C38 |
| EXT-F-2009-T08 Organization-wide Source deletion is confirmed and visible to another member | N/A | Unverified | Unverified | EXT-F-2009-C06, EXT-F-2009-C39 |

**Recorded case details and evidence:**

- EXT-F-2009-T02 · admin: Partial. Frozen173 admin: receipt-backed A/B rows; B remained selected after A completed late with success and with failure. Other T02 controls/dimensions untested.
  Evidence / build / date recorded: saved-capture-escalation-d65-20261001-01, docs/stabilization/reports/saved-capture-escalation-verify-20261001.json

**Controls without a mapped case:** EXT-F-2009-C12 Edit title; EXT-F-2009-C13 Edit description; EXT-F-2009-C21 Copy capture Markdown; EXT-F-2009-C22 Copy capture Plain text; EXT-F-2009-C23 Copy capture Page URL; EXT-F-2009-C24 Copy capture For AI agent; EXT-F-2009-C25 Copy capture Full JSON admin option; EXT-F-2009-C26 Copy capture Full JSON for AI admin option; EXT-F-2009-C34 Inspect saved versus kept Source status

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.; Source list/edit/delete authorization, organization RLS, and original-file reads require live signed-in organization evidence; endpoint/RLS behavior is not a source inventory blocker.


## Capture side-panel

### Capture handoff items needing the browser (EXT-F-2010)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 4. **Controls:** 20.

**Next:** Add cases for 11 uncovered control(s), then verify them in the extension.

**Linked defects:** [EXT-D-0023](defects/EXT-D-0023.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2010-T01 Guest cannot open Capture handoff queue | N/A | N/A | N/A | EXT-F-2010-C02 |
| EXT-F-2010-T02 Switch organization holding pending items | N/A | Unverified | Unverified | EXT-F-2010-C01 |
| EXT-F-2010-T03 Run waiting queue and observe outcomes | N/A | Unverified | Unverified | EXT-F-2010-C02, EXT-F-2010-C09, EXT-F-2010-C08 |
| EXT-F-2010-T04 Drive, capture, or skip one item | N/A | Unverified | Unverified | EXT-F-2010-C03, EXT-F-2010-C04, EXT-F-2010-C05, EXT-F-2010-C06, EXT-F-2010-C07 |

**Controls without a mapped case:** EXT-F-2010-C10 Observe queue loading; EXT-F-2010-C11 Observe queue empty; EXT-F-2010-C12 Observe organization switch failure; EXT-F-2010-C13 Observe policy degradation note; EXT-F-2010-C14 Observe per-item running progress; EXT-F-2010-C15 Observe per-item refusal; EXT-F-2010-C16 Open manual item page; EXT-F-2010-C17 Complete manual item from opened tab; EXT-F-2010-C18 Dismiss manual item with optional reason; EXT-F-2010-C20 Observe pickup pointer navigation; EXT-F-2010-C21 Observe realtime disconnection

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Vault side-panel

### Manage saved credentials and vault items (EXT-F-2011)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 11. **Controls:** 54.

**Next:** Add cases for 44 uncovered control(s), then verify them in the extension.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2011-T01 Vault sign-in gate and list | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2011-T02 Current-page credential use | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2011-T03 Create and edit a login | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2011-T04 Pending capture decisions | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2011-T05 Guest cannot open Vault | N/A | N/A | N/A | No control mapped |
| EXT-F-2011-T06 Reject stale credential offers after organization switch | N/A | Unverified | Unverified | EXT-F-2011-C45, EXT-F-2011-C49, EXT-F-2011-C50 |
| EXT-F-2011-T07 Vault list can be freshly read after browser restart | N/A | Unverified | Unverified | EXT-F-2011-C01, EXT-F-2011-C04 |
| EXT-F-2011-T08 Distinguish failed site-login lookup from no matches and retry | N/A | Unverified | Unverified | EXT-F-2011-C51 |
| EXT-F-2011-T09 Saved-login candidates track the resolved page URL | N/A | Unverified | Unverified | EXT-F-2011-C31, EXT-F-2011-C52 |
| EXT-F-2011-T10 Enable browser filling with account password | N/A | Unverified | Unverified | EXT-F-2011-C53 |
| EXT-F-2011-T11 Approve browser filling with account passkey | N/A | Unverified | Unverified | EXT-F-2011-C54 |

**Controls without a mapped case:** EXT-F-2011-C02 Open web vault; EXT-F-2011-C03 Search/create item; EXT-F-2011-C05 Sign in; EXT-F-2011-C06 Pending page-capture accept/deny; EXT-F-2011-C07 Fill / use here; EXT-F-2011-C08 Dismiss outcome; EXT-F-2011-C09 Expand/collapse entry; EXT-F-2011-C10 Add field; EXT-F-2011-C11 Reveal secret toggle; EXT-F-2011-C12 Copy secret; EXT-F-2011-C13 Change/save/cancel field; EXT-F-2011-C14 Remove field/item; EXT-F-2011-C15 Edit/create entry fields; EXT-F-2011-C16 Generate password; EXT-F-2011-C17 Create login from current page; EXT-F-2011-C18 Enter new login name; EXT-F-2011-C19 Enter new login username; EXT-F-2011-C20 Enter new login password; EXT-F-2011-C21 Save new login; EXT-F-2011-C22 Cancel new login; EXT-F-2011-C23 Expand login row; EXT-F-2011-C24 Collapse login row; EXT-F-2011-C25 Edit login metadata; EXT-F-2011-C26 Set login URLs; EXT-F-2011-C27 Choose URL match rule; EXT-F-2011-C28 Save login metadata; EXT-F-2011-C29 Cancel metadata edit; EXT-F-2011-C30 Toggle browser fill; EXT-F-2011-C32 Use matching login here; EXT-F-2011-C33 Dismiss login outcome; EXT-F-2011-C34 Reveal encrypted field; EXT-F-2011-C35 Hide encrypted field; EXT-F-2011-C36 Copy encrypted field; EXT-F-2011-C37 Edit encrypted field value; EXT-F-2011-C38 Save encrypted field value; EXT-F-2011-C39 Cancel field value edit; EXT-F-2011-C40 Add encrypted field; EXT-F-2011-C41 Save added encrypted field; EXT-F-2011-C42 Cancel add-field form; EXT-F-2011-C43 Remove encrypted field; EXT-F-2011-C44 Remove login item; EXT-F-2011-C46 Save pending credential as new; EXT-F-2011-C47 Update existing login from capture; EXT-F-2011-C48 Search capture update targets

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Tools/manual runner

### Browse and manually run extension tools (EXT-F-2012)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 3. **Controls:** 35.

**Next:** Add cases for 35 uncovered control(s), then verify them in the extension.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2012-T01 Catalog filters and manual runner | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2012-T02 Smart tests and Recorder | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2012-T03 Guest cannot open Tools | N/A | N/A | N/A | No control mapped |

**Controls without a mapped case:** EXT-F-2012-C01 Search tools; EXT-F-2012-C02 Permission filter; EXT-F-2012-C03 Surface filter; EXT-F-2012-C04 Category filter; EXT-F-2012-C05 Expand tool row; EXT-F-2012-C06 Copy tool name/schema/args/error/result; EXT-F-2012-C07 Edit argument JSON; EXT-F-2012-C08 Run manually; EXT-F-2012-C09 Use sample args; EXT-F-2012-C11 Tab capture dialog controls; EXT-F-2012-C12 Open Catalog tab; EXT-F-2012-C13 Open Smart tests tab; EXT-F-2012-C14 Open Recorder tab; EXT-F-2012-C15 Filter permission tier All; EXT-F-2012-C16 Filter permission tier Read; EXT-F-2012-C17 Filter permission tier Action; EXT-F-2012-C18 Filter permission tier Ask; EXT-F-2012-C19 Filter permission tier Privileged; EXT-F-2012-C20 Filter surface Agent; EXT-F-2012-C21 Filter surface Internal delegates; EXT-F-2012-C22 Filter surface All handlers; EXT-F-2012-C23 Select tool category; EXT-F-2012-C24 Inspect optional permission badge; EXT-F-2012-C25 Inspect admin badge; EXT-F-2012-C26 Inspect tool schema; EXT-F-2012-C27 Reject invalid JSON arguments; EXT-F-2012-C28 Reject schema-mismatched arguments; EXT-F-2012-C29 Show tool run result; EXT-F-2012-C30 Show tool run failure; EXT-F-2012-C31 Copy tool schema JSON; EXT-F-2012-C32 Copy tool arguments JSON; EXT-F-2012-C33 Copy tool name; EXT-F-2012-C34 Copy tool error; EXT-F-2012-C35 Copy tool result; EXT-F-2012-C36 Use sample tool arguments

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Chat (deferred wave D)

### Use assistant chat and conversation controls (EXT-F-2013)

**Role status:** guest: Fail · member: Partial · admin: Unverified. **Cases:** 12. **Controls:** 138.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0074, EXT-D-0075, EXT-D-0096

**Linked defects:** [EXT-D-0066](defects/EXT-D-0066.json) (retest-pass), [EXT-D-0074](defects/EXT-D-0074.json) (fixed), [EXT-D-0075](defects/EXT-D-0075.json) (triaged), [EXT-D-0088](defects/EXT-D-0088.json) (closed), [EXT-D-0096](defects/EXT-D-0096.json) (fixed), [EXT-D-0097](defects/EXT-D-0097.json) (retest-pass), [EXT-D-0112](defects/EXT-D-0112.json) (retest-pass), [EXT-D-0113](defects/EXT-D-0113.json) (closed), [EXT-D-0134](defects/EXT-D-0134.json) (closed), [EXT-D-0144](defects/EXT-D-0144.json) (closed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2013-T01 Chat conversation navigation and modes | Unverified | Unverified | Unverified | No control mapped |
| EXT-F-2013-T02 Composer and active run controls | Unverified | Partial | Unverified | No control mapped |
| EXT-F-2013-T03 Chat attachments and exports | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2013-T04 Interactive agent cards and tool receipt | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2013-T05 Guest banner sign-in and sign-up actions | Unverified | N/A | N/A | EXT-F-2013-C132, EXT-F-2013-C133 |
| EXT-F-2013-T06 Reply read-aloud follows current platform voice preference | Unverified | Unverified | Unverified | EXT-F-2013-C102, EXT-F-2013-C103 |
| EXT-F-2013-T07 Send explicit page Source status in Chat context | N/A | Unverified | Unverified | EXT-F-2013-C134 |
| EXT-F-2013-T08 Apply account default model when no extension model is selected | Unverified | Unverified | Unverified | EXT-F-2013-C135 |
| EXT-F-2013-T09 Render typed decision answer in Chat live stream and conversation history | Unverified | Unverified | Unverified | EXT-F-2013-C136 |
| EXT-F-2013-T10 Public guest Chat first reply, same-conversation follow-up, and new conversation after reload | Pass | N/A | N/A | EXT-F-2013-C08, EXT-F-2013-C10 |
| EXT-F-2013-T11 Inspect actual context receipt blocks and delivered text | Unverified | Unverified | Unverified | EXT-F-2013-C137, EXT-F-2013-C138 |
| EXT-F-2013-T12 Returning guest at the live usage limit receives free-account remedy without futile Retry | Fail | N/A | N/A | EXT-F-2013-C08, EXT-F-2013-C10, EXT-F-2013-C03 |

**Recorded case details and evidence:**

- EXT-F-2013-T02 · member: Partial. Hosted local-development-ZIP 0.2.205 nonadmin sign-in, saved organization presence and one real composer answer pass. Queue, interrupt, Stop, voice, keyboard variations and reload dimensions remain unverified; this does not pass the full case.
  Evidence / build / date recorded: 37182939504, .research/hosted-member205-final.json
- EXT-F-2013-T10 · guest: Pass. Bounded public0.2.205 adaptedunpackedCRX: opening, SAME-conversation follow-up and post-reload newconversation all actualHTTP200, distinctgrounded terminal_answer; wire samefingerprint/is_new=false then newfingerprint/is_new=true. Before/afterserver624b0cee540b8d6d957ac008af8773cd285bd29c stable; exactartifactunchanged and all3journalsvalid. Rootreadoriginalreceipt,alljournals,followupscreenshot. Not actualStoreinstalled/returningallowance or wholeChat.
  Evidence / build / date recorded: 37356729984, .research/guest-turn-boundary-native.json
- EXT-F-2013-T12 · guest: Fail. Historical Store-installed176 failed genericerror/Retry at liveHTTP402. Exact205candidate passed fresh/returning exhaustedguest remedy/noRetry;205 is now published. Public205CRX fresh/reload answers passed37267858358 but this did not exercise allowance402 or actualStoreinstalledprofile; retain open installed-acceptance requirement.
  Evidence / build / date recorded: urgent-live-guest-20261004-01, .research/urgent-live-guest-20261004.json

**Controls without a mapped case:** EXT-F-2013-C01 Retry loading / dismiss error; EXT-F-2013-C02 Refresh agents; EXT-F-2013-C04 History popover / refresh / select; EXT-F-2013-C05 Task panel chip; EXT-F-2013-C06 Ask/Act permission mode popover; EXT-F-2013-C07 Conversation customization popover; EXT-F-2013-C09 Microphone; EXT-F-2013-C11 Suggestion chip; EXT-F-2013-C12 Copy message/reply/conversation; EXT-F-2013-C13 Agent approval/ask-user cards; EXT-F-2013-C14 Gmail review card; EXT-F-2013-C15 Tool receipt dialog; EXT-F-2013-C16 Variable panel; EXT-F-2013-C17 Attachment chips; EXT-F-2013-C18 Select agent from dropdown; EXT-F-2013-C19 Select language; EXT-F-2013-C20 Choose Ask permission mode; EXT-F-2013-C21 Choose Act permission mode; EXT-F-2013-C22 Open history; EXT-F-2013-C23 Retry history load; EXT-F-2013-C24 Choose history conversation; EXT-F-2013-C25 Choose Your default model; EXT-F-2013-C26 Choose model preset; EXT-F-2013-C27 Toggle auto page capture; EXT-F-2013-C28 Toggle deep capture; EXT-F-2013-C29 Press Enter to send; EXT-F-2013-C30 Press Shift Enter for newline; EXT-F-2013-C31 Queue message while streaming; EXT-F-2013-C32 Interrupt and send now; EXT-F-2013-C33 Stop current stream; EXT-F-2013-C34 Dismiss voice error; EXT-F-2013-C35 Start microphone capture; EXT-F-2013-C36 Stop microphone capture; EXT-F-2013-C37 Open Google files picker; EXT-F-2013-C38 Attach one Google file; EXT-F-2013-C39 Detach all Google files; EXT-F-2013-C40 Retry Google file list; EXT-F-2013-C41 Open compute target picker; EXT-F-2013-C42 Refresh compute targets; EXT-F-2013-C43 Bind compute target; EXT-F-2013-C44 Detach compute target; EXT-F-2013-C45 Open install local flow; EXT-F-2013-C46 Open create sandbox flow; EXT-F-2013-C47 Open copy conversation options; EXT-F-2013-C48 Toggle copy user messages; EXT-F-2013-C49 Toggle copy assistant messages; EXT-F-2013-C50 Toggle copy agent info; EXT-F-2013-C51 Toggle copy thinking; EXT-F-2013-C52 Toggle copy tool calls; EXT-F-2013-C53 Toggle copy full tool results; EXT-F-2013-C54 Toggle copy AI instructions; EXT-F-2013-C55 Copy entire conversation; EXT-F-2013-C56 Copy individual reply Markdown; EXT-F-2013-C57 Copy individual reply plain text; EXT-F-2013-C58 Copy individual reply for AI; EXT-F-2013-C59 Approve action card; EXT-F-2013-C60 Deny action card; EXT-F-2013-C61 Supply approval text input; EXT-F-2013-C62 Answer ask-user text; EXT-F-2013-C63 Choose ask-user single option; EXT-F-2013-C64 Choose ask-user multiple options; EXT-F-2013-C65 Confirm ask-user yes; EXT-F-2013-C66 Confirm ask-user no; EXT-F-2013-C67 Choose ask-user Other; EXT-F-2013-C68 Write message instead; EXT-F-2013-C69 Add extra instructions; EXT-F-2013-C70 Cancel ask-user card; EXT-F-2013-C71 Send Gmail review card; EXT-F-2013-C72 Decline Gmail review card; EXT-F-2013-C73 Dismiss Gmail review card; EXT-F-2013-C74 Open tool receipt; EXT-F-2013-C75 Copy receipt JSON; EXT-F-2013-C76 Copy receipt JWS; EXT-F-2013-C77 Queue message edit; EXT-F-2013-C78 Queue message save edit; EXT-F-2013-C79 Queue message cancel edit; EXT-F-2013-C80 Queue message remove; EXT-F-2013-C81 Queue message interrupt current run; EXT-F-2013-C82 Expand tool timeline row; EXT-F-2013-C83 Copy tool result; EXT-F-2013-C84 Open agent variables panel; EXT-F-2013-C85 Edit agent text variable; EXT-F-2013-C86 Edit agent multiline variable; EXT-F-2013-C87 Observe required variable gap; EXT-F-2013-C88 Open attached highlight; EXT-F-2013-C89 Clear attached highlight; EXT-F-2013-C90 Enter credential fields on capture card; EXT-F-2013-C91 Save credential and continue; EXT-F-2013-C92 Cancel credential capture; EXT-F-2013-C93 Dismiss expired credential card; EXT-F-2013-C94 Retry failed credential save; EXT-F-2013-C95 Open queued message edit; EXT-F-2013-C96 Cancel queued message; EXT-F-2013-C97 Save queued message edit; EXT-F-2013-C98 Choose notify action; EXT-F-2013-C99 Choose notify Other; EXT-F-2013-C100 Choose secret answer; EXT-F-2013-C101 Choose action choice; EXT-F-2013-C104 Agent picker search; EXT-F-2013-C105 Agent picker clear search; EXT-F-2013-C106 Agent picker Mine tab; EXT-F-2013-C107 Agent picker Shared tab; EXT-F-2013-C108 Agent picker All tab; EXT-F-2013-C109 Agent picker Public tab; EXT-F-2013-C110 Agent picker Sort menu; EXT-F-2013-C111 Agent picker choose sort; EXT-F-2013-C112 Agent picker favorites filter; EXT-F-2013-C113 Agent picker archive filter; EXT-F-2013-C114 Agent picker category filter; EXT-F-2013-C115 Agent picker category search; EXT-F-2013-C116 Agent picker select category; EXT-F-2013-C117 Agent picker clear categories; EXT-F-2013-C118 Agent picker tags filter; EXT-F-2013-C119 Agent picker tag search; EXT-F-2013-C120 Agent picker select tag; EXT-F-2013-C121 Agent picker clear tags; EXT-F-2013-C122 Agent picker reset filters; EXT-F-2013-C123 Agent picker select row; EXT-F-2013-C124 Agent picker favorite toggle; EXT-F-2013-C125 Agent picker show details; EXT-F-2013-C126 Agent picker detail select; EXT-F-2013-C127 Agent picker detail sneak peek; EXT-F-2013-C128 Agent picker detail open chat; EXT-F-2013-C129 Agent picker detail open new tab; EXT-F-2013-C130 Agent picker dismiss default drift; EXT-F-2013-C131 Agent picker retry default row

**Other remaining work:** Execution is deferred to wave D. Source control inventory does not claim chat/provider behavior; run all applicable persona cases after non-Chat/Pilot completion gate.; Agent picker implementation was read from the shared @ai-matrx/agents source checkout; installed package version and live menu behavior require runtime reconciliation.; Public tab label and unavailable Sneak Peek were reconciled from shared package 0.13.10 and host props; still verify picker at wave D.; Generated stream-events contract delta through b3bed1ab adds cutover payloads, HostedToolPart and message flags. Wave D stream/history acceptance must cover them; type generation is not runtime proof. See takeover-inventory-reconciled.json generated_contract_accounting.


## Pilot (deferred wave D)

### Start and operate a Pilot browser session (EXT-F-2014)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 5. **Controls:** 59.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0024

**Linked defects:** [EXT-D-0024](defects/EXT-D-0024.json) (open)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2014-T01 Pilot admin gate and session lifecycle | N/A | N/A | Unverified | No control mapped |
| EXT-F-2014-T02 Pilot conversation and interactive cards | N/A | N/A | Unverified | No control mapped |
| EXT-F-2014-T03 Pilot receives page Source status and truthful local-browser terminal outcomes | N/A | N/A | Unverified | EXT-F-2014-C60 |
| EXT-F-2014-T04 Render typed decision answer in Pilot live stream and conversation history | N/A | N/A | Unverified | EXT-F-2014-C61 |
| EXT-F-2014-T05 Pilot stays in its assigned tabs and preserves context when user switches tabs | N/A | N/A | Unverified | EXT-F-2014-C62 |

**Controls without a mapped case:** EXT-F-2014-C01 Start/end session; EXT-F-2014-C03 Task panel toggle; EXT-F-2014-C04 Pilot composer; EXT-F-2014-C05 Send/stop/interrupt; EXT-F-2014-C06 Permission mode; EXT-F-2014-C07 Retry/dismiss stream interruption; EXT-F-2014-C09 Tool approval/ask-user cards; EXT-F-2014-C10 Choose Pilot agent; EXT-F-2014-C11 Select Pilot language; EXT-F-2014-C12 Choose Pilot Ask mode; EXT-F-2014-C13 Choose Pilot Act mode; EXT-F-2014-C14 Copy Pilot conversation; EXT-F-2014-C15 Open Pilot tab group; EXT-F-2014-C16 End Pilot tab group; EXT-F-2014-C18 Toggle Pilot task panel; EXT-F-2014-C19 Submit Pilot composer with Enter; EXT-F-2014-C20 Stop Pilot stream; EXT-F-2014-C21 Choose Pilot suggestion; EXT-F-2014-C22 Dismiss Pilot stream interruption; EXT-F-2014-C23 Dismiss Pilot session error; EXT-F-2014-C24 Approve Pilot action; EXT-F-2014-C25 Deny Pilot action; EXT-F-2014-C26 Answer Pilot ask-user card; EXT-F-2014-C27 Copy Pilot reply variants; EXT-F-2014-C28 Inspect Pilot tool timeline; EXT-F-2014-C29 Copy Pilot user message; EXT-F-2014-C30 Copy Pilot assistant message; EXT-F-2014-C31 Dismiss Pilot error; EXT-F-2014-C32 Agent picker search; EXT-F-2014-C33 Agent picker clear search; EXT-F-2014-C34 Agent picker Mine tab; EXT-F-2014-C35 Agent picker Shared tab; EXT-F-2014-C36 Agent picker All tab; EXT-F-2014-C37 Agent picker Public tab; EXT-F-2014-C38 Agent picker Sort menu; EXT-F-2014-C39 Agent picker choose sort; EXT-F-2014-C40 Agent picker favorites filter; EXT-F-2014-C41 Agent picker archive filter; EXT-F-2014-C42 Agent picker category filter; EXT-F-2014-C43 Agent picker category search; EXT-F-2014-C44 Agent picker select category; EXT-F-2014-C45 Agent picker clear categories; EXT-F-2014-C46 Agent picker tags filter; EXT-F-2014-C47 Agent picker tag search; EXT-F-2014-C48 Agent picker select tag; EXT-F-2014-C49 Agent picker clear tags; EXT-F-2014-C50 Agent picker reset filters; EXT-F-2014-C51 Agent picker select row; EXT-F-2014-C52 Agent picker favorite toggle; EXT-F-2014-C53 Agent picker show details; EXT-F-2014-C54 Agent picker detail select; EXT-F-2014-C55 Agent picker detail sneak peek; EXT-F-2014-C56 Agent picker detail open chat; EXT-F-2014-C57 Agent picker detail open new tab; EXT-F-2014-C58 Agent picker dismiss default drift; EXT-F-2014-C59 Agent picker retry default row

**Other remaining work:** Execution is deferred to wave D. Source control inventory does not claim chat/provider behavior; run all applicable persona cases after non-Chat/Pilot completion gate.; Agent picker implementation was read from the shared @ai-matrx/agents source checkout; installed package version and live menu behavior require runtime reconciliation.; Public tab label and unavailable Sneak Peek were reconciled from shared package 0.13.10 and host props; still verify picker at wave D.; Generated stream-events contract delta through b3bed1ab adds cutover payloads, HostedToolPart and message flags. Wave D stream/history acceptance must cover them; type generation is not runtime proof. See takeover-inventory-reconciled.json generated_contract_accounting.


## Tools Smart tests

### Run built-in browser AI scenarios (EXT-F-2015)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 5. **Controls:** 26.

**Next:** Add cases for 26 uncovered control(s), then verify them in the extension.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2015-T01 Summarize and classify active page | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2015-T02 Extract and translate page text | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2015-T03 Detect, proofread, scan and describe | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2015-T04 Inspect and copy model inputs | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2015-T05 Guest cannot open Tools Smart tests | N/A | N/A | N/A | No control mapped |

**Controls without a mapped case:** EXT-F-2015-C01 Expand Summarize active page; EXT-F-2015-C02 Choose summary length; EXT-F-2015-C03 Choose summary type; EXT-F-2015-C04 Choose context cap; EXT-F-2015-C05 Run Summarize active page; EXT-F-2015-C06 Expand Classify active page; EXT-F-2015-C07 Enter classification labels; EXT-F-2015-C08 Run Classify active page; EXT-F-2015-C09 Expand Extract JSON from active page; EXT-F-2015-C10 Edit extraction schema; EXT-F-2015-C11 Run Extract JSON from active page; EXT-F-2015-C12 Expand Translate first paragraph; EXT-F-2015-C13 Choose translation target; EXT-F-2015-C14 Run Translate first paragraph; EXT-F-2015-C15 Expand Detect page language; EXT-F-2015-C16 Run Detect page language; EXT-F-2015-C17 Expand Proofread selection; EXT-F-2015-C18 Run Proofread selection; EXT-F-2015-C19 Expand Prompt-injection scan; EXT-F-2015-C20 Run Prompt-injection scan; EXT-F-2015-C21 Expand Describe first image; EXT-F-2015-C22 Enter image question; EXT-F-2015-C23 Run Describe first image; EXT-F-2015-C24 Expand model input payload; EXT-F-2015-C25 Copy full model input payload; EXT-F-2015-C26 Copy scenario result

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Tools Recorder

### Record active browser tab (EXT-F-2016)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 5. **Controls:** 18.

**Next:** Add cases for 17 uncovered control(s), then verify them in the extension.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2016-T01 Record current tab with and without audio | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2016-T02 Recover from permission rejection | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2016-T03 Manage saved recording index | N/A | Unverified | Unverified | No control mapped |
| EXT-F-2016-T04 Guest cannot open Tools Recorder | N/A | N/A | N/A | No control mapped |
| EXT-F-2016-T05 Open saved recording file | N/A | Unverified | Unverified | EXT-F-2016-C18 |

**Controls without a mapped case:** EXT-F-2016-C01 Set recording duration; EXT-F-2016-C02 Toggle audio capture; EXT-F-2016-C03 Start tab recording; EXT-F-2016-C04 Stop tab recording; EXT-F-2016-C05 Dismiss recorder error; EXT-F-2016-C06 Open permission recovery dialog; EXT-F-2016-C07 Close recovery dialog by X; EXT-F-2016-C08 Close recovery dialog by Close; EXT-F-2016-C09 Close recovery dialog by backdrop; EXT-F-2016-C10 Open extension permissions; EXT-F-2016-C11 Clear recording list; EXT-F-2016-C12 Cancel clear-list confirmation; EXT-F-2016-C13 Confirm clear-list; EXT-F-2016-C14 Copy recorded file ID; EXT-F-2016-C15 Remove one recording row; EXT-F-2016-C16 Cancel row removal; EXT-F-2016-C17 Confirm row removal

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.


## Vault password generator

### Generate and use credentials (EXT-F-2017)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 4. **Controls:** 22.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-2017-T01 Generate password options | N/A | Unverified | Unverified | EXT-F-2017-C01, EXT-F-2017-C02, EXT-F-2017-C03, EXT-F-2017-C05, EXT-F-2017-C06, EXT-F-2017-C07, EXT-F-2017-C08, EXT-F-2017-C09, EXT-F-2017-C10, EXT-F-2017-C15, EXT-F-2017-C16, EXT-F-2017-C17, EXT-F-2017-C18, EXT-F-2017-C19, EXT-F-2017-C20 |
| EXT-F-2017-T02 Generate passphrase options | N/A | Unverified | Unverified | EXT-F-2017-C04, EXT-F-2017-C11, EXT-F-2017-C12, EXT-F-2017-C13, EXT-F-2017-C14, EXT-F-2017-C15, EXT-F-2017-C16, EXT-F-2017-C17, EXT-F-2017-C18, EXT-F-2017-C19, EXT-F-2017-C20 |
| EXT-F-2017-T03 Use generated candidate on page | N/A | Unverified | Unverified | EXT-F-2017-C21, EXT-F-2017-C22 |
| EXT-F-2017-T04 Guest cannot open Vault password generator | N/A | N/A | N/A | No control mapped |

**Other remaining work:** No runtime behavior verdict from source reading; execute role, organization, permission, error and persistence cases in the live side panel.; 21 component checks and independent typecheck establish bounded option/offer routing only; native role, clipboard, field-fill/no-submit, stale-target and reload outcomes remain unverified.


## Tools / registered executor

Registered tools are executor capabilities, listed separately from the visible Tools tab. Their planned manual cases are not native passes.

### list_chrome_categories (EXT-F-4001)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4001-T01 Controlled manual execution: list_chrome_categories | N/A | Unverified | Unverified | EXT-F-4001-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_core_tools (EXT-F-4002)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4002-T01 Controlled manual execution: list_core_tools | N/A | Unverified | Unverified | EXT-F-4002-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_reading_tools (EXT-F-4003)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4003-T01 Controlled manual execution: list_reading_tools | N/A | Unverified | Unverified | EXT-F-4003-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_interaction_tools (EXT-F-4004)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4004-T01 Controlled manual execution: list_interaction_tools | N/A | Unverified | Unverified | EXT-F-4004-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_tabs_tools (EXT-F-4005)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4005-T01 Controlled manual execution: list_tabs_tools | N/A | Unverified | Unverified | EXT-F-4005-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_capture_tools (EXT-F-4006)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4006-T01 Controlled manual execution: list_capture_tools | N/A | Unverified | Unverified | EXT-F-4006-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_chrome_tools (EXT-F-4007)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4007-T01 Controlled manual execution: list_chrome_tools | N/A | N/A | Unverified | EXT-F-4007-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_human_tools (EXT-F-4008)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4008-T01 Controlled manual execution: list_human_tools | N/A | Unverified | Unverified | EXT-F-4008-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_memory_tools (EXT-F-4009)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4009-T01 Controlled manual execution: list_memory_tools | N/A | Unverified | Unverified | EXT-F-4009-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_ai_tools (EXT-F-4010)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4010-T01 Controlled manual execution: list_ai_tools | N/A | Unverified | Unverified | EXT-F-4010-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_demos_tools (EXT-F-4011)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4011-T01 Controlled manual execution: list_demos_tools | N/A | Unverified | Unverified | EXT-F-4011-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_guidance_tools (EXT-F-4012)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4012-T01 Controlled manual execution: list_guidance_tools | N/A | Unverified | Unverified | EXT-F-4012-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_devtools_tools (EXT-F-4013)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4013-T01 Controlled manual execution: list_devtools_tools | N/A | N/A | Unverified | EXT-F-4013-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_webmcp_tools (EXT-F-4014)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4014-T01 Controlled manual execution: list_webmcp_tools | N/A | N/A | Unverified | EXT-F-4014-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_desktop_tools (EXT-F-4015)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4015-T01 Controlled manual execution: list_desktop_tools | N/A | Unverified | Unverified | EXT-F-4015-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_credentials_tools (EXT-F-4016)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4016-T01 Controlled manual execution: list_credentials_tools | N/A | Unverified | Unverified | EXT-F-4016-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_crm_tools (EXT-F-4017)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4017-T01 Controlled manual execution: list_crm_tools | N/A | Unverified | Unverified | EXT-F-4017-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_education_tools (EXT-F-4018)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4018-T01 Controlled manual execution: list_education_tools | N/A | Unverified | Unverified | EXT-F-4018-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_productivity_tools (EXT-F-4019)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4019-T01 Controlled manual execution: list_productivity_tools | N/A | Unverified | Unverified | EXT-F-4019-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### list_records_tools (EXT-F-4020)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4020-T01 Controlled manual execution: list_records_tools | N/A | Unverified | Unverified | EXT-F-4020-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Runtime and dispatcher authorization remain unverified; reviewed manual-run procedures are source-only.


### chrome_batch (EXT-F-4021)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4021-T01 Controlled manual execution: chrome_batch | N/A | Unverified | Unverified | EXT-F-4021-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### read_page (EXT-F-4022)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4022-T01 Read visible controls and text from a public page | N/A | Unverified | Unverified | EXT-F-4022-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### find (EXT-F-4023)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4023-T01 Find a known heading on the active public page before and after reload | N/A | Unverified | Unverified | EXT-F-4023-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### get_page_text (EXT-F-4024)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4024-T01 Manual read: bounded text from owned fixture | N/A | Unverified | Unverified | EXT-F-4024-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### get_active_tab (EXT-F-4025)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4025-T01 Manual read: active tab metadata on owned fixture | N/A | Unverified | Unverified | EXT-F-4025-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### get_page_selection (EXT-F-4026)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4026-T01 Manual read: selected synthetic fixture text | N/A | Unverified | Unverified | EXT-F-4026-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### read_active_page (EXT-F-4027)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4027-T01 Capture structured data from the assigned active page | N/A | Unverified | Unverified | EXT-F-4027-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### take_screenshot (EXT-F-4028)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 3.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4028-T01 Controlled manual execution: take_screenshot | N/A | Unverified | Unverified | EXT-F-4028-C01, EXT-F-4028-C02, EXT-F-4028-C03 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### query_elements (EXT-F-4029)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4029-T01 Manual read: query exact fixture card and id attribute | N/A | Unverified | Unverified | EXT-F-4029-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### find_text_on_page (EXT-F-4030)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4030-T01 Manual read: find exact nonce on owned fixture | N/A | Unverified | Unverified | EXT-F-4030-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### get_page_links (EXT-F-4031)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4031-T01 Manual read: filter same-origin fixture link | N/A | Unverified | Unverified | EXT-F-4031-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### get_computed_style (EXT-F-4032)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4032-T01 Manual read: computed style for owned fixture element | N/A | Unverified | Unverified | EXT-F-4032-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### get_element_at_point (EXT-F-4033)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4033-T01 Manual read: identify element at recorded fixture coordinate | N/A | Unverified | Unverified | EXT-F-4033-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### inspect_element (EXT-F-4034)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4034-T01 Manual read: inspect synthetic fixture card | N/A | Unverified | Unverified | EXT-F-4034-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### get_element_details (EXT-F-4035)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4035-T01 Inspect a page element using a fresh read_page reference | N/A | Unverified | Unverified | EXT-F-4035-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### list_open_tabs (EXT-F-4036)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4036-T01 List loaded tabs and filter to a public target | N/A | Unverified | Unverified | EXT-F-4036-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### get_tab_groups (EXT-F-4037)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4037-T01 Read the tab-group list, including the empty state | N/A | Unverified | Unverified | EXT-F-4037-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### get_tab_info (EXT-F-4038)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4038-T01 Look up details for a known open public tab | N/A | Unverified | Unverified | EXT-F-4038-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### search_bookmarks (EXT-F-4039)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4039-T01 Search only synthetic public bookmarks in an isolated profile | N/A | Unverified | Unverified | EXT-F-4039-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### list_bookmark_tree (EXT-F-4040)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4040-T01 Read the shallow tree of synthetic public bookmarks | N/A | Unverified | Unverified | EXT-F-4040-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### search_history (EXT-F-4041)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4041-T01 Search known public visits in an isolated profile | N/A | Unverified | Unverified | EXT-F-4041-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### list_recent_history (EXT-F-4042)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4042-T01 Controlled manual execution: list_recent_history | N/A | Unverified | Unverified | EXT-F-4042-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### list_downloads (EXT-F-4043)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4043-T01 Controlled manual execution: list_downloads | N/A | Unverified | Unverified | EXT-F-4043-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### get_form_fields (EXT-F-4044)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4044-T01 Manual read: synthetic form discovery and secret redaction | N/A | Unverified | Unverified | EXT-F-4044-C01 |

**Other remaining work:** Manual-run procedures do not establish dispatcher permission or approval behavior; verify those through actual advertised-agent dispatch before claiming that coverage.; Confirm current catalog against imported source registry before source inventory signoff


### ai_check_availability (EXT-F-4045)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4045-T01 Controlled manual execution: ai_check_availability | N/A | Unverified | Unverified | EXT-F-4045-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.; EXT-D-0147: source repair has guarded regression/typecheck evidence; native warm/reload capability success and separate background-dispatch execution remain unverified.


### ai_summarize (EXT-F-4046)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4046-T01 Controlled manual execution: ai_summarize | N/A | Unverified | Unverified | EXT-F-4046-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.; EXT-D-0147: source repair has guarded regression/typecheck evidence; native warm/reload capability success and separate background-dispatch execution remain unverified.


### ai_classify (EXT-F-4047)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4047-T01 Controlled manual execution: ai_classify | N/A | Unverified | Unverified | EXT-F-4047-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.


### ai_extract_json (EXT-F-4048)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4048-T01 Controlled manual execution: ai_extract_json | N/A | Unverified | Unverified | EXT-F-4048-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.


### ai_translate (EXT-F-4049)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4049-T01 Controlled manual execution: ai_translate | N/A | Unverified | Unverified | EXT-F-4049-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.; EXT-D-0147: source repair has guarded regression/typecheck evidence; native warm/reload capability success and separate background-dispatch execution remain unverified.


### ai_detect_language (EXT-F-4050)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4050-T01 Controlled manual execution: ai_detect_language | N/A | Unverified | Unverified | EXT-F-4050-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.; EXT-D-0147: source repair has guarded regression/typecheck evidence; native warm/reload capability success and separate background-dispatch execution remain unverified.


### ai_proofread (EXT-F-4051)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4051-T01 Controlled manual execution: ai_proofread | N/A | Unverified | Unverified | EXT-F-4051-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.; EXT-D-0147: source repair has guarded regression/typecheck evidence; native warm/reload capability success and separate background-dispatch execution remain unverified.


### ai_describe_image (EXT-F-4052)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4052-T01 Controlled manual execution: ai_describe_image | N/A | Unverified | Unverified | EXT-F-4052-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.


### ai_check_prompt_injection (EXT-F-4053)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0147

**Linked defects:** [EXT-D-0147](defects/EXT-D-0147.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4053-T01 Controlled manual execution: ai_check_prompt_injection | N/A | Unverified | Unverified | EXT-F-4053-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Manual Internal delegates procedure source-reviewed; real capability success, unavailable branch, member/admin warm/reload, dispatcher permissions and live advertisement remain unverified. See .research/native-ai-procedure-peer-20261006.json and .research/native-ai-fixture-peer-20261006.json. Historical exact-name binding absence is not current DB verification.


### navigate_active_tab (EXT-F-4054)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4054-T01 Controlled manual execution: navigate_active_tab | N/A | Unverified | Unverified | EXT-F-4054-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### click_element (EXT-F-4055)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4055-T01 Controlled manual execution: click_element | N/A | Unverified | Unverified | EXT-F-4055-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### type_into_element (EXT-F-4056)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4056-T01 Controlled manual execution: type_into_element | N/A | Unverified | Unverified | EXT-F-4056-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### scroll_page (EXT-F-4057)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4057-T01 Controlled manual execution: scroll_page | N/A | Unverified | Unverified | EXT-F-4057-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### wait_for (EXT-F-4058)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4058-T01 Controlled manual execution: wait_for | N/A | Unverified | Unverified | EXT-F-4058-C01 |

**Other remaining work:** Manual Tools uses the raw handler list and invokes the selected handler object; agent dispatch instead resolves the canonical name winner EXT-F-4156. Author and execute entry-path-specific procedures; native visibility and execution remain unverified.


### set_clipboard (EXT-F-4059)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4059-T01 Controlled manual execution: set_clipboard | N/A | Unverified | Unverified | EXT-F-4059-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### sleep (EXT-F-4060)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4060-T01 Controlled manual execution: sleep | N/A | Unverified | Unverified | EXT-F-4060-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### press_keys (EXT-F-4061)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4061-T01 Controlled manual execution: press_keys | N/A | Unverified | Unverified | EXT-F-4061-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### hover_element (EXT-F-4062)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4062-T01 Controlled manual execution: hover_element | N/A | Unverified | Unverified | EXT-F-4062-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### focus_element (EXT-F-4063)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4063-T01 Controlled manual execution: focus_element | N/A | Unverified | Unverified | EXT-F-4063-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### blur_element (EXT-F-4064)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4064-T01 Controlled manual execution: blur_element | N/A | Unverified | Unverified | EXT-F-4064-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### right_click_element (EXT-F-4065)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4065-T01 Controlled manual execution: right_click_element | N/A | Unverified | Unverified | EXT-F-4065-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### select_dropdown_option (EXT-F-4066)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4066-T01 Controlled manual execution: select_dropdown_option | N/A | Unverified | Unverified | EXT-F-4066-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### set_checkbox (EXT-F-4067)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4067-T01 Controlled manual execution: set_checkbox | N/A | Unverified | Unverified | EXT-F-4067-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### set_radio (EXT-F-4068)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4068-T01 Controlled manual execution: set_radio | N/A | Unverified | Unverified | EXT-F-4068-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### submit_form (EXT-F-4069)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4069-T01 Controlled manual execution: submit_form | N/A | Unverified | Unverified | EXT-F-4069-C01 |

**Other remaining work:** Confirm current catalog against imported source registry before source inventory signoff; Native runner route gap: the checked-in owned fixture is source-checked, but `/form-controls` is only served on the test’s ephemeral server. Register it in the owning native runner through `ownedPages`, then record the actual URL and verify served-byte SHA-256 before execution.; Agent-dispatch Ask/Act confirmation and missing-permission refusal remain unverified; manual Tools Run bypasses dispatcher gate.; Live tool.binding advertisement and actual request-time member/admin availability remain unresolved by the local runner.


### file_upload (EXT-F-4070)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4070-T01 Controlled manual execution: file_upload | N/A | Unverified | Unverified | EXT-F-4070-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### open_new_tab (EXT-F-4071)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4071-T01 Controlled manual execution: open_new_tab | N/A | Unverified | Unverified | EXT-F-4071-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### close_tab (EXT-F-4072)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4072-T01 Controlled manual execution: close_tab | N/A | Unverified | Unverified | EXT-F-4072-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### switch_to_tab (EXT-F-4073)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4073-T01 Controlled manual execution: switch_to_tab | N/A | Unverified | Unverified | EXT-F-4073-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### duplicate_tab (EXT-F-4074)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4074-T01 Controlled manual execution: duplicate_tab | N/A | Unverified | Unverified | EXT-F-4074-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### pin_tab (EXT-F-4075)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4075-T01 Controlled manual execution: pin_tab | N/A | Unverified | Unverified | EXT-F-4075-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### mute_tab (EXT-F-4076)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4076-T01 Controlled manual execution: mute_tab | N/A | Unverified | Unverified | EXT-F-4076-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### reload_tab (EXT-F-4077)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4077-T01 Controlled manual execution: reload_tab | N/A | Unverified | Unverified | EXT-F-4077-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### go_back (EXT-F-4078)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4078-T01 Controlled manual execution: go_back | N/A | Unverified | Unverified | EXT-F-4078-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff; Optional `tab_id` omitted/manual active-tab fallback is covered by the added variant; assigned-agent tab pinning remains unverified, and other optional/default combinations are not exhaustive.


### go_forward (EXT-F-4079)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4079-T01 Controlled manual execution: go_forward | N/A | Unverified | Unverified | EXT-F-4079-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff; Optional `tab_id` omitted/manual active-tab fallback is covered by the added variant; assigned-agent tab pinning remains unverified, and other optional/default combinations are not exhaustive.


### set_tab_zoom (EXT-F-4080)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4080-T01 Controlled manual execution: set_tab_zoom | N/A | Unverified | Unverified | EXT-F-4080-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff; Optional `tab_id` omitted/manual active-tab fallback is covered by the added variant; assigned-agent tab pinning remains unverified, and other optional/default combinations are not exhaustive.


### move_tab (EXT-F-4081)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4081-T01 Controlled manual execution: move_tab | N/A | Unverified | Unverified | EXT-F-4081-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### resize_window (EXT-F-4082)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4082-T01 Controlled manual execution: resize_window | N/A | Unverified | Unverified | EXT-F-4082-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff; Optional `tab_id` omitted/manual active-tab fallback is covered by the added variant; assigned-agent tab pinning remains unverified, and other optional/default combinations are not exhaustive.


### create_tab_group (EXT-F-4083)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4083-T01 Controlled manual execution: create_tab_group | N/A | Unverified | Unverified | EXT-F-4083-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### add_tabs_to_group (EXT-F-4084)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4084-T01 Controlled manual execution: add_tabs_to_group | N/A | Unverified | Unverified | EXT-F-4084-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### remove_tabs_from_group (EXT-F-4085)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4085-T01 Controlled manual execution: remove_tabs_from_group | N/A | Unverified | Unverified | EXT-F-4085-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### update_tab_group (EXT-F-4086)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4086-T01 Controlled manual execution: update_tab_group | N/A | Unverified | Unverified | EXT-F-4086-C01 |

**Other remaining work:** Agent-dispatch Ask/Act confirmation and missing-permission runtime refusal remain unverified; the manual Tools runner bypasses the dispatcher gate.; Live tool.binding advertisement and member/admin role availability remain unverified; the manual Tools runner does not establish either.; Confirm current catalog against imported source registry before source inventory signoff


### download_url (EXT-F-4087)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4087-T01 Controlled manual execution: download_url | N/A | Unverified | Unverified | EXT-F-4087-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cancel_download (EXT-F-4088)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4088-T01 Controlled manual execution: cancel_download | N/A | Unverified | Unverified | EXT-F-4088-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### credential_login (EXT-F-4089)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 2. **Controls:** 10.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4089-T01 Controlled manual execution: credential_login | N/A | Unverified | Unverified | EXT-F-4089-C01, EXT-F-4089-C02, EXT-F-4089-C03, EXT-F-4089-C04, EXT-F-4089-C05, EXT-F-4089-C06, EXT-F-4089-C07, EXT-F-4089-C08, EXT-F-4089-C09 |
| EXT-F-4089-T02 Reject failed or missing navigation document during credential execution | N/A | Unverified | Unverified | EXT-F-4089-C10 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### capture_prospect (EXT-F-4090)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 3.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4090-T01 Controlled manual execution: capture_prospect | N/A | Unverified | Unverified | EXT-F-4090-C01, EXT-F-4090-C02, EXT-F-4090-C03 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### capture_study_set (EXT-F-4091)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 4.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4091-T01 Controlled manual execution: capture_study_set with organization handling | N/A | Unverified | Unverified | EXT-F-4091-C01, EXT-F-4091-C02, EXT-F-4091-C03, EXT-F-4091-C04 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### google_email_send (EXT-F-4092)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4092-T01 Controlled manual execution: google_email_send | N/A | Unverified | Unverified | EXT-F-4092-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### remember_for_domain (EXT-F-4093)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4093-T01 Controlled manual execution: remember_for_domain | N/A | Unverified | Unverified | EXT-F-4093-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### list_recently_closed (EXT-F-4094)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4094-T01 Controlled manual execution: list_recently_closed | N/A | Unverified | Unverified | EXT-F-4094-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### restore_recently_closed (EXT-F-4095)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4095-T01 Controlled manual execution: restore_recently_closed | N/A | Unverified | Unverified | EXT-F-4095-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### chrome_save_page_as_mhtml (EXT-F-4096)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4096-T01 Controlled manual execution: chrome_save_page_as_mhtml | N/A | Unverified | Unverified | EXT-F-4096-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### get_cookies (EXT-F-4097)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4097-T01 Controlled manual execution: get_cookies | N/A | N/A | Unverified | EXT-F-4097-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### set_cookie (EXT-F-4098)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4098-T01 Controlled manual execution: set_cookie | N/A | N/A | Unverified | EXT-F-4098-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### delete_cookie (EXT-F-4099)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4099-T01 Controlled manual execution: delete_cookie | N/A | N/A | Unverified | EXT-F-4099-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_attach (EXT-F-4100)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4100-T01 Controlled manual execution: cdp_attach | N/A | N/A | Unverified | EXT-F-4100-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_detach (EXT-F-4101)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4101-T01 Controlled manual execution: cdp_detach | N/A | N/A | Unverified | EXT-F-4101-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_attached_tabs (EXT-F-4102)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4102-T01 Controlled manual execution: cdp_attached_tabs | N/A | N/A | Unverified | EXT-F-4102-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_full_page_screenshot (EXT-F-4103)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4103-T01 Controlled manual execution: cdp_full_page_screenshot | N/A | Unverified | Unverified | EXT-F-4103-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_a11y_tree (EXT-F-4104)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4104-T01 Controlled manual execution: cdp_a11y_tree | N/A | Unverified | Unverified | EXT-F-4104-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_input_click_xy (EXT-F-4105)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4105-T01 Controlled manual execution: cdp_input_click_xy | N/A | Unverified | Unverified | EXT-F-4105-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_input_type (EXT-F-4106)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4106-T01 Controlled manual execution: cdp_input_type | N/A | Unverified | Unverified | EXT-F-4106-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_network_capture_start (EXT-F-4107)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4107-T01 Controlled manual execution: cdp_network_capture_start | N/A | Unverified | Unverified | EXT-F-4107-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_network_capture_drain (EXT-F-4108)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4108-T01 Controlled manual execution: cdp_network_capture_drain | N/A | Unverified | Unverified | EXT-F-4108-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_network_capture_stop (EXT-F-4109)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4109-T01 Controlled manual execution: cdp_network_capture_stop | N/A | Unverified | Unverified | EXT-F-4109-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_network_get_body (EXT-F-4110)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4110-T01 Controlled manual execution: cdp_network_get_body | N/A | Unverified | Unverified | EXT-F-4110-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_print_pdf (EXT-F-4111)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4111-T01 Controlled manual execution: cdp_print_pdf | N/A | Unverified | Unverified | EXT-F-4111-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_perf_metrics (EXT-F-4112)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4112-T01 Controlled manual execution: cdp_perf_metrics | N/A | Unverified | Unverified | EXT-F-4112-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_emulate_device (EXT-F-4113)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4113-T01 Controlled manual execution: cdp_emulate_device | N/A | N/A | Unverified | EXT-F-4113-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_clear_emulation (EXT-F-4114)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4114-T01 Controlled manual execution: cdp_clear_emulation | N/A | N/A | Unverified | EXT-F-4114-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### read_console_messages (EXT-F-4115)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4115-T01 Controlled manual execution: read_console_messages | N/A | Unverified | Unverified | EXT-F-4115-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### read_network_requests (EXT-F-4116)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4116-T01 Controlled manual execution: read_network_requests | N/A | Unverified | Unverified | EXT-F-4116-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### get_request_body (EXT-F-4117)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4117-T01 Controlled manual execution: get_request_body | N/A | Unverified | Unverified | EXT-F-4117-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### webmcp_check_availability (EXT-F-4118)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4118-T01 Controlled manual execution: webmcp_check_availability | N/A | N/A | Unverified | EXT-F-4118-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### webmcp_list_page_tools (EXT-F-4119)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4119-T01 Controlled manual execution: webmcp_list_page_tools | N/A | N/A | Unverified | EXT-F-4119-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### webmcp_call_page_tool (EXT-F-4120)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4120-T01 Controlled manual execution: webmcp_call_page_tool | N/A | N/A | Unverified | EXT-F-4120-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### user (EXT-F-4121)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4121-T01 Controlled manual execution: user | N/A | Unverified | Unverified | EXT-F-4121-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### request_user_takeover (EXT-F-4122)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4122-T01 Controlled manual execution: request_user_takeover | N/A | Unverified | Unverified | EXT-F-4122-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### update_plan (EXT-F-4123)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4123-T01 Controlled manual execution: update_plan | N/A | Unverified | Unverified | EXT-F-4123-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### user_todos (EXT-F-4124)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 7.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4124-T01 Controlled manual execution: user_todos | N/A | Unverified | Unverified | EXT-F-4124-C01, EXT-F-4124-C02, EXT-F-4124-C03, EXT-F-4124-C04, EXT-F-4124-C05, EXT-F-4124-C06, EXT-F-4124-C07 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### inject_stylesheet (EXT-F-4125)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4125-T01 Controlled manual execution: inject_stylesheet | N/A | Unverified | Unverified | EXT-F-4125-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### remove_stylesheet (EXT-F-4126)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4126-T01 Controlled manual execution: remove_stylesheet | N/A | Unverified | Unverified | EXT-F-4126-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### desktop_run_command (EXT-F-4127)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4127-T01 Controlled manual execution: desktop_run_command | N/A | Unverified | Unverified | EXT-F-4127-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### parallel_for_each_tab (EXT-F-4128)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4128-T01 Controlled manual execution: parallel_for_each_tab | N/A | N/A | Unverified | EXT-F-4128-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### chrome_record_gif (EXT-F-4129)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 5.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4129-T01 Controlled manual execution: chrome_record_gif | N/A | Unverified | Unverified | EXT-F-4129-C01, EXT-F-4129-C02, EXT-F-4129-C03, EXT-F-4129-C04, EXT-F-4129-C05 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### records (EXT-F-4130)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 2. **Controls:** 25.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0071, EXT-D-0089, EXT-D-0091

**Linked defects:** [EXT-D-0071](defects/EXT-D-0071.json) (fixed), [EXT-D-0089](defects/EXT-D-0089.json) (fixed), [EXT-D-0091](defects/EXT-D-0091.json) (in-fix)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4130-T01 Controlled manual execution: records | N/A | Unverified | Unverified | EXT-F-4130-C01, EXT-F-4130-C02, EXT-F-4130-C03, EXT-F-4130-C04, EXT-F-4130-C05, EXT-F-4130-C06, EXT-F-4130-C07, EXT-F-4130-C08, EXT-F-4130-C09, EXT-F-4130-C10, EXT-F-4130-C11, EXT-F-4130-C12, EXT-F-4130-C13, EXT-F-4130-C14, EXT-F-4130-C15, EXT-F-4130-C16, EXT-F-4130-C17, EXT-F-4130-C18, EXT-F-4130-C19, EXT-F-4130-C20, EXT-F-4130-C21, EXT-F-4130-C22, EXT-F-4130-C23, EXT-F-4130-C24, EXT-F-4130-C25 |
| EXT-F-4130-T02 Records organization filter matches canonical catalog and preserves omitted/null semantics | N/A | Unverified | Unverified | EXT-F-4130-C01 |

**Other remaining work:** Author concrete fixture-specific server procedures before this tool is executed; gated/negative permission cases required; Current source identifies a server capability, absent from the local generated executor catalog. Imported input schema and live DB binding need fresh reconciliation.


### chrome_record_tab_video (EXT-F-4131)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4131-T01 Controlled manual execution: chrome_record_tab_video | N/A | Unverified | Unverified | EXT-F-4131-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### record_demo (EXT-F-4132)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4132-T01 Controlled manual execution: record_demo | N/A | Unverified | Unverified | EXT-F-4132-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### list_demos (EXT-F-4133)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4133-T01 Controlled manual execution: list_demos | N/A | Unverified | Unverified | EXT-F-4133-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### describe_demo (EXT-F-4134)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 2. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0070

**Linked defects:** [EXT-D-0070](defects/EXT-D-0070.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4134-T01 Controlled manual execution: describe_demo | N/A | Unverified | Unverified | EXT-F-4134-C01 |
| EXT-F-4134-T02 Demo read failure is distinct from a missing recording | N/A | Unverified | Unverified | EXT-F-4134-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### replay_demo (EXT-F-4135)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 2. **Controls:** 1.

**Next:** Resolve linked defect and repeat its affected native case: EXT-D-0070

**Linked defects:** [EXT-D-0070](defects/EXT-D-0070.json) (fixed)

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4135-T01 Controlled manual execution: replay_demo | N/A | Unverified | Unverified | EXT-F-4135-C01 |
| EXT-F-4135-T02 Demo read failure is distinct from a missing recording | N/A | Unverified | Unverified | EXT-F-4135-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### delete_demo (EXT-F-4136)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4136-T01 Controlled manual execution: delete_demo | N/A | Unverified | Unverified | EXT-F-4136-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### save_guidance_note (EXT-F-4137)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4137-T01 Controlled manual execution: save_guidance_note | N/A | Unverified | Unverified | EXT-F-4137-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### list_guidance (EXT-F-4138)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4138-T01 Controlled manual execution: list_guidance | N/A | Unverified | Unverified | EXT-F-4138-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### get_guidance_item (EXT-F-4139)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4139-T01 Controlled manual execution: get_guidance_item | N/A | Unverified | Unverified | EXT-F-4139-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### delete_guidance_item (EXT-F-4140)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4140-T01 Controlled manual execution: delete_guidance_item | N/A | Unverified | Unverified | EXT-F-4140-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### list_highlights (EXT-F-4141)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4141-T01 Controlled manual execution: list_highlights | N/A | Unverified | Unverified | EXT-F-4141-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### extract_table (EXT-F-4142)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4142-T01 Controlled manual execution: extract_table | N/A | Unverified | Unverified | EXT-F-4142-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### screenshot_region (EXT-F-4143)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4143-T01 Controlled manual execution: screenshot_region | N/A | Unverified | Unverified | EXT-F-4143-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### get_clipboard (EXT-F-4144)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4144-T01 Controlled manual execution: get_clipboard | N/A | Unverified | Unverified | EXT-F-4144-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### chrome_tab_audio_inspect (EXT-F-4145)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4145-T01 Controlled manual execution: chrome_tab_audio_inspect | N/A | Unverified | Unverified | EXT-F-4145-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### mutation_watch (EXT-F-4146)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4146-T01 Controlled manual execution: mutation_watch | N/A | Unverified | Unverified | EXT-F-4146-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### extract_microdata (EXT-F-4147)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4147-T01 Controlled manual execution: extract_microdata | N/A | Unverified | Unverified | EXT-F-4147-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### data_patterns (EXT-F-4148)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 7.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4148-T01 Controlled manual execution: data_patterns | N/A | Unverified | Unverified | EXT-F-4148-C01, EXT-F-4148-C02, EXT-F-4148-C03, EXT-F-4148-C04, EXT-F-4148-C05, EXT-F-4148-C06, EXT-F-4148-C07 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### fetch_url_as_markdown (EXT-F-4149)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4149-T01 Controlled manual execution: fetch_url_as_markdown | N/A | Unverified | Unverified | EXT-F-4149-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### computer (EXT-F-4150)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 14.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4150-T01 Controlled manual execution: computer | N/A | Unverified | Unverified | EXT-F-4150-C01, EXT-F-4150-C02, EXT-F-4150-C03, EXT-F-4150-C04, EXT-F-4150-C05, EXT-F-4150-C06, EXT-F-4150-C07, EXT-F-4150-C08, EXT-F-4150-C09, EXT-F-4150-C10, EXT-F-4150-C11, EXT-F-4150-C12, EXT-F-4150-C13, EXT-F-4150-C14 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### form_input (EXT-F-4151)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4151-T01 Controlled manual execution: form_input | N/A | Unverified | Unverified | EXT-F-4151-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### navigate (EXT-F-4152)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4152-T01 Controlled manual execution: navigate | N/A | Unverified | Unverified | EXT-F-4152-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### tabs (EXT-F-4153)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 13.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4153-T01 Controlled manual execution: tabs | N/A | Unverified | Unverified | EXT-F-4153-C01, EXT-F-4153-C02, EXT-F-4153-C03, EXT-F-4153-C04, EXT-F-4153-C05, EXT-F-4153-C06, EXT-F-4153-C07, EXT-F-4153-C08, EXT-F-4153-C09, EXT-F-4153-C10, EXT-F-4153-C11, EXT-F-4153-C12, EXT-F-4153-C13 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### downloads (EXT-F-4154)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 5.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4154-T01 Controlled manual execution: downloads | N/A | Unverified | Unverified | EXT-F-4154-C01, EXT-F-4154-C02, EXT-F-4154-C03, EXT-F-4154-C04, EXT-F-4154-C05 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### clipboard (EXT-F-4155)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 3.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4155-T01 Controlled manual execution: clipboard | N/A | Unverified | Unverified | EXT-F-4155-C01, EXT-F-4155-C02, EXT-F-4155-C03 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### wait_for (EXT-F-4156)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 5.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4156-T01 Controlled manual execution: wait_for | N/A | Unverified | Unverified | EXT-F-4156-C01, EXT-F-4156-C02, EXT-F-4156-C03, EXT-F-4156-C04, EXT-F-4156-C05 |

**Other remaining work:** Author fixture-specific canonical wait_for procedures before execution; cover condition branches and permissions.


### upload_file (EXT-F-4157)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4157-T01 Controlled manual execution: upload_file | N/A | Unverified | Unverified | EXT-F-4157-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### drop_file (EXT-F-4158)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4158-T01 Controlled manual execution: drop_file | N/A | Unverified | Unverified | EXT-F-4158-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### read_pdf (EXT-F-4159)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 1.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4159-T01 Controlled manual execution: read_pdf | N/A | Unverified | Unverified | EXT-F-4159-C01 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### ai (EXT-F-4160)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 10.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4160-T01 Controlled manual execution: ai | N/A | Unverified | Unverified | EXT-F-4160-C01, EXT-F-4160-C02, EXT-F-4160-C03, EXT-F-4160-C04, EXT-F-4160-C05, EXT-F-4160-C06, EXT-F-4160-C07, EXT-F-4160-C08, EXT-F-4160-C09, EXT-F-4160-C10 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### chrome_cookies (EXT-F-4161)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 4.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4161-T01 Controlled manual execution: chrome_cookies | N/A | N/A | Unverified | EXT-F-4161-C01, EXT-F-4161-C02, EXT-F-4161-C03, EXT-F-4161-C04 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### chrome_webmcp (EXT-F-4162)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 4.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4162-T01 Controlled manual execution: chrome_webmcp | N/A | N/A | Unverified | EXT-F-4162-C01, EXT-F-4162-C02, EXT-F-4162-C03, EXT-F-4162-C04 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### tab_groups (EXT-F-4163)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 6.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4163-T01 Controlled manual execution: tab_groups | N/A | Unverified | Unverified | EXT-F-4163-C01, EXT-F-4163-C02, EXT-F-4163-C03, EXT-F-4163-C04, EXT-F-4163-C05, EXT-F-4163-C06 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### chrome_bookmarks (EXT-F-4164)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 3.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4164-T01 Controlled manual execution: chrome_bookmarks | N/A | Unverified | Unverified | EXT-F-4164-C01, EXT-F-4164-C02, EXT-F-4164-C03 |

**Other remaining work:** Execute reviewed bookmark procedure in member/admin profiles; dispatcher permission and runtime role behavior remain unverified; Confirm current catalog against imported source registry before source inventory signoff


### chrome_history (EXT-F-4165)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 3.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4165-T01 Controlled manual execution: chrome_history | N/A | Unverified | Unverified | EXT-F-4165-C01, EXT-F-4165-C02, EXT-F-4165-C03 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### chrome_recently_closed (EXT-F-4166)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 3.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4166-T01 Controlled manual execution: chrome_recently_closed | N/A | Unverified | Unverified | EXT-F-4166-C01, EXT-F-4166-C02, EXT-F-4166-C03 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### stylesheet (EXT-F-4167)

**Role status:** guest: N/A · member: Unverified · admin: Unverified. **Cases:** 1. **Controls:** 3.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4167-T01 Controlled manual execution: stylesheet | N/A | Unverified | Unverified | EXT-F-4167-C01, EXT-F-4167-C02, EXT-F-4167-C03 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_session (EXT-F-4168)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 4.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4168-T01 Controlled manual execution: cdp_session | N/A | N/A | Unverified | EXT-F-4168-C01, EXT-F-4168-C02, EXT-F-4168-C03, EXT-F-4168-C04 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff


### cdp_emulate (EXT-F-4169)

**Role status:** guest: N/A · member: N/A · admin: Unverified. **Cases:** 1. **Controls:** 3.

**Next:** Run the remaining role cases in the extension and attach a result.

| Case | Guest | Member | Admin | Controls exercised by case |
| --- | --- | --- | --- | --- |
| EXT-F-4169-T01 Controlled manual execution: cdp_emulate | N/A | N/A | Unverified | EXT-F-4169-C01, EXT-F-4169-C02, EXT-F-4169-C03 |

**Other remaining work:** Author concrete fixture-specific procedures before this tool is executed; gated/negative permission cases required; Confirm current catalog against imported source registry before source inventory signoff

