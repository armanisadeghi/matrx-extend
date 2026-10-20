# Stabilization resume checkpoint

The campaign is active and incomplete. No overall health or bug-free claim is supported.
Use [PLAN.md](PLAN.md) for the approved operating rules and [inventory.json](inventory.json)
for every feature/mode/case, linked defect and retest. Generated [STATUS.md](STATUS.md),
[STATUS.html](STATUS.html) and [CHECKLIST.md](CHECKLIST.md) derive only from that inventory.
Past observations remain in their linked reports and Git; this file describes current work.

## Current release boundary

Read the canonical [Chrome Web Store record](/Users/armanisadeghi/code/common-docs/systems/apps/extension/CHROME-WEB-STORE.md)
before a release action. Its latest authenticated primary-item observation remains published
0.2.205, draft0.2.479 rejected, no pending, Upload enabled (October19,16:20UTC).
Vault login works; no human-only access blocker is known. Do not infer a new dashboard state
from old email, public listing or this checkpoint.

Hosted release39341777746 produced **0.2.565**, source/tag
`a0c86f20b9fb070c09e00c0a574a0ffbf8f2b656`, artifact12229886228,
Store ZIP SHA256 `fb55565b7c9bad1b73ada70b7ea54eda67217bde3f1bb1216ab9933bebf0a0c4`.
It passed its strict release gates, then npm packages advanced. It is **upload-ineligible**.
Exact guestB39342759083 and memberA39343298322 are terminal failures with valid resource finals.
No new Store upload/submission occurred. One-use member secret and local link are deleted,
absence verified. No release-lane external job is in flight.

- [Release/acceptance checkpoint](reports/store-release-v0565-acceptance-20261019.json)
- [Independent package review](reports/candidate565-package-peer-20261019.json)
- [Independent native evidence review](reports/candidate565-native-peer-20261019.json)

Guest opening/followup and member two-turn transport completed, but readable native proof failed.
Guest Article heading/stages were detected; introduction/visible result were not independently
proven. Those partial observations do not pass whole Chat, Scrape, current main or the Store.
Backend observed by these runs was `9ef78d4ade91d8f1cb1951710266b094db5744bf`;
recheck deployment/runtime before another acceptance or release action.

## Active ownership and immediate next actions

Owner: primary Codex chat. At this checkpoint all hosted runs and Mac guards are terminal.
All current workers have finished. Source guard commit `cd6cd7ca9` is pushed; its relevant
CI39345963058 is in progress. No source working diff remains. Root is preparing the next
release-only and independent testing lanes; assign explicit ownership before resuming work.
Root owns canonical stabilization records and final integration/release follow-through.

1. Retest [D248](defects/EXT-D-0248.json) member visibility guard on the next exact candidate.
   Exact565 remained document-hidden with transcript opacity0 despite successful replies.
   [Astra diagnosis](reports/member565-unpainted-escalation-20261019.json) localized missing
   visibility checks across Chat navigation/captures/sends. The implementation checks the same
   original target, focus, actual frame and mounted-transcript opacity; one trusted restoration
   is allowed, then stop before AI if unhealthy. Failure capture must retain same-article
   postcapture state without turning hidden rendering into a visible pass. The first peer found
   false passes; the next found an unsupported new500msframe cutoff. Reuse the existing foreground
   deadline and cancellation repairs are committed atcd6cd7ca9; controlled transit-expiry test
   and source peer findings are resolved. Native cause remains unknown; no product repair claim.
   [Owner adjudication](reports/member-visibility-owner-adjudication-20261019.json).
   [First peer](reports/member-visibility-fresh-peer-20261019.json),
   [deadline finding](reports/member-visibility-final-peer-20261019.json).
2. [D258](defects/EXT-D-0258.json) source repair `56ca1354c` is pushed: scroll exact Settings
   switch into view, crop actual Article heading+intro rather than Re-capture button, preserve
   bounded CDP exception categories/names/codes.52focusedtests/compile/fullLint pass;
   independent source qualityPASS, native replay pending. This is not a Data Done product fix.
   [Repair](reports/reviewer565-failure-repair-20261019.json),
   [source peer](reports/reviewer565-source-peer-20261019.json).
3. Data Done565 selected1field and found Done/Cancel, then **DOM.getNodeForLocation itself rejected**
   before hit equality or mouse click. No downstream IPC/identity defect is proven.
   Actual-source isolated Chrome fixtures succeed at500px and366px; the latter matches the failing
   button quad exactly. Unsupported-CDP and narrow-width-only hypotheses are refuted. Public demo
   HEAD200 has no CSP header. No more speculative fixture variants: next authorized native replay
   must retain the new bounded exception category/name/code and actual viewport/target evidence.
   [Protocol fixture](reports/data-done-protocol-escalation-20261019.json),
   [matching geometry fixture](reports/data-picker-geometry-fixture-20261019.json).
