# Matrx Extend stabilization — handoff

Snapshot: 2026-09-27, after the guarded Source run 011 and Debug export run 002. This is a human-readable succession document, **not a second status register**. On resumption, read [the current checklist](CHECKLIST.md), [the coordinator checkpoint](COORDINATOR.md), [the feature inventory](inventory.json), and [the defect records](defects/) first; if they have changed, they supersede this snapshot. All counts below describe recorded evidence, not a claim that the product is healthy.

## Where we stand

| Question | Current answer | Boundary |
| --- | --- | --- |
| Have known defects been addressed? | 22 of 23 recorded defects are closed. [EXT-D-0022](defects/EXT-D-0022.json) has engineering repairs and remains **fixed, awaiting native retest**. | Closing a defect does not pass every case in its feature. No other recorded defect is currently open or in fix. Unknown bugs can still be found in untested coverage. |
| Is the feature list complete? | The inventory contains **205 features, 1,287 controls and 693 cases**, with guest, ordinary-member and admin applicability. | It was source-reconciled for its recorded snapshot. Changes merged since its last update have **not** been recertified against the inventory. New controls must be added before testing them. A listed control is not yet a usable test procedure. |
| How much is verified? | Across 1,142 mode-specific case slots: **53 recorded passes, 1 not applicable, 76 explicitly unverified, 1,012 without a result**. A missing result is unfinished coverage. | Twenty-four passes belong to release infrastructure, not user controls. Only 10 of all 53 link to a build receipt; four are explicit historical Debug passes on 0.2.79. None is a current 0.2.85 Source or Debug acceptance pass. See [the generated summary](reports/current-checklist-summary.json). |
| Can we call non-Chat/Pilot surfaces 100% healthy? | **No.** A large part of every mode matrix remains pending, including ordinary-member tests. | Unit, source, build and CI checks are supporting evidence; they do not fill native UI case cells. |
| Are Chat and Pilot done? | **No.** They were inventoried and deliberately put in wave D, after all other applicable surfaces reach verified health. | A default Chat mount was observed incidentally in a guest flow. That does not verify Chat or Pilot behavior. |
| What is the running build? | Source `package.json` is **0.2.86**. The last receipt-bound local development artifact is **0.2.85**, tree `f35f13418d84d75e49819ca3a6be044a4fd01303d34e3db450f364780d05f8ff`. | The later release commit and lockfile changes were merged after that build. They were not installed, compiled or rebuilt in this campaign. The 0.2.85 receipt is historical for its exact tree, not evidence for current `main`. |
| What was shipped? | Git `main` contains the defect fixes and tracking records. The last locally verified release receipt in this campaign is **0.2.79**. | A local dev artifact, a green push, a release tag, a Chrome installation and a Chrome Web Store upload are different claims. We have no verified current 0.2.86 installation or Store upload. |

The strongest result of this phase is a source census, traceable defect log, guarded test process, and 22 defect closures. It is **not** a completion milestone for the full extension. The inventory's recorded source SHA `fb71764a6a7fe05bcc6e85be678d617f5174833b` predates the current checkout; its `scope_complete` flag says that census was made, not that present source or behavior is certified.

## What has been repaired

The records below are the authoritative closure details. This index groups the 22 closed defects so a successor can find their reproduction, fix and retest without treating the table as fresh acceptance on current `main`.

