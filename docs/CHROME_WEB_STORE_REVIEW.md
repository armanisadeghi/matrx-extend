# Matrx Extend Chrome Web Store review record

## Current decision

Version `0.1.72` was successfully published on 2026-08-19 to the existing
public item `hnfolienncfklkgmdjjmhhegglimlamg`. Versions `0.1.74`–`0.1.76` are
superseded and must not be uploaded. Version `0.2.0` is the current validated
Store candidate at `.output/matrx-extend-0.2.0-store.zip` (SHA-256
`7a1bbd7ca47c5ba248146b44064b8b9ba40fdc0513b61b653200703b06a6f442`). It has
not yet been uploaded. Never upload the sibling `-local.zip` artifact.

The submitted listing contains the four current 1280 × 800 images from
`.output/cws-assets/`, in this order: Chat, Capture, SEO, Settings. The optional
small promo tile and marquee promo tile were deliberately left empty because
neither is required for review and they add no evidence for the extension's
single purpose. Dashboard text remains canonical in `docs/CWS_LISTING_DRAFT.md`.

Do not use the duplicate draft item `pifjakncjcpnkjbdlijgddhiipdlfbde`.

## Ongoing release system

Every Store package now runs `scripts/check-cws-release-risk.mjs` through
`pnpm zip:store`. The gate blocks any drift from the policy surface Google
published for `0.1.72`: name/summary, required and optional permissions, host
access, side-panel/action behavior, externally connectable origins, and content
scripts. It also scans emitted JavaScript for forbidden runtime-code paths.
The approved surface is recorded in
`config/chrome-web-store-approved-baseline.json` and is updated only after
Google publishes a changed surface.

Code cannot determine whether every new feature changes the truth of the Store
listing or privacy disclosures. The repository skill
`.claude/skills/chrome-web-store-release/SKILL.md` owns that semantic review,
dashboard submission, status monitoring, and evidence update. Routine updates
with an unchanged policy surface require no separate communication to Google;
Store-material changes require the affected listing/privacy/reviewer evidence
to be reconciled before submission.

Versioning is three-part SemVer. `0.2.0` is the first post-approval public
testing line. Patch releases are compatible fixes, minor releases are
meaningful compatible feature batches, and `1.0.0` is reserved for the
intentional general-availability launch after public testing and a focused
Store-marketing refresh. Use `0.2.0`, never `0.2.00`.

## Why the previous submission failed

The live dashboard records this rejection:

- **Date:** 2026-05-16
- **Type:** Content Policies
- **Reference:** Red Potassium
- **Finding:** functionality described in the listing was not working or reproducible during review

The rejected version advertised several workflows but supplied no reviewer username, password, or additional instructions. A reviewer had no deterministic page, path, or expected result. The new submission fixes that directly with guest access, a stable public demo page, exact steps, and current screenshots.

## Release changes made for review

- The manifest and package summary now state one purpose: an AI assistant for understanding and working with the page open in the browser.
- Automatic page capture is off on fresh installations. Users may opt in through Settings.
- Page data is parsed as strict JSON. The two remaining `new Function` fallbacks were removed.
- The extension-specific privacy policy now matches the real default, host access, content-script bridge, optional automation, and confirmation behavior.
- `/matrx-extend-demo` provides stable public article, table, link, metadata, and JSON-LD content without detecting or treating reviewers differently.
- Reviewer instructions require no account and state exact expected results.
- The Store package has no toolbar popup. Clicking the Matrx Extend action has
  one result: Chrome opens the side panel. `pnpm zip:store` fails if a popup or
  development manifest key reappears.
- Guest field selection now stops at an explicit account boundary: selectors
  remain usable without an account, while saving offers the real sign-in action
  instead of a guaranteed-failure request. Guest Settings likewise says **Sign
  in**, never **Sign out**.
- Every agent-start path now resolves the bearer/fingerprint identity's
  effective organization through `/auth/whoami`; a clean-install guest never
  guesses or hardcodes conversation ownership.
- Fresh Chat now names `chat.default_new_chat`; aidream resolves its Holder for
  the guest/user at request time. The extension no longer ships a default
  Agent UUID.
- The agent-list validator now matches the live `agx_get_list_full()` contract
  (`created_by`, no retired `user_id`/`project_id`) instead of rejecting every
  valid row and silently masking the failure with a synthetic Agent.

## Policy posture

### Remote code

The public build must contain no executable string path. Verify source and emitted JavaScript contain none of:

