# Stabilization takeover — execution contract

Prepared 2026-09-27 America/Los_Angeles. Planning deliverable only: no installation changes, product tests, builds or fixes performed by the takeover. This document amends the existing PLAN.md; inventory.json remains the sole coverage authority. Historical baseline statements in PLAN.md and COORDINATOR.md are not current installation evidence.

## Outcome and baseline

Resume the existing campaign rather than rebuild its process. The handoff records 205 features, 693 cases, 22 closed defects and D22 fixed awaiting native retest. Most user-facing coverage is unfinished. Local source is 36c0b5a1 (0.2.87); a fresh origin/main fetch matched that HEAD; the current runtime is not yet verified. The handoff's latest local development receipt is 0.2.85. Neither historical closures nor source versions certify today's UI.

Reference standards are Chrome/WXT runtime contracts for lifecycle correctness and the user's exhaustive traceability and independent-retest requirements for acceptance. No fresh architecture or product redesign is authorized by stabilization alone.

## First bounded execution block

1. Synchronize safely with origin/main and check existing feedback, workers, resource permits and local changes. Preserve every contributor's work. Establish current source, dependencies and active runtime.
2. Within a 90-minute baseline/inventory window, reconcile the existing entire feature/control census against source changes, registered tools and read-only runtime visibility. Preserve stable IDs. Include guest, member and admin applicability, hidden/denied controls, dialogs, menus, keyboard actions, content-page entry points, optional permissions and dependencies. Include Chat/Pilot as deferred. A second agent checks completeness. No behavioral testing until the full census gate passes.
3. Within the same window, establish unpacked development in an owned test profile. Disable the Store copy in the testing environment to prevent double execution; preserve personal local state before removal. Inspect the user's primary Chrome installation too: isolated-profile setup alone does not satisfy the requested channel switch. Prefer a completed development build for acceptance because an idle WXT server consumes the single heavy-job permit. For interactive development, use the equivalent admitted pnpm exec wxt command under the same permit; the pnpm dev alias is not currently admitted. Verify actual path, extension ID, build fingerprint, callback/origin compatibility and real sign-in.
4. Every runnable procedure gets executable steps and expected outcomes before dispatch, including build/reload preconditions. Missing procedures for later tools are tracked explicitly and filled just in time; they do not justify months of scaffolding or a false full-coverage claim. Missing census entries do block the inventory gate. At 45 minutes report concrete gaps; at 90 minutes stop process expansion and finish only essential inventory/environment prerequisites.
5. Test the smallest contained surface, reproduce a real defect, route its repair and independent retest, then integrate green. Aim for the first newly verified fix within 30 minutes after baseline readiness; log a missed target honestly. Do not count a historical closure as the takeover's first fix. No new dashboard, framework or expanded automation before that fix. If no defect is found, continue to the next contained surface rather than invent one.

## Coverage, evidence and sequence

Use existing inventory.json, defects/, runs/, reports/, events.jsonl and COORDINATOR.md. No competing status tracker. Each feature retains its stable ID, owning surface, control/case IDs, source anchors, dependency wave, mode applicability, test status, defect links, retest status and build evidence. All work links to those IDs. Generate coverage from the inventory with every applicable cell in the denominator; unverified, stale and blocked remain visibly unfinished. Not-applicable requires a reason and does not excuse access-denial testing.

Order: local controls/settings/browser utilities → direct-persistence non-chat surfaces → remaining cross-system non-chat surfaces → Chat/Pilot. Finish a surface's applicable controls and modes before moving on, except to progress independent work around a recorded prerequisite. Chat/Pilot systematic testing starts only after ALL other applicable cases pass, defects close and the integrated/released baseline is verified. Log incidental findings; early hotfixes only for global blockers or safe-operation failures.

Each native run records source/lock/output fingerprints, runtime ID, Chrome/build mode, profile label, role/org state, permissions, real-service provenance, guard receipt and sanitized evidence. Wait for build completion, reload the extension, reopen the sidepanel and extension pages, reload affected content tabs, and verify service-worker/offscreen lifecycle separately. HMR or manifest version alone cannot prove freshness. Exercise relevant warm/cold, navigation, denied-permission and recovery cases. Supporting unit/source checks never promote UI cells. Remote changes invalidate affected passes; unknown impact requires wider retesting.

Defects require: stable ID; feature/control/case; surface; auth mode; preconditions; numbered reproduction; expected/actual; evidence/build; reproducibility; severity; priority; owner; state; root cause/siblings; fix commits; original-reproduction and adjacent-case retest; independent reviewer; transition history. Severity describes impact; priority describes work order. Return incomplete reproductions for completion before triage.

State path: open → triaged → in-fix → fixed → retest-pass → closed. Failed retests: fixed → retest-fail → in-fix. Regressions reopen with preserved history. Closed requires an independent original-reproduction retest plus surrounding cases, not just a successful build.

## Flat team and resource limits

Owner coordinates, reviews compact verified returns and integrates. At most three workers; no worker spawns another layer.

| Lane | Model | Assignment | Escalation |
|---|---|---|---|
| Structured execution | GPT 6 Luna, medium | Narrow census/test batches, reproductions and straightforward independent retests | Two failed/unusable attempts or 15 minutes without usable evidence: split once or route to Sol |
| Implementation | GPT 6 Sol, medium; low for mechanical work | Diagnosis, class-level fixes, self-verification; complex peer review | Two failed rounds, repeated same regression, or 30 minutes without verified progress: changed hypothesis/scope or fresh Astra |
| Exceptional | GPT 6 Astra, low/medium | Explicitly escalated hard work | One 30-minute diagnostic assignment; report evidence and next step; no recursive team |

