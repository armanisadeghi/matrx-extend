# Matrx Extend stabilization: resume here

Updated 2026-09-26 21:37 UTC. Campaign remains incomplete. `inventory.json` is the coverage authority (205 features, 693 cases). Historical checkpoints are preserved in `diagnostics/coordinator-history-20260926-2050.md`.

## Current truth and next actions

- ACTIVE root heavy workload: release-stabilization-036 PTY89945, log `/tmp/matrx-release-stabilization-036.log`. Confirm wrapper exit before any browser/test. Expected next release 0.2.78; do not claim published until actual success. Root uses real external TMPDIR and matching profile-dir, unchanged resource thresholds.
- Last verified release 0.2.77 at2315f02b, exact CI36270728976 SUCCESS, 1467 local tests passed/3 skipped. Main subsequently pushed f127280c at21:17. Fetch21:36 no incoming; next maximum sync22:17 (release planned sooner). No Store upload.
- Release035 wrapper46200 confirmed1 at21:32:49.129, freshness refusal only: content-ir.19.11->.19.13 and records.58.25->.58.26. Guarded package006 wrapper61151 confirmed0 at21:34:29.837, lock509ddb2a, consumer peer9fec93c9 sees no required host adoption; real package changes documented despite incomplete changelogs. Full new graph now under release036 validation.
- EXT-D-0023 confirmed: persistent no-workspace notice covers Save after org selection. Source004 private screenshot/geometry identifies notification. Red guardca6a5c95 produced 2 intended failures; fix9b64e44e uses typed resolution metadata and retires only resolved notices, including late arrival. Focused green001 wrapper10073 confirmed0 at21:29:11.393:24/24 tests. Source peer5cc598c9 no blocker, relay retains metadata. Defect fixed, NOT closed: live UI pending. Receipts4fbc8624, inventorydfc782e6.
- Next after release036: root guarded source-workspace-005 (unused), existing runnerf05a6b1e source-peerf55f9246 ACCEPT. Real preselection no-workspace notice must be observed, then absent after UI selection and Save geometry hit. If notice not observed initially, explicitly unverified. Existing D22 reservation mandatory; no Save input, only local public capture + readonly lookup/geometry. Exit may be diagnostic_only even when bounded D23 acceptance passes; inspect actual result.
- EXT-D-0022 remains open. Source001 Save entry was ambiguous; private checkpoint reserved before click, NEVER reset/delete/reinitialize/retry. Source002 readonly scoped lookup none. Source003/004 local capture + pointer evidence only; Source004 identifies covering no-workspace notice. No subsequent Save sent. Original001 assertion failure retained, no claim backend Save defect.
- SEO: guest015 again failed schema anchor second sample before input; 16 prior targets pass, metadata target unverified. db24c884 retained title diagnostics;9e7e042e adds geometry,0d893b3d secures screenshot and fixed failure categories. Peerddf50ee3 accepts with minor limitation null sample labeled candidate_count. After D23 priority, unused guest016 may run with `SEO_GUEST_METADATA_FIXTURE=airbnb` and same guarded external profile. No timeout/assertion weakening. 013/014/015 immutable receipts preserve failures; inventory links do not promote full cases.
- Shared checkout incident21:24:09: external main->origin/main->main checkout stranded6localcommits through9e7e042e. Root nondestructive mergeb44f4ba6 restored all, preserving dirty D23 code and new peer commit2a0f72d0. No code discarded. Do not checkout/reset/switch in shared main; exact show/diff for reviews. All worker commits local; root pushes after gates.
- Primary Chrome last actually verified0.2.73. New unpacked disk artifact/version does not prove primary reload. Boot disk below20GiB; owned isolated profiles use actual external TMPDIR, primary must check truebootprofile. No manual lease active. Owned caffeinate96492 expires22:08; renew owned keepalive if needed. Do not weakenpassword/manual-lock settings.
- Campaign remains incomplete:205features/693cases, mostlyunverified. Chat/Pilotlast; ordinarymembercredentialstill unresolved withoutaccount/rolechanges. Admin SEO save checkpoint remains sacred: readonlyreuse, no secondSave. Canonical common-docs STATE lastupdated1d74aa426 for.73; update afternewverifiedruntime.

## Operating constraints

- Authorization covers autonomous contained test → capture → fix → independent retest → green main → integration. Complete contained surfaces first; systematic Chat/Pilot work remains last. Keep guest/member/admin applicability explicit.
- Shared `main` is the only sync point: no branches, worktrees, reset, force-push, or worker push/amend. Use exact-path local commits; root integrates. Inspect incoming source and lockfile changes before publishing and revalidate changed dependency graphs. Never publish red.
- At most one resource-guarded heavy command or browser lease at a time. Use `scripts/stabilization-resource.mjs` and its existing thresholds; do not weaken guards or stop another contributor's process. Confirm wrapper exit before another workload. Resource refusal is not a product failure; two failed actual attempts trigger decomposition or reroute.
- Keep reports and logs free of secrets, tokens, Vault values, and raw auth URLs. Use real credentials only at point of use and owned disposable profiles for destructive or alternate-auth checks. Never alter roles/accounts to manufacture coverage.
- Read-only SEO resume may inspect the selected history and saved snapshot for the checkpoint ID and reload the panel. It must retain the checkpoint, skip Save, and avoid exposing IDs or request contents in durable evidence. If the peer rejects the source or the guard refuses, stop and record the bounded reason; do not retry by writing.

## Durable coordination pointers

- Root last pushed `9587be64` at 21:03 UTC with exact CI36271604199 SUCCESS; fetch at21:06 found no incoming. Next maximum sync deadline22:03 UTC, earlier push planned after reviewed diagnostic commits. Existing ACTIVE `hourly-matrx-repository-sync` automation is `/Users/armanisadeghi/.codex/automations/hourly-matrx-repository-sync/automation.toml` (thread `019fe763-cd4e-7e42-a140-0bef62a6104e`); it syncs repos, not this campaign queue. Do not duplicate or overwrite it.
- Owned caffeinate PID 96492/session 18860 expires about 22:08 UTC. No UI bypass if the machine locks; password/manual-lock settings remain unchanged.
- D20 is closed after the recurrence fix in `d8e617c7` and exact green release/CI/independent review; retain the historical failure and reopen only on recurrence. No deterministic local red or future flake guarantee.
- D12 review handoff is prepared but NOT inserted. Receipt `review-queue-access-repair.json` records the canonical Supabase connector/project verification; reverify before any write and do not create an orphan row. Extension shared STATE was updated at 18:57 UTC for primary 0.2.73; update again after new runtime proof.
- Source lead EXT-L-0011 / F2014 is deferred wave D: controller reads the MFA selector but the real auto-probe producer does not emit it. This is source-only, not a verified product bug; keep systematic Pilot/MFA work deferred.

## Evidence pointers

- Release: `runs/release-stabilization-028.json`, `reports/release028-peer.json`.
- SEO: `runs/seo-admin-002.json`, `reports/seo-admin-persistence-prepare.json`, `reports/seo-history-diagnostics-peer.json` (source accepted; runtime still pending).
- Member: `runs/member-vault-access-011.json`, `reports/member011-runtime-peer.json`.