- `eval(`
- `new Function`
- `Runtime.evaluate`
- `Runtime.callFunctionOn`
- `Runtime.compileScript`

The agent tool dispatcher remains compliant: the server selects a compiled handler name and supplies validated data arguments. Executable logic is packaged in the submitted extension.

### Single purpose

The single purpose is:

> Matrx Extend is an AI side-panel assistant that helps the user understand and work with the web page they are currently viewing.

Capture, page-aware chat, structured extraction, SEO inspection, and requested page actions all support that purpose. Reviewer-facing copy must not present them as unrelated products.

### Page access and automation

- A lightweight content-script bridge is present on ordinary web pages.
- Fresh installations do not automatically capture or transmit page content.
- Page content is captured when a user invokes a page-aware feature.
- Automatic capture is a separate, disclosed opt-in setting.
- The default action mode asks before state-changing actions; privileged actions always ask.
- Never claim that every action always asks or that no code is present on pages before invocation.

### `debugger`

Keep `debugger` for this submission because it powers real user-facing screencasting, network inspection, full-page screenshot, PDF, accessibility-tree, difficult-interaction, and emulation functions and Chrome forbids it as an optional permission.

The extension must never use `Runtime.evaluate`, `Runtime.callFunctionOn`, or `Runtime.compileScript`. If Google rejects specifically because of `debugger`, prepare a separate public build without its dependent capabilities rather than arguing indefinitely.

## Submission gates

### Source and package

- [x] Version is higher than rejected `0.1.63` and published `0.1.4`.
- [x] Fresh-install automatic capture defaults off.
- [x] No source `eval` or `new Function` remains.
- [x] Full compile and test suite pass after final edits.
- [x] `pnpm zip:store` builds the store zip without the development manifest key or a toolbar popup.
- [x] Zip manifest version, summary, permissions, and CSP are inspected.
- [x] Emitted JavaScript passes the remote-code string audit.

### Public disclosure

- [x] Listing copy is narrowed to one purpose.
- [x] Reviewer steps are deterministic and under 500 characters.
- [x] Extension-specific privacy source matches behavior.
- [x] Stable public demo-page source exists.
- [x] Public demo page and extension privacy policy resolve successfully from an anonymous browser.

### Clean-profile test

Use a brand-new Chrome profile with no AI Matrx login and only the exact unpacked store build installed.

- [x] Side panel opens from the toolbar icon.
- [x] Guest banner appears and no account is required.
- [x] Settings shows automatic capture off before any change.
- [x] Capture produces the demo article, links, and schema.
- [x] SEO produces an audit for the demo page.
- [x] Data can select or extract fields from the workflow table without a dead end.
- [x] Chat answers the three-stage question with Capture, Understand, and Use.
- [x] No uncaught side-panel or service-worker error affects these paths.

### Dashboard

- [x] Primary item `hnfolienncfklkgmdjjmhhegglimlamg` receives the new zip.
- [x] Listing fields exactly match `docs/CWS_LISTING_DRAFT.md`.
- [x] Privacy policy URL is `/privacy-policy/extension`.
- [x] Data disclosures and Limited Use certifications match this record.
- [x] Permission justifications exactly match this release.
- [x] Reviewer username and password remain blank; additional instructions are filled.
- [x] Four current 1280 × 800 screenshots are uploaded in the documented order.
- [x] Distribution settings are checked without using the duplicate item.
- [x] Arman explicitly authorized the final Submit for review action.
- [x] Google approved and published version `0.1.72`; the live item status is
  **Published - public**.

## Evidence log

