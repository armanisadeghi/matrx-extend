# Showcase — current priority

Owner request 2026-09-27: use Showcase and make repeating-pattern discovery, extraction by its supported methods, saving, remembering and repeat extraction fully functional. This supersedes Screenshot sequencing as the immediate priority; it does not discard broader inventory or Chat/Pilot deferral.

## Target and existing capability

Authoritative coverage: inventory EXT-F-1012, stable controls/cases in inventory (original IDs retained). Preserve stable IDs; extend missing preview/save/reopen/replay cases per method before testing them. Existing UI: Doctor, Recipes, Prepare, Snapshot, JSON-LD, Microdata, Tables, Framework, AI Extract, List Pattern, Network, Patterns. Shared extraction/data-pattern primitives remain canonical. Guest/member/admin applicability stays tracked. A disallowed mode passes only its actual denial behavior; it is not an extraction pass.

Installed-extension evidence: `docs/stabilization/runs/showcase-d43-dev108-build.json` records the verified unpacked 0.2.108 artifact, and `docs/stabilization/runs/showcase-installed-d43-001.json` records a partial real-calendar UI retest. On https://electronic.vegas/vegas-edm-event-calendar/, Doctor handoff and the selected 249-card collection produced distinct title/href rows, and navigation cleared the old result. The visible table exposed only the first 200 rows; save/reopen was not exercised. Use that real calendar plus a structurally different real public site for further live acceptance. Controlled fixtures remain code-regression evidence only.

Primary reference: Apify's explicit reusable input/run/structured-output contract (https://docs.apify.com/actors). Apply the principle to saved pattern configuration and replay, without adding an unrelated platform or product redesign.

## Scope and verification

**Acceptance environment (owner ruling, 2026-09-27):** build the development
extension, verify the build receipt and loaded extension version, explicitly
reload the unpacked extension in Chrome, refresh the target page, reopen the
Showcase panel, and exercise the actual controls on real public websites. Do
not use localhost pages or a test server as Showcase UI acceptance. Use the
electronic.vegas calendar plus a structurally different real site. The
`tests/fixtures/showcase-replay/` fixture and other controlled fixtures may
support focused code regressions, but fixture/server results are never
installed-extension acceptance. Unit tests establish code regression evidence
only; they do not substitute for the installed-extension workflow. Preserve
historical fixture reports as historical evidence without promoting them to
live proof.

1. Map all existing extraction methods to their live controls, exact serialized configuration, executor, persistence door and inventory cases. Audit gaps are findings, not passes.
2. Prove first broken user path quickly: capture a red reproduction, fix the common cause, peer review, rebuild/reload and retest. Avoid new harness frameworks; reuse existing native harness/driver or the current real Chrome UI under the manual browser resource permit.
3. Complete the vertical workflow: detect → select list/fields or structured method → preview real rows → save the exact executed configuration → leave/reload → reopen saved pattern → rerun with matching fields and accurate values. Then test changed data, tab/navigation switching, empty/unsupported/error/cancel outcomes.
4. Cover all nine saved pattern kinds and every Showcase control, including rename/delete and result copy/export. AI and network methods require their genuine backend/network execution, not fixture-only success. Test mutations use explicitly named owned test patterns and retain exact identities for cleanup; never delete unrelated patterns.
5. A defect closes only after original reproduction and surrounding cases pass with a fresh independent verifier. Unit tests are diagnosis/regression evidence, not UI proof. No whole-feature health claim until each applicable inventory cell resolves.

## Initial findings and sequencing

Current Showcase state: D39 Doctor-to-List handoff is closed after the installed .108 retest. D41 has source repairs but still needs its selected-request identity red/fix/green/types sequence and independent installed replay. D44 has focused source green with combined compile and installed real-site replay still pending; its peer-corrected contract is nonblocking route guidance, exact scope, honest no-match, and current-page provenance. D45 is a triaged, source-confirmed picker transaction loss; its regression is being prepared outside test discovery. D46 is a separate source-confirmed, runtime-unverified dotted JSON key ambiguity in Network and Framework. No source/test result promotes these remaining inventory cases to live acceptance.

First repair wave is limited to proven discovery/save/replay bugs. No new DB/table contract, access-policy change or broad feature migration is planned. Any required dependency update follows existing shared-package contract. Exact scopes and file ownership are assigned after independent plan review.

## Environment, delegation and gates

Current installed target: primary Chrome uses the unpacked development extension ID `cihdmkcdjjckfhjpgoedmgfpoljebaml`; the latest verified live acceptance artifact is 0.2.108 at `.output/chrome-mv3-dev`, per the receipt and run above. Later source commits are not covered by that build. Before accepting later fixes, build from the exact source, verify the receipt and loaded version, reload the extension, refresh the real page, and reopen Showcase.

Only one guarded heavy build/test/browser permit is allowed. At this checkpoint Astra owns the sole guarded D41 red/fix/green/types permit; this lane starts no build, test, server, or browser process. The previous D44 compile refusal reported `RESOURCE_LEGACY_RUNNER_BUSY`; its contemporaneous process identity was not captured, and the current coordinator records the attribution as unknown. Never lower thresholds, terminate foreign processes, or treat a refusal as a test result.

Luna medium: narrow execution. Sol medium: product fixes and moderate diagnosis. Two failed attempts or repeated regression cause decomposition/fresh escalation; no speculative wait patches. Fresh peer validates before root integration. Structured reports contain status, changes, exact verification, files, unresolved items. No secrets in artifacts. Reserved d22-source-save-attempt.json remains untouchable.

## Decisions and open questions

The user already authorized autonomous execution and this repair scope; no repeated approval checkpoint is needed. Site-specific unsupported capabilities must show an honest limitation or offer another existing method, never silently report success/empty data. No essential owner-only decision identified. Broader stabilization remains incomplete.

Plan attack: independent regret/buildability checks completed; rulings are below.

## Adjudicated attack and repair order

Independent REGRET and BUILDABILITY reviews completed 2026-09-27. FIX: explicitly verify route applicability; include Data-created manual_css → Showcase replay, Data manual rerun and existing automatic extraction as shared-runner consumers. FIX: distinguish saved strategy from durable dataset output. Initial save-to-dataset and later explicit append/persist must be verified via reopened actual values, including partial write failure; no automatic append or duplicate new dataset on mere preview rerun. Reuse existing dataset primitives; add an explicit output action only if no existing path fulfills this. FIX: live-mode/backend-schedule capability copy must match actual executable mode support, particularly Network. No owner-only decisions or new schema contract required.

Next repair order: Astra owns the sole guarded D41 Network identity sequence. D44 source-peer corrections and compile follow when the guard is free; D45 transaction regression and D42 installed session proof remain open, followed by D46 dotted-key selection coverage. D39 is closed. Keep one defect per commit and validate new source with the installed extension on real sites.

Historical environment note: .97/.100 captures and the initial D39 manual discovery are superseded by the verified .108 receipt and installed .108 run above. They remain historical reproduction evidence only. No localhost or test-server UI run is an acceptable Showcase acceptance path; the owner ruling above governs all new live verification.