| Area | Closed defects | What the work resolved |
| --- | --- | --- |
| Runtime, authentication and test setup | [D01](defects/EXT-D-0001.json), [D07](defects/EXT-D-0007.json), [D09](defects/EXT-D-0009.json), [D11](defects/EXT-D-0011.json), [D14](defects/EXT-D-0014.json), [D15](defects/EXT-D-0015.json) | Sidepanel startup, development identity/auth hydration, isolated native browser setup, Settings acceptance and safe reset infrastructure. |
| Release and CI correctness | [D02](defects/EXT-D-0002.json), [D03](defects/EXT-D-0003.json), [D04](defects/EXT-D-0004.json), [D05](defects/EXT-D-0005.json), [D13](defects/EXT-D-0013.json), [D16](defects/EXT-D-0016.json), [D17](defects/EXT-D-0017.json), [D19](defects/EXT-D-0019.json), [D20](defects/EXT-D-0020.json) | Red release publication, package/catalog/migration gates, validation order, unit-test invocation and CI readiness/teardown defects at their recorded scope. These are engineering/integration closures, not proof of every feature's UI behavior. |
| Contained UI and controls | [D06](defects/EXT-D-0006.json), [D08](defects/EXT-D-0008.json), [D10](defects/EXT-D-0010.json), [D12](defects/EXT-D-0012.json), [D18](defects/EXT-D-0018.json), [D21](defects/EXT-D-0021.json), [D23](defects/EXT-D-0023.json) | Advanced settings control, popup Capture guards, desktop-port setting, an inline SVG scrape case, SEO history test oracle, and notice retirement after read/write outcomes. Their wider feature cells remain separately tracked. |

### One known defect still awaiting closure: D22

[EXT-D-0022](defects/EXT-D-0022.json) concerns Source recognition crossing organization boundaries in Scrape and shared chat page context, stale Saved/Open state after a workspace switch, and late response/refusal ordering. Scoped-query, stale-result and queue-order repairs passed focused red/green and independent source review. Its state is **fixed**, `ui_retest: pending`; do not mark [EXT-F-1007-T26](inventory.json) passed or D22 closed.

The latest actual native attempt, [read-only run 011](runs/d22-recognition-readonly-011.json), used the 0.2.85 dev artifact and real admin UI. It enumerated 98 accessible workspace choices and read 98 organization-scoped Source lists, each returning HTTP 200. Seven public-eligible pages were probed: one HTTP 500, five HTTP 404, and one redirect failed the runner's exact-URL rule. No candidate reached the positive Source/Open recognition flow. [Independent review](reports/d22-readonly011-peer.json) supports those bounded counts. This is a fixture/evidence gap, **not proof of either a new product failure or global absence of usable Sources**. Audit the redirect against the app's canonical URL behavior before changing the oracle or repeating the search.

Still unverified for D22: a positive Saved/Open identity match across workspaces, clearing the previous workspace's claim, rejection of an old response, service failure/recovery, and an in-flight Save completing after a workspace switch. The read-only runner cannot prove the late-Save case. The original local Source Save checkpoint is reserved: **never read, reset, advance, reinitialize, retry, delete, capture or click Save through its recovery path**. The same one-write preservation rule applies to the admin SEO Save checkpoint. [The D22 closure path](reports/d22-next-closure-path.json) and [coordinator checkpoint](COORDINATOR.md) contain the detailed safe route.

## Work still to do by surface

The feature inventory is the complete case-level list; this table names the major lanes and the evidence limits. “Observed” means an actual bounded result, not feature completion.

