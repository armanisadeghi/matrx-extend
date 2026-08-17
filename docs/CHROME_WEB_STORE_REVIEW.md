# Matrx Extend Chrome Web Store review record

## Current decision

Prepare and submit version `0.1.70` to the existing public item `hnfolienncfklkgmdjjmhhegglimlamg`. Do not use the duplicate draft item `pifjakncjcpnkjbdlijgddhiipdlfbde`.

Submission is not ready until every unchecked gate below is complete. Dashboard text is canonical in `docs/CWS_LISTING_DRAFT.md`.

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
- Every agent-start path now resolves the bearer/fingerprint identity's
  effective organization through `/auth/whoami`; a clean-install guest never
  guesses or hardcodes conversation ownership.

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
- [x] `pnpm zip:store` builds the store zip without the development manifest key.
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

- [ ] Side panel opens from the toolbar icon.
- [x] Guest banner appears and no account is required.
- [x] Settings shows automatic capture off before any change.
- [x] Capture produces the demo article, links, and schema.
- [x] SEO produces an audit for the demo page.
- [ ] Data can select or extract fields from the workflow table without a dead end.
- [ ] Chat answers the three-stage question with Capture, Understand, and Use.
- [ ] No uncaught side-panel or service-worker error affects these paths.

### Dashboard

- [ ] Primary item `hnfolienncfklkgmdjjmhhegglimlamg` receives the new zip.
- [ ] Listing fields exactly match `docs/CWS_LISTING_DRAFT.md`.
- [ ] Privacy policy URL is `/privacy-policy/extension`.
- [ ] Data disclosures and Limited Use certifications match this record.
- [ ] Permission justifications exactly match this release.
- [ ] Reviewer username and password remain blank; additional instructions are filled.
- [ ] Five current 1280 × 800 screenshots are uploaded in the documented order.
- [ ] Distribution settings are checked without using the duplicate item.
- [ ] Arman explicitly confirms the final Submit for review action.

## Evidence log

| Time (America/Los_Angeles) | Evidence |
|---|---|
| 2026-08-17 | Live dashboard confirmed primary draft `0.1.63` rejected and published `0.1.4`; duplicate item `pifjakncjcpnkjbdlijgddhiipdlfbde` remains an unused draft. |
| 2026-08-17 | Live rejection detail and the completely blank reviewer-instructions section were recorded. |
| 2026-08-17 | `pnpm compile`, `pnpm test` (398 tests), schema-routing check, and docs-pointer check passed before final copy/default edits. |
| 2026-08-17 | Focused strict-JSON parser test passed after removing both page-data execution fallbacks. |
| 2026-08-17 03:45 PDT | Final `pnpm compile`, `pnpm test` (400 tests), strict schema-routing, strict docs-pointer, tool-DB drift, and `pnpm zip:store` passed. |
| 2026-08-17 03:45 PDT | Store artifact `.output/matrx-extend-0.1.70-chrome.zip` SHA-256 `c21cc1b43ac3e835cce6d0126f66d1e9bbe37d5f7f133c6bef70c970c6539237`; manifest has version `0.1.70`, the narrow summary, no `key`, inspected permissions, and MV3 default CSP. Emitted JavaScript string audit found no remote script, `importScripts(http…)`, `new Function`, or `eval` path. |
| 2026-08-17 03:45 PDT | Exact clean Store build in a fresh Chrome-for-Testing profile, with no AI Matrx login: guest banner shown; auto-capture off; explicit Capture returned the 130-word demo article, 10 links, and schema; SEO returned a full audit; no runtime exception on either path. |
| 2026-08-17 03:45 PDT | Guest Chat found a live contract regression before submission: agent start returned 422 because `organization_id` was absent. The server bootstrap and every extension agent-start path were fixed, typed, tested, built, committed, and pushed; the clean live chat rerun remains required before checking the Chat gate. |
| 2026-08-17 03:48 PDT | Anonymous public checks returned HTTP 200 for `https://www.aimatrx.com/matrx-extend-demo` and `https://www.aimatrx.com/privacy-policy/extension`. A second brand-new Chrome profile loaded the exact Store build on the public demo URL: guest mode and auto-capture-off confirmed; Capture returned the 130-word article, 10 links, and schema; SEO returned `LOOKS GOOD`; no runtime exceptions affected either path. |

Add exact zip path, SHA-256, clean-profile results, screenshot paths, and dashboard save time here as they are produced.

## Official policy references

- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Privacy dashboard guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)
- [Store listing guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [Image requirements](https://developer.chrome.com/docs/webstore/images)
- [Review process](https://developer.chrome.com/docs/webstore/review-process)
