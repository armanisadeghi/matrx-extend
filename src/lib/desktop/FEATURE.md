# Matrx Local desktop bridge

The extension reaches matrx-local through one command client (`http.ts`) and
one reverse channel (`ws-client.ts` + the offscreen document). Both resolve the
same engine base URL and the same engine-issued pairing token.

## Discovery order

`getEngineBaseUrl()` resolves in this order:

1. Explicit live-port override for development diagnostics.
2. Cached local live-port discovery.
3. A single `GET /health` to the last port that ever answered. Never rate
   limited, so an engine restarting on its usual port is found within one
   alarm tick.
4. Parallel `GET /health` probes across `127.0.0.1:22140-22159`.
5. The signed-in user's freshest active `app_instances.tunnel_url` row,
   selected directly from Supabase under owner-only RLS.

Nothing else. There is no build-time fallback address: it was always set, so
discovery could never return `null` and an offline engine was handed back as
a real URL — which made every graceful-degradation path below it dead code
and left the WS runtime retrying a port nothing listens on.

Local presence wins. Remote tunnel URLs are HTTPS-only, credentials in URLs
are rejected, and the in-memory remote cache lasts 30 seconds so a changing
Cloudflare quick-tunnel heals promptly without querying Supabase on every RPC.
Any transport failure invalidates discovery caches.

### The cost of a miss

Steps 4 and 5 are rate limited (30s, then 1min, 5min, 15min after
consecutive misses). The 30-second probe alarm used to re-run the whole
sweep on every tick for anyone without the desktop app: twenty refused
connections plus a Supabase round-trip, every thirty seconds, for the life
of the browser. Chrome prints every refused connection to the console
whether or not the fetch is caught, so a perfectly normal "no desktop app"
state read as a wall of errors. `resetEngineDiscoveryBackoff()` clears the
limit and is for explicit human actions only — never for a background poll.

### Reconnecting the reverse channel

The offscreen socket re-resolves its URL through the service worker
(`WS_RESOLVE_URL`) before every retry, because the port and the pair token
both live behind `chrome.storage`, which an offscreen document cannot read.
Retries stop after the backoff ladder is spent; the 30-second desktop probe
reopens the socket whenever the engine is reachable and the socket is not.

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

## Private owned-browser retries

The background controller binds admission and cleanup retries to both the original
operation JTI and exact grant bytes. Only identical retries join or replay. Cleanup
acknowledgements recheck the original deadline, registration and receipt-map identity
after the private request completes, including saved-receipt and concurrent callers.
Discovery applies the same deadline fence before returning acceptance.

## Verification floor

Run `tests/unit/desktop-discovery.test.ts`, `tests/unit/ws-invoke.test.ts`, the
full Vitest suite, TypeScript compile, `pnpm zip`, and a clean-profile packaged
test. The installed engine must show each profile as a separate session, and
an engine-driven `read_page` must return from each selected profile.


## Matrx 2 (the new desktop app)

Matrx 2 is a separate channel in `matrx2/`, beside Matrx Local; the two apps can run on the same
computer. Matrx 2 answers only `GET /v1/health` (`service: "matrx-desktop"`, ports 22140-22159,
or 22240-22259 for a development copy), never Matrx Local's `/health`.

- Pairing: `POST /v1/pair` from this extension's origin returns the pairing token. It is asked
  for before every dial, so a code reset in Matrx 2 heals without a step here.
- The socket lives in the service worker (Chrome 116+ keeps it alive while it carries traffic):
  subprotocols `matrx.v1` + `bearer.<pair token>`, hello as clientType `extension`, then
  `browser.register` with this profile's instance id, the browser and the person's access token.
  Matrx 2 drives this browser only when that account is the one Matrx 2 is signed in to.
- Each `browser.invoke` runs through `handleWebmcpCall` with initiator `desktop` (action tools
  always ask the person; privileged tools are refused). While the person is asked,
  `browser.progress` (awaiting_confirmation) keeps Matrx 2 waiting; the answer is `browser.result`.
- Disconnect in Matrx 2 holds until the person presses Reconnect (Debug › Bridges) or the browser
  restarts; Browser connection turned off resumes by itself when it is on again.
- `desktop_run_command` runs a Matrx 2 operation (`fs.list`, `sysinfo.get`) when Matrx 2 is
  connected for the same account; other commands still go to Matrx Local.
- Contract: `@ai-matrx/desktop-protocol` cap `browser`. Tests: `tests/unit/matrx2-*.test.ts`.