| Surface group | What was observed or built | Remaining verification |
| --- | --- | --- |
| Development install, navigation, auth | Dev build and type checks passed on prior source; startup and dev-auth defects closed. | Build current merged 0.2.86 tree, verify actual loaded unpacked extension ID/version, guest/member/admin sign-in and reload behavior across sidepanel, content scripts, service worker and offscreen. Primary personal Chrome's current channel/identity is unverified. |
| Settings and Debug | Several specific Settings defect reproductions closed. Debug admin cases T14/T15/T17/T22 have historical 0.2.79 passes across selected warm/reload/error states. | Exhaust the 72 Settings and 53 Debug cases and each applicable mode/control. Debug export T16 and verbose T18 have no accepted native result: run 001 did not use the guard-owned child and is excluded; properly guarded [run 002](runs/debug-export-dev085-002.json) stopped at `debug_open` before observations. Diagnose that opening failure before another attempt. |
| Popup, Capture, Scrape and Sources | Popup and scrape-specific fixes closed; D22 source-level repairs landed. | Every Capture/Scrape control, real persistence and cross-workspace behavior; D22 positive native retest. Never substitute a write-capable E2E test for the reserved read-only Source path. |
| SEO, Screenshots, Highlights, Guidance, Showcase | [Guest SEO run 019](reports/seo019-inventory-link.json) recorded 17 bounded target passes and one unverified Wikipedia metadata-door target, without passing the whole case. [Guest Screenshot run 003](reports/screenshot003-inventory.json) observed bounded warm/reload/role-transition behavior; the whole guest feature remains unverified. SEO history oracle defect closed. | Complete guest/member/admin breadth and relevant permissions, lifecycle and persistence. Admin SEO one-write Save-related acceptance remains incomplete. Admin Screenshot run 002 stopped during public-page setup; runs 003/004 were resource-refused before a child started. None passed the admin feature. |
| Profile, org selection, Tasks, Lists, Agenda, Data, Notes, Files, saved captures, Vault, popup/permission and keyboard controls | All controls and mode applicability are inventoried; selected auth/org and Vault readiness work exists. | Most native case results remain missing. Ordinary-member credential/access coverage is unresolved; admin success cannot stand in for member access. Verify actual denial and positive controls without changing roles, grants or organization data to make fixtures pass. |
| Registered tools, manual runner, smart tests, recorder, bridges, token broker, content-page entry points | Registered executor inventory has 169 feature entries/170 cases; local and cross-system prerequisites are represented. | **167 tool cases lack executable steps and expected results**. Reconcile the live advertised tool roster and design safe real-data fixtures before native execution. Test controls, permissions, refusals, positive execution and result rendering with real backends. Cross-client parity has one explicit skipped focused test because the sibling frontend checkout was unavailable; cross-repo end-to-end behavior is not verified. |
| **Chat and Pilot** | Nine Chat cases and four Pilot cases are inventoried as wave D. A guest default mount was seen incidentally. | Systematic guest/member/admin Chat and Pilot testing has **not begun**. Streaming, tool dispatch, approvals, persistence, page context, backend and frontend/desktop bridges, failures/recovery, and Pilot workflows need real end-to-end checks after the contained-surface gate. Do not infer health from their UI mounting or shared component unit tests. |

The `Tools / registered executor` count is a source inventory count, not 169 runtime-verified capabilities. Case counts elsewhere in the table are inventory sizes, not executed tests. The exact per-control applicability and result are in [inventory.json](inventory.json).

## Known weaknesses and evidence limits

