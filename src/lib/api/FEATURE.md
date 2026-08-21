# API client contract

`client.ts` is the single REST client. It resolves the backend URL, attaches a
signed-in bearer token or the stable guest fingerprint, applies a bounded
timeout, retries one refreshed 401, and returns `ApiResult` rather than throwing
for HTTP/network failures. Route modules under `routes/` own typed capability
contracts and validate server responses with Zod.

## Conversation organization bootstrap

Every agent start must include an explicit `organization_id`. The extension
does not invent that value and does not hardcode a system organization.
`routes/auth.ts#resolveConversationOrganizationId` calls `GET /auth/whoami`
using the same bearer/fingerprint identity as the subsequent stream and returns
the server-resolved effective organization. This is required for clean-install
guests, whose server-side personal organization is not visible through the
extension's anonymous Supabase session.

A missing or malformed organization is a loud pre-stream failure. The chat UI
must end its pending state and show a retryable error; it must never send a
conversation against an arbitrary fallback organization.

## Mandate-backed starts

`routes/ai.ts#mandateExecutePath` targets
`POST /v2/ai/mandates/{mandate_key}`. A Mandate-backed UI choice keeps a stable
`mandate:*` reference only for local selection and permission preferences; that
reference is never passed as an Agent id. The stream sends the Mandate key and
aidream resolves the Holder for the same bearer/fingerprint principal used by
the request.

Fresh Chat uses `extend.browser_chat`. Explicit user-selected Agents still
use `agentExecutePath`; a deliberate Agent choice is a run target, not a client
reimplementation of the platform default.
