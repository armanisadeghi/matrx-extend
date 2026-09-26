# Direct Supabase read contracts

`queries.ts` owns the extension's RLS-gated row validation. A live RPC shape
must be mirrored from the canonical database/generated frontend types; a
required retired field causes every valid row to be dropped and is a runtime
defect even when TypeScript compiles.

## Agent list — NOT HERE

The agent list is read by `@ai-matrx/agents/catalog` and nothing else, in every
Matrx client. `AgxAgentSchema`, `fetchAgentList`, `fetchUserAgents` and the
hardcoded "Matrx Browser Agent" default row were deleted from `queries.ts` on
2026-09-08; the package owns `agx_get_list_full`, `agx_search`, the row shape,
the ordering, the filters and the mandate-resolved default row (named after its
REAL Holder, so nothing here spells an agent name). Host wiring lives in
[../agents/catalog.ts](../agents/catalog.ts); the picker is
`AgentListDropdown` / `AgentListInlinePicker`. Guard: `pnpm check:canonical-pickers`.

## Every org-scoped write names its organization

A write that creates an org-scoped row sends the organization explicitly —
`organization_id` in a row, `p_organization_id` to a create RPC — resolved by
`requireActiveOrganizationId()` (`src/lib/org/active-org.ts`: this device's
choice or the sole membership; otherwise HELD on the picker). No database
default or trigger may choose it. Guard (red on any omission):
`tests/unit/org-scoped-writes-name-their-organization.test.ts`, whose RPC list
mirrors the live signatures of the create RPCs this extension calls.

## Change log

- 2026-08-17 — Aligned the agent-list validator with the canonical RPC and
  replaced the hardcoded default-Agent fallback with
  `chat.default_new_chat`.
- 2026-08-20 — Scoped the extension default to `extend.browser_chat`, whose
  system seed is the system-owned Matrx Browser Agent.
- 2026-09-08 — Agent-list reads left this module entirely for
  `@ai-matrx/agents/catalog` (THE ONE AGENT PICKER, ruling D1).
- 2026-09-26 — Creating a schedule from the extension always failed:
  `createTask` called `create_agent_task` without `p_organization_id`
  (`organization_required`). It now passes the resolved organization, the
  org-less three-insert fallback is deleted, and the Agenda form shows the
  failure with its remedy. The census found the same omission in
  `capture_study_set` (`edu_import_deck`) and the `users.user_form_profile`
  upsert (NOT NULL `organization_id`; an existing profile keeps its org, the
  first save names the active one — same contract as the web app). Class
  guard added (above).
