# Matrx Local desktop bridge

The extension reaches matrx-local through one command client (`http.ts`) and
one reverse channel (`ws-client.ts` + the offscreen document). Both resolve the
same engine base URL and the same engine-issued pairing token.

## Discovery order

`getEngineBaseUrl()` resolves in this order:

1. Explicit live-port override for development diagnostics.
2. Cached local live-port discovery.
3. Parallel `GET /health` probes across `127.0.0.1:22140-22159`.
4. The signed-in user's freshest active `app_instances.tunnel_url` row,
   selected directly from Supabase under owner-only RLS.
5. The build-time localhost URL as a legacy last resort.

Local presence wins. Remote tunnel URLs are HTTPS-only, credentials in URLs
are rejected, and the in-memory remote cache lasts 30 seconds so a changing
Cloudflare quick-tunnel heals promptly without querying Supabase on every RPC.
Any transport failure invalidates discovery caches.

The service worker must restore its Supabase session before RLS-backed remote
discovery. A sign-in edge rehydrates, reconnects Broadcast, and re-probes the
desktop immediately; a sign-out edge disconnects Broadcast.

## Authentication and multi-profile behavior

Every Chrome profile stores its own `mxl_pair_…` token in
`chrome.storage.local`. Local profiles auto-pair through loopback-only
`POST /extension/pair`; a remote profile receives the code manually from the
desktop app. A 401 clears and re-pairs once on loopback. HTTP and WS both use
the same token, and the engine registers one independent WS session per Chrome
profile.

Never send the user's Supabase access token to a probed localhost port. Never
probe authenticated `/extension/*` routes; discovery uses public `/health`.

## Verification floor

Run `tests/unit/desktop-discovery.test.ts`, `tests/unit/ws-invoke.test.ts`, the
full Vitest suite, TypeScript compile, `pnpm zip`, and a clean-profile packaged
test. The installed engine must show each profile as a separate session, and
an engine-driven `read_page` must return from each selected profile.

