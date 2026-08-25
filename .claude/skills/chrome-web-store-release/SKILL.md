---
name: chrome-web-store-release
description: Audit, package, submit, and track Matrx Extend Chrome Web Store updates. Use for release readiness, Store-policy change assessment, version selection, dashboard submission, listing/privacy/test-instruction updates, and approval monitoring. Do not use for local-only unpacked extension builds.
---

# Chrome Web Store release ownership

Own the Matrx Extend Store release through approval or a genuine human-only
blocker. Arman does not want routine questions, dashboard chores, packaging, or
status checks handed back to him. Use existing credentials and authenticated
browser state. Follow any confirmation requirements imposed by the active tool
or environment; otherwise proceed autonomously.

Read these before acting:

- `/Users/armanisadeghi/code/common-docs/systems/clients/extension/CHROME-WEB-STORE.md` — published version, candidate, evidence,
  item ID, and past rejection.
- `/Users/armanisadeghi/code/common-docs/systems/clients/extension/CHROME-WEB-STORE.md` — canonical dashboard copy.
- `config/chrome-web-store-approved-baseline.json` — the exact policy surface
  Google most recently published.
- `src/config/sidepanel-visibility.ts` — the single public/member/admin feature
  switchboard for the candidate.

## Decide whether the update is routine or Store-material

Compare the candidate with the `publishedSourceCommit` in the approved
baseline. Run `pnpm zip:store`; its blocking risk gate compares the emitted
manifest with Google's published surface and scans emitted JavaScript for
forbidden runtime-code paths.

A change is **routine** when the approved manifest surface is identical and the
diff only fixes bugs, improves performance or UI, refactors internals, or
extends behavior already truthfully covered by the listing and disclosures.
Submit routine updates with concise release notes. Google still reviews the
package; no separate email is necessary.

Before packaging, inspect `SIDEPANEL_TAB_AUDIENCE`. Features marked `admin`
may remain available for internal testing but must not appear in public Store
copy, screenshots, or reviewer steps. Do not scatter one-off visibility checks
through components; change the typed switchboard so navigation and content are
gated together.

A change is **Store-material** when it changes or introduces any of these:

- required or optional permissions, host access, content-script reach,
  externally connectable origins, CSP, or web-accessible resources;
- collection, handling, retention, sale, or third-party transfer of a new user
  data category, including authentication information;
- remote code, downloaded executable logic, `eval`, `new Function`, or Chrome
  DevTools Runtime execution;
- a new primary purpose, a feature the listing does not truthfully describe,
  or behavior that makes existing screenshots/test instructions misleading;
- a new privileged browser capability, background/automatic behavior, payment,
  or account requirement;
- removal or breakage of the public no-login reviewer path.

Do not merely stop at the label. Reconcile every affected Store field: single
purpose, description, permission justifications, privacy-policy behavior, data
disclosures, Limited Use certifications, screenshots, and reviewer steps.
Create focused reviewer evidence when the change cannot be reproduced from the
existing public test path. The normal way to communicate a material update is
the Store submission and its notes; contact Google separately only when the
dashboard or an existing reviewer thread asks for it.

Never weaken the automated baseline to make a candidate pass. Update the
baseline only after Google publishes that changed surface.

## Versioning

Use three-part SemVer, which is valid for Chrome manifests:

- `PATCH` (`0.2.1`) — fixes and small compatible improvements.
- `MINOR` (`0.3.0`) — a meaningful compatible feature batch.
- `MAJOR` (`1.0.0`) — the public product promise is stable and the team is
  intentionally declaring general availability.

Store approval alone does not require `1.0.0`. For this product, `0.2.0` is the
first post-approval live-testing line. Use `1.0.0` after the short public
testing window passes, the primary workflows are stable, and the Store listing
and screenshots represent the product we want broadly marketed.

Never reuse or decrease a version. Do not write `0.2.00`; canonical SemVer is
`0.2.0`.

## Release and publish

1. Sync `main` with `origin/main`; preserve unrelated concurrent work.
2. Inspect changes since the baseline's published commit and classify them.
3. Run the full relevant tests. A Store release must include TypeScript, unit
   tests, strict schema routing, tool-registry drift, migration ledger, Store
   package validation, and the Chrome Web Store risk gate.
   Test the visible `everyone` surface signed out and the `signed-in` surface
   with a non-admin account. An admin session is never acceptable screenshot
   or reviewer-path evidence.
4. Use `./release.sh --patch|--minor|--major` when a new package is needed.
   Upload only `.output/matrx-extend-<version>-store.zip`; never the local zip.
5. In the existing publisher **Matrx**, update only the primary item
   `hnfolienncfklkgmdjjmhhegglimlamg`. Never use the duplicate draft item.
6. Reconcile listing fields only where the candidate requires it, save, upload,
   and submit for review. Keep automatic publishing enabled unless Arman asks
   for a staged release.
7. Verify the dashboard reaches **Pending review**. Record exact version,
   artifact SHA-256, classification, changed Store fields, submission time, and
   auto-publish state in `/Users/armanisadeghi/code/common-docs/systems/clients/extension/CHROME-WEB-STORE.md`; commit and push it.
8. Monitor the dashboard and Google email until approved, rejected, or action
   is requested. On publication, verify **Published - public**, update the
   approved baseline version/commit/policy surface, and close the record.

Stop only for a CAPTCHA, a password/2FA step that the environment requires the
human to perform, an unavailable authenticated publisher account, or a policy
decision that cannot be resolved from the actual code and Store requirements.

## Store marketing

Treat conversion work as a truthful presentation pass, not a reason to inflate
the feature story. Keep the single-purpose description direct. Refresh
screenshots whenever the visible UI materially changes; show the strongest
four user outcomes, not internal architecture. Add promo tiles only when there
is polished campaign artwork worth using. Before `1.0.0`, complete one focused
marketing pass covering icon, title/summary, first screenshot, screenshot
captions/composition, support/homepage pages, and the public reviewer/demo path.
