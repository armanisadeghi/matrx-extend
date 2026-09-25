# API client contract

`client.ts` is the single REST client. It resolves the backend URL, attaches a
signed-in bearer token or the stable guest fingerprint, applies a bounded
timeout, retries one refreshed 401, and returns `ApiResult` rather than throwing
for HTTP/network failures. Route modules under `routes/` own typed capability
contracts and validate server responses with Zod.

Private local-browser callbacks use `privatePost` and `routes/local-browser.ts`.
They bind the verified user, exact login session and selected organization,
refuse identity changes after waits, and never retry, log or reflect private
payloads. The entire request is bounded by its original deadline and five
seconds; replies require an actual no-store directive and a strict4KiB JSON
body. Acknowledgements must echo the submitted receipt exactly, except the
explicit cancellation directive, and only a created admission can carry a live
lease. `getPrivateExpectedActor` supplies a bounded, freshly verified identity
snapshot without exposing its bearer. These helpers establish no tab ownership.

## Request organization assertion

Every bearer-backed agent start must include an explicit `organization_id`.
Fingerprint guests omit it: aidream's AI funnel resolves only that guest's
personal organization before its first write, and a guest can never nominate
a tenant. The extension does not invent a value or hardcode a system organization.
`routes/auth.ts#organizationIdForAgentStart` uses the same bearer state as the
stream header path and calls `requireRequestOrganizationId` only for a bearer.
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