1. **Coverage is mostly unverified, and the test design is incomplete.** Of the 1,142 case×mode slots, 1,088 are explicit unverified or have no result object. Twenty-four of 53 recorded passes are release infrastructure; 43 of 53 lack a linked build receipt. The 1,287 inventoried controls are a census, not 1,287 tested controls. Independently counting the case definitions found **168 without steps, 167 without expected outcomes and 30 without control IDs**; 167 registered-tool procedures are explicitly marked as still needing design. Historical passes should be rechecked where changed runtime or dependencies affect them. The inventory needs a source-delta audit after recent merges, then the missing procedures must be filled before those cases can run.
2. **D22 fixture selection can block truthful acceptance.** Run 011's exact-URL rule rejected a redirect that might be canonical normalization. Changing that rule without a source/behavior audit could create a false pass; retaining it without audit could strand a valid fixture. The six HTTP failures and redirect are observations about seven candidate pages, not a product defect finding.
3. **A Debug runner failed before testing its target.** The guarded T16/T18 attempt recorded only a broad `debug_open` failure category. Improve bounded diagnostics, review the runner, then retry once with a fresh resource permit; do not promote the excluded run 001.
4. **Authenticated coverage is skewed toward admin.** A working ordinary-member credential and authorization fixture has not been established. Real non-member denial and a positive authorized comparison are needed for org-scoped claims.
5. **Build provenance is behind the merged source.** The 0.2.85 dev receipt predates 0.2.86 and later lockfile changes. Its native attempts remain valid for that old tree only. Current dev installation and Store runtime identity are unverified; no current release or Store acceptance claim follows from a Git push.
6. **Closed defect schemas are heterogeneous.** Several older records lack a dedicated `original_reproduction_retest_run` field but cite verification receipts, transition history and peer evidence elsewhere. That missing field alone does not reopen a closed defect. Inspect the record's full evidence and its stated boundary before using it to claim a wider feature pass. D23, for example, closed the notice retirement defect on 0.2.79; late-arriving write notice was unit-only, member mode and full pending-handoff queue semantics remain unverified.
7. **Several receipts depend on local private or temporary data.** Sanitized, committed `runs/`, `reports/`, inventory and defects survive a session loss. Raw `/tmp` logs/results, disposable browser profiles and private 0600 fixture/checkpoint files may not survive a reboot or transfer; hashes in committed receipts preserve provenance but cannot recreate those inputs. Keep checkpoint files intact on this host and do not commit credentials or private identifiers to make a handoff portable.
8. **The resource gate has limits.** It admits one heavy run at a time and refuses under memory, CPU, swap or disk pressure. A refused launch has no product verdict. It cannot control unrelated contributors' processes; root must check permit ownership, child/wrapper exit and lease release. A past manually launched Debug child showed why a permit around a separate holder is insufficient.
9. **Automation covers synchronization, not the full QA campaign.** An approved hourly repository-sync automation exists. It does not autonomously run browser tests, adjudicate defects, rebuild current artifacts, or release. Active coordination must still fetch/merge/revalidate/push at task boundaries and at least hourly, preserving other contributors' changes.

## Safe resumption order

