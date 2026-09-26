# Stabilization coordinator

## Resume contract
User authorizes autonomous test → capture → fix → independent retest → green integration. Read PLAN.md, inventory.json, defects and runs. Inventory is the only coverage register. Chat/Pilot stay last. Shared main only; preserve concurrent edits; fetch before push; never publish red trunk. Root owns one resource lease for all heavy tests/builds/native browser use; workers request commands rather than launch them.

## Current truth — 2026-09-26 05:37 UTC
- Campaign incomplete. Defects EXT-D-0001 through 0005 closed by independent retests and release0.2.51. EXT-D-0006 open/in-fix: admin DevTools Protocol permission switch silently cannot turn off a required permission.
- Loaded Chrome unpacked development ID cihdmkcdjjckfhjpgoedmgfpoljebaml, version0.2.51, path .output/chrome-mv3-dev. Release candidate760c7a1 passed1300tests/3explicit dev-clone skips and all14 gates. Main/tag and artifact hashes verified in release-real-005. No public Store upload. Store0.2.23 copy disabled with data preserved.
- Real browser now signed in admin@admin.com ADMIN. Device org explicitly selected: ZZZ APPROVAL-TAIL throwaway a2c8a05f — safe to delete. This label is data, not deletion permission. ThemeSystem, speedFast, Matrx Browser Agent restored. Cookies/pageCapture/clipboardRead/tabCapture OFF, debugger ON. Last UI Advanced agent capabilities. No Chat/Pilot run or protected content capture performed.
- Native guest controls/org guidance/default-agent gating/admin-section absence, guest themes, admin sign-in, org persistence, agent selection, theme/speed, all12 settings groups and several optional permission cycles have evidence linked in inventory. Cookies denial remains unverified because Chrome offered no denial dialog. Default-agent label concern refuted: trailing2 was a separate orchestra-member badge, not agent name. Ordinary-member mode remains unverified.
- Native lease guest-settings-007 stopped cleanly at05:32:58.923Z with resource_invalid=false. No browser/heavy lease active. Do not infer command exits from worker reports; root owns lifecycle metadata.
- User requested prevention of idle locking. AC sleep/display already0; screensaver idle3600→0 readback verified, reversible in environment-awake-001. Password behavior unchanged. Caffeinate -di -t14400 session85503/PID736 expires around08:08UTC. No proof screensaver was sole historical cause.

## Active ownership and next actions
1. /root/debugger_permission_fix — Sol medium implements EXT-D-0006, with regression and feature-test docs. No worker heavy runs. Required fresh independent peer + original-repro UI retest on rebuilt extension before close. Root owns defect/inventory transitions.
2. /root/isolated_reset_peer — fresh Sol medium source review of80db6c2 isolated guest reset acceptance runner. Implementation unexecuted; await peer before guarded node tests/browser/settings-local-reset-acceptance.mjs. Actual native SIDE_PANEL, disposable owned Chrome-for-Testing profile only. Never clear primary browser/account data.
3. Root schedules compile/tests/build and isolated reset serially with resource guard. New source changes need fresh build/hash receipt. Retest D6 and neighboring optional controls; green integration/release only afterward.
4. Continue every remaining non-Chat/Pilot feature/mode cell. Do not broaden passes from partial substeps. Inventory still contains generated procedures that must be checked against actual supported controls before adjudication; retain evidence of corrections.

## Remote synchronization
Merged origin/main a0d2457 at05:36UTC. New source includes Safari manifest omissions, platform read-aloud preferences, and vault lifecycle tests, plus earlier Source edit/save queue/live-viewer changes. None are in loaded0.2.51. Inventory Source additions already reconciled; read-aloud delta must be reconciled before testing its surface. Fetch before next push and reconcile rather than discard.

## Delegation and evidence
Flat tree, root+3 maximum; one heavy/browser run and conservatively one implementation worker at a time. Luna medium narrow UI tests, Sol medium implementation/moderate debugging; two failed attempts/interpretation corrections trigger narrower work or fresh higher tier. All tasks return fixed structured reports in reports, actual runs in runs, defects in defects, routing in events.jsonl. Fresh independent reviews have separate acceptance and engineering verdicts. Never close a defect merely because unit tests pass.
