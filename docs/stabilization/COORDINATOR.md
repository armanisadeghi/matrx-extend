# Stabilization resume checkpoint

Campaign active and incomplete. No overall health or bug-free claim is supported.
[PLAN.md](PLAN.md) governs execution; [inventory.json](inventory.json) is the coverage truth.
Generated STATUS/CHECKLIST views derive from it. Earlier evidence remains in linked reports/Git.

## Current truth and release boundary

Read the canonical [Chrome Web Store record](/Users/armanisadeghi/code/common-docs/systems/apps/extension/CHROME-WEB-STORE.md)
before any release action. Last authenticated primary dashboard: October19 16:20UTC,
published0.2.205, draft0.2.479 rejected, no pending, Upload enabled. Vault login works;
no human-only access blocker is established. No new upload/submission has occurred.
Never infer private review state from old email/public listing or this checkpoint.

Prior candidate **0.2.566**: guarded release39347129008, source/tag
`c41ae6fd67057305c521791e404d2708882895f5`, artifact12231343581,
StoreZIPsha256`a76ad27eec12ef74d737986fa37bbc28f3d5c3ad2ad5ee10c30fd2886fe92840`.
[Package peer](reports/candidate566-package-peer-20261019.json) passed at review time;
strict gates passed, advisory Mandate/config findings remain unknown. Recheck package/backend
and source eligibility immediately before release actions. Later source is not this artifact.

Current candidate **0.2.567**: guarded release39352466107 SUCCESS, source/tag
`92757742d13c8230bcc8447fdf7ddaf2c5db180b`, artifact12234116008,
StoreZIPsha256`4d6a42bd1cece0a8433fdbe403e2c4f02784716c62162fd5258bf82e87fcd40d`.
[Fresh package peer](reports/candidate567-package-peer-20261020.json) verifies exact source,
receipt, hashes and archived strict gates at build cut. Registry subsequently advanced api.51→.52
(optional types/contracts) and design-system.229→.230 (table phone-card windowing); source ranges
reviewed, no mandatory host action found. Candidate is NOT registry-current. Root allows guarded
acceptance of this frozen main artifact; no strict gate is waived and upload remains pending
fresh source/runtime/Store eligibility plus product acceptance. Do not rebuild merely for a
higher version label without reviewing actual drift/Consumer actions.

**Product acceptance remains blocked by actual non-admin first-turn failure [D261](defects/EXT-D-0261.json).**
Independent native tester signed in through the real first-party flow, opened fresh member Chat
after normal panel reload, sent the public-demo question and saw Page Text/Processing end in
`API error: 504`, no assistant answer. The original native run did not capture transport; later read-only ALB/app correlation proves
start200, tool_results200, then resume entered the router and received no response headers for
59.999s before ALB504. Concurrent DB timeout errors are correlated, not a proven cause. Member follow-up was not
run. Prior guest-to-member retained transcript/Capture-list alert and inert controls are a
provisional separate lead, with driver activation not excluded. Exact-org-ID comparison was
not captured; visible acting org and non-admin identity were verified by the canonical helper.
[Native report](reports/native-isolated-candidate-20261019.json),
[image/evidence peer](reports/native566-evidence-peer-20261019.json),
[initial diagnosis](reports/member566-tool-stall-diagnosis-20261019.json),
[production correlation](reports/member504-server-log-diagnosis-20261020.json).
Live backend advanced to20bd8859ffb7c71d05c3edb7a78e2a3060876b59; inspected resume/pool code
is unchanged. Short postdeploy logs lack the prior timeout burst; current member behavior and
root cause remain unverified, not repaired by inference.

## Verified product progress and exact limits

- **[D260](defects/EXT-D-0260.json) closed for its original Article reproduction.** Product fix
  `d1bd25d7d` preserves heading-bearing semantic article headers only in cloned extraction input.
  Independent exact566 fresh guest Capture/Re-capture retains original heading, full introduction
  and Capture/Understand/Use179words; actual screenshot was peer-reviewed and owner rechecked.
  Links17, SchemaArticle and SEO neighboring checks were observed. Earlier independent admin
  reload/recapture also passed. WholeT08/media/member/reload coverage remains partial; this repair
  is not Store-published. Member Chat504 is separate, not an Article closure criterion.
- Native fresh unseeded guest first and same-conversation replies, Page Text/resume UI, Data one
  field→Done→unique selector→guest save gate, default auto-capture off, Article/Links/Schema/SEO
  have bounded observations. Only named cases are credited; no formal native network-terminal or
  before/after server-SHA pair was captured. Backend diagnostic separately read9ef78d4ade91d8f1cb1951710266b094db5744bf.