4. [D260](defects/EXT-D-0260.json) Article product fix `d1bd25d7d` preserves heading-bearing
   semantic article headers only in cloned extraction input. Independent ADMIN Chrome capture and
   recapture after reload retain heading, introduction and stages179words; surrounding panes were
   observed. Guest565 introduction/visible proof is missing, so the defect stays fixed, not closed.
   Correct inventory link is **EXT-F-1007-T08**, not Settings EXT-F-1003-T08.
   [Native admin report](reports/native-article-retest-20261019.json).
5. After reviewed source units are committed/pushed and relevant CI succeeds, synchronize main,
   refresh actual package/runtime/spend eligibility, and build ONE guarded hosted candidate.
   Run exact-candidate guest/non-admin acceptance on isolated A/B hosts. Never upload565, transfer
   old artifact passes to a newer package, or rebuild repeatedly before diagnosing a red run.
6. Continue non-Chat/Pilot Settings/navigation and Scrape/Data/SEO product cases in parallel with
   urgent public regressions/release acceptance. Do not make inventory completion a testing gate.
   Member/admin/full-surface/reload gaps remain explicit in the inventory. No full feature-role
   pair is established healthy. [D217](defects/EXT-D-0217.json) stale-session Save/Retry,
   [D198](defects/EXT-D-0198.json) SEO history and other fixed-but-unretested records remain open
   at their own scopes. A pre-existing local unsaved capture/error card was preserved; its old
   message alone is not a fresh failed Save reproduction.

## Installed development copy

Chrome profile8 (armansadeghi.com) has development ID `cihdmkcdjjckfhjpgoedmgfpoljebaml`
loaded from `/Volumes/Samsung2TB/code/matrx-extend/.output/chrome-mv3-dev`, enabled/pinned beside
Store ID `hnfolienncfklkgmdjjmhhegglimlamg`0.2.205. Last actual reload verified dev0.2.565
from CI39342629514/artifact12228829443/source`199e2e738ac928b661c8f1a55f1d4dcc6ddff440`,
tree`f5c2313bc27330260b029824b178e1f667cd28e98aa23307d54531a8b6f607bf`.
Later harness changes are not yet rebuilt/loaded; do not call it current merely because main advances.
[Install evidence](reports/native-dev-refresh565-20261019.json).
Import the successful eligible CI artifact with `scripts/current-test-artifact.mjs`, promote with
`scripts/promote-ci-dev-artifact.mjs`, then guarded native reload and verify path/ID/version/pins.
This Mac runs no manual builds/releases; use guarded hosted `.github/workflows/release.yml`.

## Execution and integration safeguards

- At most3workers beside owner; flat lanes. At most2hosted browser runs on isolated hosts/profiles,
  one guarded heavy job per physical host including this Mac. Existing safe admission/resource
  refusal is binding. No UI/Chrome launch before actual ADMITTED plus owner verification.
  Unrelated CI on another host is not a global capacity block. Serialize fixtures/credentials.
- Fetch/merge at boundaries and at least every15minutes; reconcile before push. Shared main,
  exact-path commits, preserve contributor changes. Never reset/stash/force/new worktree.
  Source units require appropriate tests/compile/full lint and independent review. Documentation
  checkpoints can skip duplicate CI; actual source changes and exact candidate gates cannot.
- Read current `ci-spend` before paid dispatch/publication. The complete23:20UTC read was
  $59.50/$100; refresh it rather than treating that number as a permanent budget permit.
  Never relocate an account/billing-blocked job. Preserve both actual spend and advisory limits.
- Active pending guard journals stay in place. After final decision, use
  `scripts/copy-hosted-resource-journal.mjs` to a NEW sanitized path. Preserve raw bytes/hash in
  ignored `test-results` only after terminal. Do not commit raw logs, credentials, auth URLs,
  browser profiles or guest authentication values. Unsupported copier output needs review.
- Retest is required for closure: original reproduction plus neighboring cases independently
  pass. A resource-invalid run earns zero product credit. Source/CI/fixture checks are never
  counted as actual product behavior passes. Failed runs retain their failed verdict.
- After inventory edits regenerate with `python3 scripts/generate-stabilization-tracker.py`.
  Keep stable IDs and explicit partial/unknown/blocked/stale states. Validate new JSON reports;
  format ignored JSON via Biome stdin if the direct-path formatter processes no files.
- Before ending a turn, every worker must finish or checkpoint exact ownership, external run
  handles, cleanup, versions/provenance, files/commits, evidence limits and next action.

Native account-mode navigation attempt earns zero case credit: initial valid guard covered the
Store guest preflight; subsequent Dev Profile/Preferences navigation occurred after guard ended
and is excluded. No sign-out or authentication/settings/capture mutation occurred. The current
Dev principal is a personal admin, not the test account; do not log it out without proven restore.
Use an owned isolated test profile for guest/member flows instead.
[Chronology](reports/native-account-mode-acceptance-20261019.json).
