# AI Matrx frontend bridge

The frontend bridge has two transports with one action handler:

- Same machine: allowlisted pages call the extension via
  `chrome.runtime.sendMessage(extensionId, FRONTEND_RPC envelope)`.
  `wxt.config.ts` provides the platform allowlist and `bootstrap.ts` repeats
  the runtime origin check.
- Cross machine: extension and frontend exchange direction-tagged envelopes
  on Supabase Broadcast topic `matrx-extension-bridge:<userId>`, event
  `FRONTEND_RPC`.

`handler.ts` owns `ping`, `capabilities`, `openPanel`, and `callTool`.
`callTool` always passes through the normal permission-gated dispatcher;
capabilities never advertise privileged or ask-user tools. `broadcast.ts`
only adapts direction/correlation and must not fork action behavior.

Requests and replies preserve `requestId`, including send failure, timeout,
and disconnect paths. The event string is contractual and byte-matches
matrx-frontend's `BRIDGE_BROADCAST_EVENT`.

Do not describe a per-user topic name as authorization by itself. Supabase
Realtime authorization requires `private: true` on both clients and explicit
`realtime.messages` RLS policies. Functional tests must cover direct and
Broadcast ping/capabilities/tool calls against the production demo at
`https://demos.aimatrx.com/demos/tests/extension-bridge`.

