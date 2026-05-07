---
name: connect-frontend
description: Use when the matrx-extend Chrome extension needs to coordinate with the Next.js admin app at aimatrx.com — delivering a payload to a tab, opening a window-panels overlay via deep-link, or relaying a message across machines through Supabase Broadcast. Scope guardrail: this skill is for OUTBOUND extension-to-frontend work; do NOT use it for changes that live inside the matrx-frontend repo itself (those go through matrx-frontend's own connect-matrx-extend skill).
---

# connect-frontend — outbound calls into the aimatrx.com admin app

The matrx-frontend Next.js 16 app at aimatrx.com is the third leg of the
Matrx client triangle. Channel C between this extension and the frontend
is **0% built today, with traps**. This skill exists so future work
starts from the correct primitives and avoids the dead scaffolding
already in the repos.

## When to use

- Sending a message from the extension into a specific aimatrx.com tab.
- Triggering a window-panels overlay on aimatrx.com from the extension
  (e.g. open a chat overlay focused on a conversation).
- Relaying state between an extension on machine A and the user's
  aimatrx.com session on machine B (cross-machine).
- Wiring a page-side WebMCP dispatcher so registered tools on
  aimatrx.com can be invoked from the agent.

## When NOT to use

- Changes to the matrx-frontend source. Switch to that repo and use
  its `connect-matrx-extend` skill.
- Trying to make the extension "control" aimatrx.com via DOM injection.
  That works for arbitrary sites but a first-party app should use the
  proper bridge primitives below.
- Confusing this with the chat-side `matrx-extend-tool-display` skill;
  those are unrelated.

## 30-second mental model

```
SAME MACHINE                         CROSS MACHINE
─────────────                        ─────────────
aimatrx.com page                     aimatrx.com on machine B
  │ chrome.runtime.sendMessage(        │
  │   extId, payload)                  │ supabase.broadcast.send(
  ▼                                    │   "matrx-extension-bridge:<userId>",
extension SW receives                  │   { direction, action,
  (gated by manifest's                 │     requestId, payload, timestamp })
   externally_connectable              ▼
   whitelist)                       extension SW subscribes to the
                                    same channel and relays into
                                    chat / tools as needed
```

Plus the deep-link shape that triggers a window-panels overlay
without any messaging at all:

```
https://aimatrx.com/<route>?panels=<typeKey>:<instanceId>
```

The frontend's window-panels parser opens that overlay on page load.

## Quick start

**Same-machine call from the extension to a tab:**

```ts
// pseudocode — depends on externally_connectable manifest entry
chrome.tabs.sendMessage(tabId, {
  direction: "extension->page",
  action: "open_panel",
  requestId: crypto.randomUUID(),
  payload: { typeKey: "chat", instanceId: "abc-123" },
  timestamp: Date.now(),
});
```

**Cross-machine relay via Supabase Broadcast:**

```ts
// pseudocode — uses the shared Supabase project txzxabzwovsujtloxrus
const channel = supabase.channel(`matrx-extension-bridge:${userId}`);
await channel.subscribe();
await channel.send({
  type: "broadcast",
  event: "message",
  payload: {
    direction: "extension->frontend",
    action: "open_panel",
    requestId: crypto.randomUUID(),
    payload: { typeKey: "chat", instanceId: "abc-123" },
    timestamp: Date.now(),
  },
});
```

**Open an overlay without messaging at all:**

```ts
chrome.tabs.create({
  url: "https://aimatrx.com/?panels=chat:abc-123",
});
```

## `externally_connectable` whitelist

Manifest v3 does not accept port wildcards. The exact whitelist for
this extension is (memorize, do not improvise):

- `https://*-armani-sadeghis-projects.vercel.app/*`
- `https://*.aimatrx.com/*`
- `https://*.mymatrx.com/*`
- `http://localhost/*`
- `http://127.0.0.1/*`

Any other origin attempting `chrome.runtime.sendMessage(extId, ...)`
will silently fail. Adding a new origin = manifest change + reload.

## File index (extension side)

| File | Role |
|---|---|
| `src/lib/webmcp/register.ts` | WebMCP scaffolding — `registerToolsOnActiveTab()` is built but unused; no page-side dispatcher exists yet |
| (manifest) | `externally_connectable` block needs to be added; not present today |

## Frontend-side reference (read-only from this repo)

- `lib/supabase/messaging.ts` — production-ready Broadcast bridge on
  the frontend; channel name and payload shape match the snippet above.
- The window-panels deep-link parser — handles
  `?panels=<typeKey>:<instanceId>`; stable contract.

There is **no conversation-message-append API** on the frontend today.
Do not assume one exists. If your task needs the agent to drop a
message into a frontend conversation, that's a frontend feature
request, not an extension one.

## Failure modes

- **Silent: page never receives the message.** The page origin is not
  on the `externally_connectable` whitelist. There is no error;
  `sendMessage` resolves to `undefined` and the page sees nothing.
- **Silent: cross-machine Broadcast never fires.** Both clients must
  subscribe to the **same channel name**
  (`matrx-extension-bridge:<userId>` — note the colon) before sending.
  Supabase Broadcast does not retain messages.
- **Loud: deep-link 404.** The route exists but `?panels=` is malformed.
  The parser expects `<typeKey>:<instanceId>`; both halves required.
- **Trap: existing fake-bridge scaffolding.** Both repos contain
  partial bridge code that was never finished. Do not copy from it
  blindly — verify against this skill's primitives and the file index.

## Pointer

For the full topology, the FORBIDDEN domain list (de-spaced forms of
`m a t r x . a p p` and `m a t r i x . c o m` — never reference either),
the production URL map, and the parallel channels (A and B), see
[`docs/CROSS_REPO_INTEGRATION.md`](../../../docs/CROSS_REPO_INTEGRATION.md).