Non-building/non-running returns are rejected immediately and consume an attempt. After three unsuccessful review rounds the coordinator changes the approach. Direct owner implementation is the last resort. Actual elapsed time is enforced at dispatch checkpoints; no claimed token cap without usage metering.

Return schema: task_id, lane, model, status, feature_ids, defect_ids, summary, changed_files, commit_shas, verification[{case_id,run_id,verdict,evidence}], limitations, open_questions, next_action. Maximum 15 chat lines; detail on disk. Fresh peer review supplies separate behavior and code-quality verdicts before owner integration.

Reuse stabilization-resource.mjs and resource-policy.json. ONE heavy job total, including build/test/browser, ONE browser profile running tests, and at most one lightweight worker alongside it. Atomic admission owns the actual child and actual profile volume. Before dispatching a new runner or release invocation, independently review its foreground/process-ownership and safe diagnostic behavior, then register its exact trusted command in the existing allowlist. Unlisted commands remain refused; never bypass the guard with a shell wrapper. Refuse on unsafe/missing measurements, another lease, pressure above normal, available RAM below max(4 GiB,20%), disk below 20 GiB, swap growth above 256 MiB/60s, mean CPU busy >=75%, or >=60% with normalized load >=0.75 during the sampling window. Sample 60 seconds before launch and every 15 seconds during work. Two unsafe samples stop owned work safely; three healthy samples plus fresh admission are required to resume. Never lower thresholds to pass a run or kill unrelated processes. Resource refusal has no product verdict.

## Integration and shipping

Coordinator alone integrates/pushes. Workers own disjoint paths and commit only completed green units with exact paths. One defect per code commit, ID in message. Fetch at task boundaries and every 15 minutes while active; pull/reconcile before every push, with at least hourly green checkpoints. No reset, force-push, blanket staging, dirty-tree autostash or discarded conflict side.

Check the exact integrated candidate: types, relevant regression/repository gates, independent native retest and evidence consistency. If source moves, reassess and rerun affected checks before publication. Use the current release.sh after inspecting its present behavior; the old plan's release-order defect is historical, not permission to reimplement an already repaired release path. Refresh shared packages per consumer guidance before release. Record Git push, dev installation, packaged release and Store/provider publication separately. This repo owns its release; do not hand it to a nonexistent release agent.

## Consolidated anticipated blockers and resolutions

| Potential blocker | Autonomous resolution / honest limit |
|---|---|
| Chrome control, unpacked identity, origin callbacks | Inspect and configure authorized local development; verify the actual primary/test installations and real sign-in. Never infer setup success from a build. |
| Credentials, member/non-member identity, selected organization | Retrieve authorized secrets at point of use through existing vault/local mechanisms without outputting them. Establish existing safe identities/memberships. Admin is not evidence of member behavior; unavailable access stays unverified. |
| Mutation fixtures and external effects | Use realistic campaign-owned disposable records and controlled destinations. Preserve existing user data; no unsolicited real-person messages, purchases or broadened grants. Cases needing unavailable targets remain open while independent work proceeds. |
| Reserved Source and SEO Save checkpoints | Preserve them untouched, including no reading/recovering the reserved Source checkpoint. Review the existing safe closure path. Read-only evidence cannot close late-Save acceptance. |
| D22 fixture gap / Debug setup failure | Audit URL equivalence and improve safe stage diagnostics before another bounded attempt. Do not endlessly retry fixture discovery, turn setup errors into product failures, or let D22 monopolize contained-surface progress. |
| Source drift / incomplete procedures | Delta-audit the census, rebuild the current tree, design each procedure before execution, regenerate derived coverage and preserve historical receipts. |
| Resource pressure / unavailable services | Existing fail-closed admission; repair owned environment, route service issues appropriately and continue lightweight/independent work. No unsafe bypass. |
| Ambiguous behavior | Apply current user mandate and canonical contracts, state expected behavior before tests, record reversible technical rulings. |
| Continuous operation / provider-only gates | Verify the existing hourly sync automation; it is not a QA daemon. Files permit recovery, not execution while a chat is inactive. Establish a registered QA wakeup only with a named interval under scheduling policy; do not claim it exists. New provider-only gates affect their own cases, not the whole campaign. |

No human-only blocker is established by this read-only planning pass. This planning deliverable is the consolidated up-front blocker checkpoint: there are no questions requiring the owner now. Existing authorization covers routine setup, testing, repairs and integration, so execution proceeds without another general permission checkpoint. Resolve discoverable access facts during the capped baseline. Unexpected provider/security/irreversible gates cannot truthfully be guaranteed away; isolate affected cases and continue the rest, surfacing only a genuinely unavoidable human action. Do not convert missing test access into a pass or weaken access controls.

## Review and next action

Independent Sol/medium REGRET and BUILDABILITY reviews completed on 2026-09-27 (source-only; no runtime verification). Both findings accepted and fixed: use the already admitted dev-server invocation and review/allowlist every new runner before launch; make this deliverable the up-front blocker checkpoint with no further routine permission pause. Review agents: /root/takeover_regret and /root/takeover_buildability. No scope expansion or new product contract resulted.

This is the requested pre-execution deliverable, saved locally for the next green documentation integration. Next action after delivery is the bounded baseline above; no product-health claim follows from this plan.
