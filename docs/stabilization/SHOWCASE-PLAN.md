# Showcase — current priority

Owner request 2026-09-27: use Showcase and make repeating-pattern discovery, extraction by its supported methods, saving, remembering and repeat extraction fully functional. This supersedes Screenshot sequencing as the immediate priority; it does not discard broader inventory or Chat/Pilot deferral.

## Target and existing capability

Authoritative coverage: inventory EXT-F-1012, currently 38 controls/cases. Preserve stable IDs; extend missing preview/save/reopen/replay cases per method before testing them. Existing UI: Doctor, Recipes, Prepare, Snapshot, JSON-LD, Microdata, Tables, Framework, AI Extract, List Pattern, Network, Patterns. Shared extraction/data-pattern primitives remain canonical. Guest/member/admin applicability stays tracked. A disallowed mode passes only its actual denial behavior; it is not an extraction pass.

Owner-seat observation: primary Chrome already has Showcase Doctor open on https://electronic.vegas/vegas-edm-event-calendar/. Visible Doctor reports249 event cards and249 Event microdata items; public calendar has readable event names/dates/venues. Build identity is not yet verified, so this is orientation evidence, not a development acceptance pass. This page is a real-data acceptance target alongside a structurally different public page and controlled regression pages.

Primary reference: Apify's explicit reusable input/run/structured-output contract (https://docs.apify.com/actors). Apply the principle to saved pattern configuration and replay, without adding an unrelated platform or product redesign.

## Scope and verification

1. Map all existing extraction methods to their live controls, exact serialized configuration, executor, persistence door and inventory cases. Audit gaps are findings, not passes.
2. Prove first broken user path quickly: capture a red reproduction, fix the common cause, peer review, rebuild/reload and retest. Avoid new harness frameworks; reuse existing native harness/driver or the current real Chrome UI under the manual browser resource permit.
3. Complete the vertical workflow: detect → select list/fields or structured method → preview real rows → save the exact executed configuration → leave/reload → reopen saved pattern → rerun with matching fields and accurate values. Then test changed data, tab/navigation switching, empty/unsupported/error/cancel outcomes.
4. Cover all nine saved pattern kinds and every Showcase control, including rename/delete and result copy/export. AI and network methods require their genuine backend/network execution, not fixture-only success. Test mutations use explicitly named owned test patterns and retain exact identities for cleanup; never delete unrelated patterns.
5. A defect closes only after original reproduction and surrounding cases pass with a fresh independent verifier. Unit tests are diagnosis/regression evidence, not UI proof. No whole-feature health claim until each applicable inventory cell resolves.

## Initial findings and sequencing

Source findings awaiting red reproduction: Network display filter can be persisted as URL filter; preview and saved settings may drift after edits; route scoping/replay outcome may not reflect saved route; discovery/listpicker audit pending. Details and evidence live in reports/showcase-save-replay-audit.json and reports/showcase-detect-audit.json. Fix confirmed defects one per commit under standard defect schema, preserving all concurrent work.

First repair wave is limited to proven discovery/save/replay bugs. No new DB/table contract, access-policy change or broad feature migration is planned. Any required dependency update follows existing shared-package contract. Exact scopes and file ownership are assigned after independent plan review.

## Environment, delegation and gates

Shared main pulled to4d52ac3a (.99 + package updates); no branches/worktrees. Sync installed dependencies under the existing guard before development build. Current old .97/.96 artifacts cannot prove .99 behavior. Verify channel, extensionID and dev receipt; reload extension, sidepanel and page content components as required in each test record.

One heavy build/test/browser permit maximum; preflight and watchdog refuse unsafe resource use. Two source-only workers may audit disjoint paths, but no second heavy launch. Root currently holds pending manual-browser guard session55412 for existing primary Chrome; no UI action test until admission. Never lower thresholds or kill foreign processes.

Luna medium: narrow execution. Sol medium: product fixes and moderate diagnosis. Two failed attempts or repeated regression cause decomposition/fresh escalation; no speculative wait patches. Fresh peer validates before root integration. Structured reports contain status, changes, exact verification, files, unresolved items. No secrets in artifacts. Reserved d22-source-save-attempt.json remains untouchable.

## Decisions and open questions

The user already authorized autonomous execution and this repair scope; no repeated approval checkpoint is needed. Site-specific unsupported capabilities must show an honest limitation or offer another existing method, never silently report success/empty data. No essential owner-only decision identified. Broader stabilization remains incomplete.

Plan attack: pending independent regret/buildability checks; address findings before first implementation.

## Adjudicated attack and repair order

Independent REGRET and BUILDABILITY reviews completed 2026-09-27. FIX: explicitly verify route applicability; include Data-created manual_css → Showcase replay, Data manual rerun and existing automatic extraction as shared-runner consumers. FIX: distinguish saved strategy from durable dataset output. Initial save-to-dataset and later explicit append/persist must be verified via reopened actual values, including partial write failure; no automatic append or duplicate new dataset on mere preview rerun. Reuse existing dataset primitives; add an explicit output action only if no existing path fulfills this. FIX: live-mode/backend-schedule capability copy must match actual executable mode support, particularly Network. No owner-only decisions or new schema contract required.

First wave: EXT-D-0039 Doctor recommendation handoff (actual .97 UI reproduction and matching source audit), then preview/config integrity and network saved-request matching. Missing-root and route-scoped execution are next core safety/correctness repairs. One defect per commit; first verified product repair before further process expansion.

Environment update: primary Chrome is verified unpacked .97 from repository .output/chrome-mv3-dev, ID cihdmkcdjjckfhjpgoedmgfpoljebaml, admin account already signed in. Resource-admitted manual discovery001 reproduced D39; permit terminated cleanly before builds/tests. Build .99 source and explicitly reload before accepting a fix. Existing .97 evidence is baseline only.