- Exact566 hostedB39348092593 completed three grounded protocol-terminal guest replies: opening,
  SAME-conversation second, NEW conversation after panel reload third. Demo checks passed except
  Data Done: `DOM.getNodeForLocation` returned `no_node_at_location` before mouse input. Resources
  valid. Actual native Done succeeded in a different window geometry; width alone is refuted by
  actual-source366px/500px fixtures, and activation cause remains a hypothesis.
- Exact566 hostedA39348194286 stopped before Chat because the original panel became hidden
  between organization-open and extension-identity observations, before any picker input/Escape.
  It is a driver visibility refusal, not demonstrated organization or Chat product failure.
  Both A/B terminal failures and six sanitized resource finals are in the
  [release checkpoint](reports/store-release-v0566-acceptance-20261019.json).

## Source units and immediate next work

Active owner `root/release_next_hosted_owner` owns the next exact567 A/B acceptance and release
checkpoint. Exact567 guest B39353960745 and member A39354133238 are TERMINAL failures.
[Exact567 results](reports/store-release-v0567-acceptance-20261020.json): B resources valid;
opening and same-conversation replies reached terminal answers, but answer screenshot clipped,
so full guest gate UNVERIFIED. Data Done repeats no_node_at_location before mouse despite visible,
focused original target; simple foreground hypothesis is refuted. Article/Links/Schema/SEO and
capture-off have bounded passes only. A resources INVALID (CPU/load), stopped owned_profile,
no member send/no new D261 evidence. One-use link/secret deleted with absence verified; no active
external run or new Store upload. Fresh hard-stall agent root/data_done567_forensics owns read-only
protocol diagnosis; root/settings_absence_assertion_repair fixes the T22/T63 absence-oracle bug
with fresh peer/CI still required. Settings A39352539316 and the guarded build are terminal.
Root owns integration/records. Source-only repairs are committed; verify origin/main and the next CI before relying on integration:

1. **D248 `8d8fda5fe`**: shared trusted foreground restoration before organization proof;
   original-target/visibility checks before every org picker/option input, including after shared
   pointer settling immediately before press. Release-after-press cleanup remains unconditional.
   Fresh peers found two real gaps; both repaired,70focused/adjacent tests pass and final source
   qualityPASS. Native replay pending, D248 remains in-fix. Six existing/new guard suites are now
   registered in the existing automatic focused CI command. No new workflow/job.
   [Repair](reports/member566-foreground-repair-20261019.json),
   [final peer](reports/member566-click-boundary-peer-20261019.json).
2. **D258 `02503153b`**: one canonical original-page foreground step before strict Done hit;
   safe before/after geometry/visibility evidence, backend-node identity retained through final
   CDP session, fresh moved coordinates and strict hit equality. No blind retry/fake DOM.
  21targeted tests, meaningful mutations, compile and fresh source peer pass. Three Data suites
   registered in focused CI. Exact567 native experiment failed at the same no-node boundary; no product fix or native closure claim.
   [Repair](reports/data566-foreground-experiment-20261019.json),
   [final peer](reports/data566-final-peer-20261019.json).
3. Previous full focused command passed585/585 under a valid Mac guard, before the test-list
   registration; separate member70/Data21 suites passed. Combined automatic suite676/676 and full lint
   passed in CI39351587471/focused39351587375 at27b7defe; exact567 release gates also passed. Local full lint was REFUSED before spawn for swap growth; never
   call it passed. Appropriate source/compile/Biome checks passed. Real product gates remain pending.
4. Use normal source admission to determine whether reviewed harness changes may retest frozen566.
   Do not expand an allowlist as an exception or waive a refusal. A new candidate, if required,
   uses only guarded hosted release after source/runtime/package/spend checks. No stale candidate
   upload or pending-submission replacement.
5. Reproduce D261 on an independently admitted host with passive transport attached BEFORE send:
   classify start/tool_results/resume HTTP statuses and terminal event names, fingerprint identities,
   exact approved principal/org, actual foreground, before/after server SHA. One watched short
   call; no raw headers/bodies/auth values. Live catalog read recovered through current Matrix
   RPC: [choice receipt](reports/test-catalog-read-recovery-20261020.json). Plumbing choice is
   GPT OSS20B; the single current member discriminator preserves its actual persisted selection
   and must record it, since changing model would not reproduce the original Sonnet5.5 incident.
   Fresh-direct-member vs original guest→member transition
   is a discriminator, not interchangeable closure evidence. Use current catalog/test-model skill.
   [Prepared observer handoff](reports/member566-network-repro-20261020.json).
