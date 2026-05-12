---
name: connect-local
description: Use when the matrx-extend Chrome extension needs to invoke a system-level capability that only the matrx-local Tauri desktop engine can provide — running a shell command, accessing the filesystem outside the browser sandbox, or receiving a server-pushed event over the engine's WebSocket. Scope guardrail: this skill is for OUTBOUND extension-to-desktop work; do NOT use it for changes that live inside the matrx-local repo itself (those go through matrx-local's own connect-matrx-extend skill).
---

# connect-local — outbound calls into the Matrx Local desktop engine

The matrx-local desktop app exposes a small HTTP control surface for the
extension at `/extension/rpc`, plus a WebSocket for reverse-push events.
This skill is the entry point when you're working in this repo and need
to drive the desktop engine from extension code.

**Status reality check:** Channel B is partially verified.
`desktop_run_command` exists in
`src/lib/tools/handlers/privileged.ts:212-226` but has zero callsites.
Port discovery is now wired: `src/lib/desktop/discovery.ts` probes
22140–22159 in parallel via the engine's public `GET /health` and
caches the winner in `chrome.storage.local` (30 min TTL); the build-time
`ENV.DESKTOP_LOCAL_URL` is the last-resort fallback. `POST /extension/rpc`
is reserved for authenticated calls — every probe must keep using the
auth-free `/health` path, otherwise each cache-miss alarm tick fires a
"missing bearer token" warning in the engine log.

## When to use

- Wiring a new privileged tool that needs to shell out, read a local
  file, or run a desktop-only operation.
- Plumbing port discovery (probe-and-cache against `~/.matrx/local.json`).
- Subscribing the extension to an engine-pushed event (e.g. progress for
  a long-running command) over the WebSocket.
- Extending the `desktop_run_command` envelope shape.

## When NOT to use

- Changes to the matrx-local Python or Rust source. Switch to that repo
  and use its `connect-matrx-extend` skill.
- Anything that should run inside the browser sandbox (page DOM, tabs,
  cookies, screenshots). Those are extension-only — see the existing
  `src/lib/tools/handlers/` files.

## 30-second mental model

```
extension src/lib/desktop/http.ts
   │  POST http://127.0.0.1:<port>/extension/rpc
   │  body: { method, params, requestId }
   ▼
matrx-local app/api/extension_routes.py
   │  (today: only "health" is wired)
   │  (target: hand off to)
   ▼
app/tools/dispatcher.py::dispatch
   │
   ├─→ result returned over HTTP response
   │
   └─→ progress pushed over WebSocket
        app/websocket_manager.py::broadcast / broadcast_notification

port = read ~/.matrx/local.json (engine writes on startup, 22140–22159 scan)
```

## Quick start

When you need to call a desktop method from extension code (current
state, before the discovery fix):

```ts
// pseudocode — current state hardcodes port; replace with probe-and-cache
import { desktopRpc } from "@/lib/desktop/http";

const result = await desktopRpc({
  method: "run_command",
  params: { argv: ["pnpm", "build"], cwd: "/path/to/project" },
});
```

Discovery in place today (see `src/lib/desktop/discovery.ts`):

1. SW cannot read `~/.matrx/local.json` directly, so the chosen port is
   discovered by parallel `GET /health` probes across 22140–22159
   (`DesktopHealthSchema` validates that the listener actually
   identifies itself as `service: "matrx-local"`).
2. Winner is cached in `chrome.storage.local` for 30 min; cache is
   invalidated on any subsequent `/health` or RPC failure so the next
   call re-discovers.
3. **Never use `POST /extension/rpc` for unauthenticated probing.**
   That endpoint is auth-walled by `AuthMiddleware` and rejects with
   401 — both a useless probe response *and* a warning per tick in the
   engine log. Health checks stay on `GET /health` (public).
4. Surface "desktop bridge offline" loudly — privileged tools that
   need it should fail with a clear message, not hang.

## File index (extension side)

| File | Role |
|---|---|
| `src/lib/desktop/discovery.ts` | Port discovery — `getEngineBaseUrl()`, parallel `GET /health` probe across 22140–22159, 30-min cache |
| `src/lib/desktop/http.ts` | HTTP client; calls `getEngineBaseUrl()` for every `probeHttp` / `rpcHttp` |
| `src/lib/desktop/ws-client.ts` | WS reverse-channel client; resolves base URL the same way |
| `src/lib/desktop/types.ts` | RPC envelope and `DesktopHealthSchema` (the probe fingerprint) |
| `src/lib/tools/handlers/privileged.ts` | `desktop_run_command` lives here (lines 212–226) |
| `src/config/env.ts` | `ENV.DESKTOP_LOCAL_URL` — last-resort fallback when discovery fails |

## Engine-side reference (read-only from this repo)

- `app/api/extension_routes.py` — the `/extension/rpc` route. Today
  only `{method: "health"}` round-trips; everything else returns 400.
- `app/tools/dispatcher.py::dispatch` — the eventual handoff target;
  wired but not yet routed from `/extension/rpc` for non-health methods.
- `app/websocket_manager.py` — `broadcast()` and
  `broadcast_notification()` for reverse-push. The extension does not
  yet subscribe to this WS; doing so is part of the channel buildout.

## Failure modes

- **Loud: HTTP 502 / connection refused.** Discovery couldn't find any
  listener on 22140–22159 and the build-time fallback URL doesn't
  match either. Engine is offline, or it bound a port outside the
  scan range — check `~/.matrx/local.json`. The probe is cheap (one
  parallel fan-out per 30-min TTL), so the next alarm tick auto-recovers
  once the engine is back.
- **Spurious warning: `[auth] rejected POST /extension/rpc — missing
  bearer token`** in the engine log on every alarm tick. Means
  something is probing `/extension/rpc` without a token — the probe in
  `discovery.ts` should be on `GET /health`, not `POST /extension/rpc`.
  Anything that wants to call `/extension/rpc` must go through
  `rpcHttp` which attaches the bearer.
- **Silent: method returns 400 with `unsupported method`.** The route
  in `app/api/extension_routes.py` only knows about `health`. Adding a
  new method requires a server-side change (sibling repo).
- **Silent: WebSocket events ignored.** No subscriber on the extension
  side yet. Building the subscriber is its own track of work.
- **Cross-machine pitfall:** the extension and the engine may be on
  different machines (e.g. extension on a remote desktop). Hardcoding
  `127.0.0.1` makes that case fail silently. Future work: a routing
  flag the user confirms; out of scope today.

## Pointer

For the full topology, the FORBIDDEN domain list (de-spaced forms of
`m a t r x . a p p` and `m a t r i x . c o m` — never reference either),
and the parallel channels (A and C), see
[`docs/CROSS_REPO_INTEGRATION.md`](../../../docs/CROSS_REPO_INTEGRATION.md).
