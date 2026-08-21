# Direct Supabase read contracts

`queries.ts` owns the extension's RLS-gated row validation. A live RPC shape
must be mirrored from the canonical database/generated frontend types; a
required retired field causes every valid row to be dropped and is a runtime
defect even when TypeScript compiles.

## Agent list

`AgxAgentSchema` mirrors `agx_get_list_full()`: ownership is `created_by`;
`user_id` and `project_id` are retired. Per-row validation remains
fault-tolerant, but a schema mismatch is logged and tested with a live-shaped
fixture.

The locally synthesized **Matrx Browser Agent** entry is a Mandate-backed UI
choice, not an Agent row. Its `mandate_key` routes execution through aidream;
its `mandate:*` id never reaches an Agent-id endpoint.

## Change log

- 2026-08-17 — Aligned the agent-list validator with the canonical RPC and
  replaced the hardcoded default-Agent fallback with
  `chat.default_new_chat`.
- 2026-08-20 — Scoped the extension default to `extend.browser_chat`, whose
  system seed is the system-owned Matrx Browser Agent.