| Time (America/Los_Angeles) | Evidence |
|---|---|
| 2026-08-17 | Live dashboard confirmed primary draft `0.1.63` rejected and published `0.1.4`; duplicate item `pifjakncjcpnkjbdlijgddhiipdlfbde` remains an unused draft. |
| 2026-08-17 | Live rejection detail and the completely blank reviewer-instructions section were recorded. |
| 2026-08-17 | `pnpm compile`, `pnpm test` (398 tests), schema-routing check, and docs-pointer check passed before final copy/default edits. |
| 2026-08-17 | Focused strict-JSON parser test passed after removing both page-data execution fallbacks. |
| 2026-08-17 03:45 PDT | Final `pnpm compile`, `pnpm test` (400 tests), strict schema-routing, strict docs-pointer, tool-DB drift, and `pnpm zip:store` passed. |
| 2026-08-17 03:45 PDT | Initial Store artifact inspection passed; this artifact was superseded by the 04:11 toolbar correction below. |
| 2026-08-17 03:45 PDT | Exact clean Store build in a fresh Chrome-for-Testing profile, with no AI Matrx login: guest banner shown; auto-capture off; explicit Capture returned the 130-word demo article, 10 links, and schema; SEO returned a full audit; no runtime exception on either path. |
| 2026-08-17 03:45 PDT | Guest Chat found a live contract regression before submission: agent start returned 422 because `organization_id` was absent. The server bootstrap and every extension agent-start path were fixed, typed, tested, built, committed, and pushed; the clean live chat rerun remains required before checking the Chat gate. |
| 2026-08-17 03:48 PDT | Anonymous public checks returned HTTP 200 for `https://www.aimatrx.com/matrx-extend-demo` and `https://www.aimatrx.com/privacy-policy/extension`. A second brand-new Chrome profile loaded the exact Store build on the public demo URL: guest mode and auto-capture-off confirmed; Capture returned the 130-word article, 10 links, and schema; SEO returned `LOOKS GOOD`; no runtime exceptions affected either path. |
| 2026-08-17 04:11 PDT | Found and removed a packaging conflict before submission: WXT had auto-generated `action.default_popup`, so the toolbar could show a legacy sign-in popup instead of opening the guest-capable side panel. The Store build now excludes that popup and has a blocking package validator. This intermediate artifact was superseded by the final guest-boundary corrections below. |
| 2026-08-17 04:32 PDT | Final source validation passed: compile, all 400 tests, tool-DB drift, Store packaging guard, and emitted JavaScript execution-string audit. Artifact `.output/matrx-extend-0.1.70-chrome.zip` SHA-256 `828d3560bb62607b9b69bc295f3bcb534f08b3181852cc6422e7bb9f3675f192`; manifest version `0.1.70`, no development key, no popup, canonical side panel, and action behavior `openPanelOnActionClick: true`. |
| 2026-08-17 04:32 PDT | Brand-new no-login profile loaded that exact package. Guest banner and Settings sign-in state were truthful; auto-capture was off; Capture returned the 130-word article, 10 links, and schema; SEO returned `LOOKS GOOD`; Data selected two workflow-table fields and offered `Sign in to save` with no false connection error. Runtime monitoring recorded no side-panel or service-worker exception during these paths. |
| 2026-08-17 07:44 PDT | The real toolbar-open path exposed a React StrictMode race before submission: the remount could reuse a Supabase Realtime channel while asynchronous cleanup was still pending, causing the side panel error boundary to report that `postgres_changes` callbacks could not be added after subscription. Each effect mount now uses an independent channel topic; version `0.1.70` is superseded and must not be uploaded. |
| 2026-08-17 07:51 PDT | Version `0.1.71` passed TypeScript compile, all 401 tests, tool-DB drift, Store packaging guard, manifest inspection, and the emitted-JavaScript execution-string audit. Candidate artifact `.output/matrx-extend-0.1.71-chrome.zip` SHA-256 `58ef3926b31d54c0706d72a0aea3b5a7555e399704f0519635698b3086da09b0`; manifest has no development key or popup and retains the canonical side panel. |
| 2026-08-17 08:23 PDT | Clean guest Chat exposed two pre-submission contract defects: the extension rejected every live `agx_get_list_full()` row because it still required retired ownership fields, then used a hardcoded fallback Agent. The RPC schema now uses canonical `created_by`, and fresh Chat uses the server-resolved `chat.default_new_chat` Mandate. Version `0.1.71` is superseded and must not be uploaded. |
| 2026-08-17 08:47 PDT | Version `0.1.72` passed TypeScript compile, all 404 tests, tool-DB drift, schema-routing, docs-pointer, Store packaging guard, manifest inspection, and the emitted-JavaScript execution-string audit. Candidate artifact `.output/matrx-extend-0.1.72-chrome.zip` SHA-256 `28a37535e1d40c13aa23b1fc5d7b62d54909db3439b297aa7894bc35d92ec4eb`; manifest has no development key or popup and retains the canonical side panel. All clean-profile gates were reset pending a brand-new exact-build pass. |
| 2026-08-17 08:50 PDT | Brand-new no-login Chrome profile loaded the exact `0.1.72` build. The real toolbar path opened the side panel; the guest banner appeared; Settings showed version `0.1.72` and automatic capture off; Capture returned the 130-word article, 10 links, and schema; SEO returned `LOOKS GOOD`; Data selected two workflow-table fields and offered `Sign in to save` without a dead end. |
| 2026-08-17 08:56 PDT | Uploaded `.output/matrx-extend-0.1.72-chrome.zip` to the primary item `hnfolienncfklkgmdjjmhhegglimlamg`; the dashboard immediately reflected the new package summary. No action was taken on duplicate draft `pifjakncjcpnkjbdlijgddhiipdlfbde`. Current exact-build screenshots saved as `.output/cws-assets/02-capture.jpeg`, `03-seo.jpeg`, and `04-settings.jpeg`, each normalized to 1280 × 800; Chat remains pending. |
| 2026-08-17 09:24 PDT | Reconciled and saved the live primary-item dashboard: narrow Store description; current valid **Tools** category; extension-specific privacy-policy URL; exact single-purpose and permission explanations; remote-code answer; all six data categories; all three Limited Use certifications; blank reviewer credentials; deterministic 401-character no-login reviewer instructions; and free/public/all-regions distribution. The dashboard already holds four screenshots, but Screenshot 1 is not accepted as current exact-build evidence and must be replaced by the clean guest Chat proof. |
| 2026-08-17 09:32 PDT | The clean `0.1.72` guest Chat rerun reached AI Matrx but stopped with `Workspace initialization failed (-1): Schema validation failed`. The candidate correctly requires `organization_id` from `/auth/whoami`; production OpenAPI still exposes the earlier response without that field, while `origin/main` contains the effective-organization contract and its test in aidream commit `f98cd3dc5`. Capture, SEO, Data, Settings, and runtime-error checks remain clean. Rerun Chat after the live endpoint exposes `organization_id`; then capture `01-chat.jpeg`, replace the stale dashboard Screenshot 1, and perform the final no-error pass. |
| 2026-08-17 10:08 PDT | Production `/auth/whoami` and OpenAPI now expose `organization_id`. A restarted brand-new no-login profile loaded the exact `0.1.72` build and the server-resolved **Matrx Assistant**; the reviewer question returned the three required stages — **Capture, Understand, Use** — grounded in the demo page. Runtime inspection recorded no uncaught side-panel exception on this path. The completed proof is `.output/cws-assets/01-chat.jpeg`, normalized to 1280 × 800 with SHA-256 `d0da71d5e2c9d01266e4fa099666b9ea2ec103c6067966a114082d7b69a0a09c`. Dashboard upload remains pending only because the Mac locked during the screenshot replacement. |
| 2026-08-17 10:43 PDT | Locked-screen offline readiness audit passed. The uploaded package remains `.output/matrx-extend-0.1.72-chrome.zip`, SHA-256 `28a37535e1d40c13aa23b1fc5d7b62d54909db3439b297aa7894bc35d92ec4eb`; its manifest is MV3 version `0.1.72`, has the canonical side panel, no toolbar popup, and no development key. The extracted JavaScript contains none of `eval(`, `new Function`, `Runtime.evaluate`, `Runtime.callFunctionOn`, or `Runtime.compileScript`. All four final JPEGs are 1280 × 800: `01-chat` `d0da71d5e2c9d01266e4fa099666b9ea2ec103c6067966a114082d7b69a0a09c`; `02-capture` `7ffedc9208c80964e20567cf9e1ab93eaf272f57ff0abeace8151388a27f714d`; `03-seo` `1d2ddbdeec8e6d7c65b81e707c043d562a86f97151d9abd1a7a1e04d681d13ce`; `04-settings` `ece1aa19115c3f51f4dadb83934e708f3bfcf88f0b2220c5603cb0118296d137`. The anonymous demo and extension privacy URLs both returned HTTP 200, and the live `/auth/whoami` OpenAPI contract still includes `organization_id`. |
| 2026-08-17 13:38 PDT | Final live dashboard audit passed under `arman@armansadeghi.com`, publisher **Matrx**, primary item `hnfolienncfklkgmdjjmhhegglimlamg`: package `0.1.72`; saved single-purpose listing; privacy answers and certifications; free/public/all-regions distribution; deterministic no-login test instructions; and the four current screenshots in Chat, Capture, SEO, Settings order. Optional promo tiles remain empty. Arman authorized autonomous submission; **Submit for review** was clicked with automatic publication after approval enabled. Google displayed **Your extension was submitted for review**, and the Status page then showed **Pending review** / **This draft is pending review.** |
| 2026-08-19 02:41 PDT | Chrome Web Store notification confirmed: **Item successfully published** for the submitted extension. No dashboard or package changes were made during the pending review window. |
| 2026-08-20 09:10 PDT | Version `0.1.74` passed live OpenAPI sync, TypeScript, strict schema routing, 82/82 tool-registry drift verification, the private migration-ledger check (15 applied / 0 pending / 0 drifted), Store packaging validation, separate local packaging, version tagging, and push. Store artifact SHA-256 `539483af16d233c9c12e67744ffe78e16902ea5cd170cacfc240a056ee71cb10`; manifest version `0.1.74`, no development key, no toolbar popup, canonical side panel. Chrome blocks extension automation on Web Store pages, so upload/submission remains an interactive-dashboard action. |
| 2026-08-20 12:05 PDT | Version `0.1.75` passed TypeScript, all 437 tests, strict schema routing, the private migration-ledger check (15 applied / 0 pending / 0 drifted), Store package validation, separate local packaging, version tagging, and atomic push. Store artifact SHA-256 `d7ba4937b8dec4f04e0330dee480814fbdd11636163a772aae9216f5abc1f651`; local artifact SHA-256 `1374c3da96abfdb34cc4a175fc2f3bb75c15250b23aabfaecb5503688f686326`. The Store manifest is version `0.1.75`, has no development key or toolbar popup, and retains the canonical side panel. Live API-type regeneration was deliberately skipped to avoid absorbing unrelated concurrent generated-type work. Tool drift remains intentionally held on the old `credential_login` contract until the API, Store build, and East DB contract cut over together. The zip was validated but not uploaded. |
| 2026-08-20 12:08 PDT | Rechecked the live Chrome Web Store dashboard under `arman@armansadeghi.com`, publisher **Matrx**. Primary item `hnfolienncfklkgmdjjmhhegglimlamg` reports **Status: Published - public**. The Draft tab states **This draft is unpublished**, confirming there is no pending draft submission. The approval email independently records **Item successfully published** at 2026-08-19 02:41 PDT. Version `0.1.75` remains a validated local Store candidate and has not been uploaded. |
| 2026-08-20 12:31 PDT | Version `0.1.76` was prepared from an isolated clean worktree and passed TypeScript, strict schema routing, all **438** tests, the private migration-ledger check (15 applied / 0 pending / 0 drifted), Store package validation, and separate local packaging. Store artifact SHA-256 `21d7a3e3bcb19b6e6db11a44c345bd3179ddc5e46f655e47e4187110fb5fbcd2`; local artifact SHA-256 `5fca5e4eb1bf8131bc70d923f3b147b4b037a2b1fd5a63e8b6b6bab825916e58`. The Store manifest is `0.1.76`, has no development key or toolbar popup, and retains the canonical side panel. The known `credential_login` schema drift is intentional and release-forced: East remains on the public `0.1.72` contract until `0.1.76` is actually published, then East cuts over last so the old public extension is never advertised unexecutable actions. |
| 2026-08-20 14:01 PDT | Version `0.2.0` became the first post-approval public-testing candidate, superseding `0.1.74`–`0.1.76`. TypeScript, all **438** tests, strict schema routing, migration ledger (15 applied / 0 pending / 0 drifted), Store package validation, and the new Chrome Web Store approval-risk gate passed. The emitted manifest exactly matches Google's published `0.1.72` policy surface and contains no forbidden runtime-code path, so this is classified as a **routine update**: no new permission, host, content-script reach, Store purpose, data category, or reviewer path. Authentication information was already disclosed in the published data-use form, and the credential-login work remains within the existing user-requested browser-action purpose. Store artifact `.output/matrx-extend-0.2.0-store.zip` SHA-256 `7a1bbd7ca47c5ba248146b44064b8b9ba40fdc0513b61b653200703b06a6f442`; local artifact SHA-256 `2cf27e774053f037208a23c399dadc187f46ff9064e2c2c2579fe9cbc2830a86`. The known `credential_login` tool-schema cutover remains intentionally deferred until this Store version is published, so the currently public `0.1.72` client is never advertised a contract it cannot execute. |

## Official policy references

- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Privacy dashboard guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)
- [Store listing guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [Image requirements](https://developer.chrome.com/docs/webstore/images)
- [Review process](https://developer.chrome.com/docs/webstore/review-process)