6. Continue Settings/navigation and Scrape/Data/SEO registered product cases on independent hosts;
   deeper Chat/Pilot remains deferred except release/basic-flow regressions. D217 stale-session
   Save/Retry, D198 SEO history and other fixed-but-unretested cases remain open at their scopes.

## Local resource constraint — not a human-only access gate

On October20 around01:02UTC, system free space fell39→7.9GiB. Apple `cloudd` owns an actively
growing CloudKit temporary cache file,34.38GiB allocated. Targeted growth matches disk loss.
Canonical groom dry-run/apply recovered0B; no safe agent-owned12GiB cleanup target exists. No
personal cache/data or Apple process was removed/stopped. Heavy Mac tests/UI remain on hold
below the20GiB guard minimum; never lower thresholds or remove the unsafe hold/lease.
[Recovery](reports/mac-resource-recovery-20261020.json),
[writer diagnosis](reports/mac-disk-growth-diagnosis-20261020.json).
Independent hosted guards/CI are not globally blocked by this Mac constraint. This is not an
account billing/spend refusal and no blocked job may be relocated to bypass an account block.
Prepared fresh local member repro never launched/minted credentials/called a model and is
checkpointed; do not claim it tested anything. Resume local work only after normal admission.

## Installed development copy

Personal Chrome profile8 keeps dev`cihdmkcdjjckfhjpgoedmgfpoljebaml`0.2.565 loaded from
`/Volumes/Samsung2TB/code/matrx-extend/.output/chrome-mv3-dev`, enabled/pinned beside actual
Store`hnfolienncfklkgmdjjmhhegglimlamg`0.2.205. Last actual reload:
CI39342629514/artifact12228829443/source`199e2e738ac928b661c8f1a55f1d4dcc6ddff440`,
tree`f5c2313bc27330260b029824b178e1f667cd28e98aa23307d54531a8b6f607bf`.
Latest verified development566 artifact12234085062 is from successful CI39351587471/source27b7defe,
tree4099b912…c1141c, not promoted/reloaded. Later release567/main is not loaded. Import with current-test-artifact, promote
with promote-ci-dev-artifact and guard actual reload/path/ID/version/pins after local recovery.
Personal principal is a real personal admin; never log it out. Use owned profiles for auth tests.

## Integration and continuity

At most3workers beside root; two hosted browser lanes on isolated hosts, one guarded heavy job
per physical host. Actual ADMITTED plus root GO precedes UI; no UI after guard final. Terminal
raw journals are preserved byte-identically in ignored test-results; commit only copier-produced
sanitized journals and safe reports. Unsupported API is not a safety refusal; genuine browser
safety refusal cannot be bypassed.

Fetch/merge at boundaries and at least every15minutes, preserve contributors, exact-path commits,
push verified units frequently. Current real weekly CI spend read is59.50/$100 complete/nonstale;
refresh before paid dispatch/publication. Off-track waste flags do not replace actual real total.
No account billing block workaround. This Mac never runs manual builds/releases.

Update canonical records and generated views together; never promote source/CI/fixtures to
product passes. Before ending, every worker and external action must finish or checkpoint exact
ownership/handles/provenance/credentials cleanup/next action. The inventory has no overall healthy
feature-mode claim; all unknown, stale, blocked and unverified coverage remains explicit.

## Current batch/census checkpoint

[Settings A report](reports/settings-guest-hosted-20261020.json): exact CI566/source27b7defe,
all resource finals terminal and acceptance resource-valid/child_failed. T22 warm precondition is unproven (active=false, sections=[]); no whole-case pass is credited. T04/T28/T40
have bounded observations but restoration/full-extension-reload criteria are missing. Remaining
cases stopped at driver readiness/guest-state prerequisites. No product bug or retry is inferred.
No unique case pass or overall Settings health claim. Fresh [boundary review](reports/settings-reload-boundary-diagnosis-20261020.json) localizes the first readiness failure to T04 baseline restoration; cause unknown. Failure-time tab membership/strip identity and restoration stage are missing. The screenshot preceded the failure and cannot diagnose it. No blind batch retry; member A is terminal resource-invalid.

[Corrected auth census](reports/auth-inventory-fresh-check-20261020.json) uses canonical inventory,
not obsolete refinement data. Nine solely removed-picker cases retain IDs/history as explicit N/A;
two current load-ladder cases are newly registered unverified. Surviving Settings/error/archive/
cross-context cases remain unverified and stale clauses are tracked. Zero product passes gained.
