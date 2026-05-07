---
name: connect-local
description: Use when the matrx-extend Chrome extension needs to invoke a system-level capability that only the matrx-local Tauri desktop engine can provide — running a shell command, accessing the filesystem outside the browser sandbox, or receiving a server-pushed event over the engine's WebSocket. Scope guardrail: this skill is for OUTBOUND extension-to-desktop work; do NOT use it for changes that live inside the matrx-local repo itself (those go through matrx-local's own connect-matrx-extend skill).
---

# connect-local — outbound calls into the Matrx Local desktop engine

The matrx-local desktop app exposes a small HTTP control surface for the
extension at `/extension/rpc`, plus a WebSocket for reverse-push events.
This skill is the entry point when you're working in this repo and need
to drive the desktop engine from extension code.

**Status reality check:** Channel B is currently 0% verified.
`desktop_run_command` exists in
`src/lib/tools/handlers/privileged.ts:212-226` but has zero callsites.
The HTTP client hardcodes port 22180 in `src/lib/desktop/http.ts` while
the engine actually listens on the first free port in 22140–22159 and
writes that port to `~/.matrx/local.json`. Until the port discovery
fix lands, only `/extension/rpc {method: "health"}` round-trips.

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

The target shape after the port discovery fix:

1. Read `~/.matrx/local.json` to get the active port. Cache the value
   in `chrome.storage.session` for the lifetime of the SW.
2. On HTTP failure, invalidate the cache and probe 22140–22159 for the
   one that returns `health: ok`.
3. Surface "desktop bridge offline" loudly — privileged tools that
   need it should fail with a clear message, not hang.

## File index (extension side)

| File | Role |
|---|---|
| `src/lib/desktop/http.ts` | HTTP client; **currently hardcodes 22180 — bug** |
| `src/lib/desktop/types.ts` | RPC envelope and method shapes |
| `src/lib/tools/handlers/privileged.ts` | `desktop_run_command` lives here (lines 212–226) |
| `src/config/env.ts` | `ENV.DESKTOP_LOCAL_URL` (currently the source of the wrong port) |

## Engine-side reference (read-only from this repo)

- `app/api/extension_routes.py` — the `/extension/rpc` route. Today
  only `{method: "health"}` round-trips; everything else returns 400.
- `app/tools/dispatcher.py::dispatch` — the eventual handoff target;
  wired but not yet routed from `/extension/rpc` for non-health methods.
- `app/websocket_manager.py` — `broadcast()` and
  `broadcast_notification()` for reverse-push. The extension does not
  yet subscribe to this WS; doing so is part of the channel buildout.

## Failure modes

- **Loud: HTTP 502 / connection refused.** The hardcoded port (22180)
  is wrong. The engine is on a port in 22140–22159. Fix is the
  probe-and-cache work; until that lands, the channel is non-functional
  on any machine where the engine didn't grab 22180.
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