1. Read [COORDINATOR.md](COORDINATOR.md), [CHECKLIST.md](CHECKLIST.md), [inventory.json](inventory.json), and current defect states. Check `git status`, fetch `origin/main`, compare incoming changes with the inventory and previous build receipts, merge safely, and push only a green synchronized tree. Do not reset, force-push, discard another contributor's edits, or silently reuse stale native evidence.
2. Confirm no other heavy test or build owns the permit. Use `node scripts/stabilization-resource.mjs check --profile-dir <actual-test-profile>` for a fresh preflight. Every heavy build/test/browser run goes through `scripts/stabilization-resource.mjs run`, with the real owned profile, one at a time. A refusal is recorded as infrastructure; wait for a healthy preflight rather than lowering thresholds. See [PLAN.md](PLAN.md) for the full watchdog and admission contract.
3. Install the current merged lockfile, run `pnpm compile`, build the unpacked development extension under separate permits, and write a new immutable local-dev receipt. Load/reload that exact artifact in Chrome and check the runtime identity. Reopen the sidepanel, reload target tabs for content-script changes, and distinguish service-worker/offscreen restarts from extension reload. The build/reload details belong in each native procedure; HMR alone is insufficient.
4. Diagnose the Debug `debug_open` setup failure from safe evidence. Independently audit D22's redirected candidate under the app's canonical URL rules. Then run bounded, read-only, receipt-bound native retests. Keep the Source and SEO Save checkpoints untouched. Do not turn fixture setup failure into a product failure or a pass.
5. Continue contained surfaces through every control and every applicable guest/member/admin cell, recording no-result as unfinished. Route genuine reproducible bugs into a stable defect JSON, fix their class, obtain an independent reproduction/adjacent-case retest, and then close them. Defer systematic Chat/Pilot until the non-Chat/Pilot gate is actually green; log incidental findings immediately.
6. Reconcile `main` regularly. Before publishing a code or evidence change, check the exact merged source, run relevant gates, and keep build-bound verdicts tied to their original tree. Use the existing [plan's lane and escalation thresholds](PLAN.md): Luna testing gets two failed attempts or 15 minutes before decomposition/reroute; Sol implementation gets two failed rounds, a repeated regression, or 30 minutes without verified progress before escalation. Independent peer review precedes integration.

### Concrete guarded restart on this host

For an **owned isolated profile**, the previous runs used the actual external temporary/profile directory below. Confirm it still exists and is writable, then set this variable once in the shell. Primary personal Chrome uses its real boot-volume profile for admission; never pass this external directory as a substitute for that profile.

```sh
stabilization_tmp='/Volumes/Samsung2TB/code/.stabilization-scratch/matrx-release-temp-032'
```

Run each following command **separately**, after checking there is no active heavy lease. Use a fresh timestamped run ID for every launch. Confirm the wrapper exited zero, its child finished, and the lease cleared before starting the next command. Stop and diagnose any refusal or nonzero exit; these lines are not an automatic retry script. The install deliberately skips lifecycle scripts; run WXT preparation through its own guard if needed for the subsequent compile/build.

```sh
TMPDIR="$stabilization_tmp" node scripts/stabilization-resource.mjs run --run-id "resume-install-$(date -u +%Y%m%dT%H%M%SZ)-$$" --profile-dir "$stabilization_tmp" -- pnpm install --frozen-lockfile --ignore-scripts
```

```sh
TMPDIR="$stabilization_tmp" node scripts/stabilization-resource.mjs run --run-id "resume-prepare-$(date -u +%Y%m%dT%H%M%SZ)-$$" --profile-dir "$stabilization_tmp" -- pnpm exec wxt prepare
```

```sh
TMPDIR="$stabilization_tmp" node scripts/stabilization-resource.mjs run --run-id "resume-compile-$(date -u +%Y%m%dT%H%M%SZ)-$$" --profile-dir "$stabilization_tmp" -- pnpm compile
```

```sh
TMPDIR="$stabilization_tmp" node scripts/stabilization-resource.mjs run --run-id "resume-devbuild-$(date -u +%Y%m%dT%H%M%SZ)-$$" --profile-dir "$stabilization_tmp" -- pnpm exec wxt build --mode development
```

Only after the build wrapper succeeds, record its **new, immutable** local artifact receipt. The recorder refuses an existing output file and a manifest/version mismatch; it never turns the dev build into a published release.

```sh
dev_receipt="test-results/source-dev-build-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
node scripts/record-local-dev-build.mjs --extension-dir .output/chrome-mv3-dev --output "$dev_receipt"
```

After the redirect/oracle audit and a fresh runner review, a D22 **read-only** browser run is a single guard-owned child as below. Set `MATRX_PLAYWRIGHT_MODULE` and `MATRX_CHROME_PATH` to the installed paths required by [the native harness](../../tests/browser/native-sidepanel-qa-harness.mjs); keep credentials and private fixture values out of the shell log and committed evidence. Inspect the wrapper exit, child result and lease before adjudicating the run. This example does not authorize the reserved Save path.

```sh
SOURCE_DEV_BUILD_RECEIPT="$PWD/$dev_receipt" TMPDIR="$stabilization_tmp" node scripts/stabilization-resource.mjs run --run-id "resume-d22-readonly-$(date -u +%Y%m%dT%H%M%SZ)-$$" --profile-dir "$stabilization_tmp" -- node tests/browser/source-recognition-readonly-acceptance.mjs
```

Credentials are retrieved only at point of use from the authorized local source or authenticated vault UI; no password, token, auth URL, Source ID or private fixture value belongs in committed evidence. The admin account is the starting authenticated mode, not proof for ordinary members. The user can add random issues and preferences at any time; give each discovered behavior a feature/case link and each reproducible defect its own record, without replacing the incomplete baseline with a new informal list.
