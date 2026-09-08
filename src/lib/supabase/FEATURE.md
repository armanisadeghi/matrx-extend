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

## Change log

- 2026-08-17 — Aligned the agent-list validator with the canonical RPC and
  replaced the hardcoded default-Agent fallback with
  `chat.default_new_chat`.
- 2026-08-20 — Scoped the extension default to `extend.browser_chat`, whose
  system seed is the system-owned Matrx Browser Agent.
- 2026-09-08 — Agent-list reads left this module entirely for
  `@ai-matrx/agents/catalog` (THE ONE AGENT PICKER, ruling D1).
