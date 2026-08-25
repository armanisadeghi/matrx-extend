# API client contract

`client.ts` is the single REST client. It resolves the backend URL, attaches a
signed-in bearer token or the stable guest fingerprint, applies a bounded
timeout, retries one refreshed 401, and returns `ApiResult` rather than throwing
for HTTP/network failures. Route modules under `routes/` own typed capability
contracts and validate server responses with Zod.

## Request organization assertion

Every agent start must include an explicit `organization_id`. The extension
does not invent that value and does not hardcode a system organization.
`routes/auth.ts#requireRequestOrganizationId` calls `GET /auth/whoami`
using the same bearer/fingerprint identity as the subsequent stream and returns
the organization already carried by that authenticated request. Aidream rejects
an authenticated `whoami` request that lacks it; neither side selects or creates
an organization.

A missing or malformed organization is a loud pre-stream failure. The chat UI
must end its pending state and show a retryable error; it must never send a
conversation against an arbitrary fallback organization.

The same assertion supplies direct note creates and every extension-owned
`extend.wbx_*` insert/upsert: capture, pattern, SEO audit, screenshot,
guidance, demo, and highlight. Each writer resolves the request organization
before constructing a Supabase client, includes that exact UUID in its
payload, and preserves its existing null/false error result when the assertion
fails. Parent-owned child writes do not use current request selection:
`chat.agent_task` loads the named conversation and copies that row's
organization into every insert.

## Change Log

- 2026-08-24 — Applied the request-organization assertion to all seven
  extension-owned `wbx_*` insert/upsert families, with zero-Supabase negative
  tests and exact-payload tests.
- 2026-08-23 — Replaced effective/personal organization bootstrap with the
  request-carried assertion and documented explicit note and conversation-task
  write provenance.

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
