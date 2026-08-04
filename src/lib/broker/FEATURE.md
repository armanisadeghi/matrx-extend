# Token broker client — scoped short-lived credentials

> Cross-repo system-of-record: `/Users/armanisadeghi/code/common-docs/token-broker/FEATURE.md`.
> Server owner: `aidream/services/token_broker/` (its FEATURE.md is the wire contract).
> Repo skill for consumers: [.claude/skills/token-broker-client/SKILL.md](../../../.claude/skills/token-broker-client/SKILL.md).

Built 2026-07-12. This module is THE primitive for any capability that needs
temporary privileged reach (provider realtime sessions, direct provider calls).
It is use-case-agnostic: a new server-side audience needs ZERO changes here.

## Files

- [types.ts](./types.ts) — `BrokeredCredential` envelope + Zod schemas, mirrors
  aidream's `token_broker/models.py` exactly. One envelope for every audience.
- [mint.ts](./mint.ts) — the ONLY code that calls `POST /broker/tokens`
  (bare path per this repo's convention; the server's ApiPrefixCompat
  middleware accepts both `/broker/…` and `/api/broker/…`).
- [cache.ts](./cache.ts) — in-memory cache keyed `(audience, tier_policy, model)`,
  refresh-ahead at <20% TTL remaining, single-flight, invalidate-on-401.
- [transport.ts](./transport.ts) — mode dispatch: `brokeredFetch` (proxied →
  gateway with Bearer grant, SSE-capable) and `nativeConnectionInfo`
  (native_ephemeral → endpoint/token/protocol for realtime consumers).
- [index.ts](./index.ts) — public API. Context-aware: in the SW it hits the
  cache directly; in sidepanel/offscreen it transparently routes through the
  SW via `CHANNELS.BROKER_*`, so ALL contexts share the one SW cache.
- [sw-host.ts](./sw-host.ts) — SW message handlers, registered in
  `bootstrapBackground()` (§1a); cache cleared when USER_PROFILE clears.

## How to consume (the whole API)

```ts
import { getBrokeredCredential, callProxiedJson, brokeredFetch, nativeConnectionInfo } from '@/lib/broker';

// Any context. tier_policy is REQUIRED — never default it anywhere.
const cred = await getBrokeredCredential('openai_realtime', 'none', { model: 'gpt-realtime' });
if (cred.ok) connectRealtime(nativeConnectionInfo(cred.data)); // token in memory only

// One-shot proxied JSON (runs in the SW; token never leaves it):
const res = await callProxiedJson({ audience: 'anthropic', tierPolicy: 'none',
  model: 'claude-haiku-4-5-20251001', body: { model: '…', max_tokens: 64, messages: […] } });

// Streaming proxied (SSE): mint + brokeredFetch in the context that owns the stream.
```

## Invariants (violations are defects)

- **`tier_policy` explicit everywhere.** No default at any layer — request
  model, primitive signature, hook, UI.
- **Tokens are memory-only.** Never chrome.storage / localStorage / DB / logs.
  Snapshots for UI are token-free (`tokenTail` = last 6 chars).
- **`endpoint` is data.** Never hardcode a gateway or provider URL client-side.
- **Failure policy:** 503 = broker unconfigured → loud, no retry, no fallback
  auth path. 401 from a credential's endpoint → invalidate + ONE re-mint,
  then fail loudly. 422 = programming error (unknown audience / bad request).
- **New audience needed?** STOP here; grow the server first via the global
  `token-broker` skill (one minter + registry line in aidream), then consume
  through this unchanged primitive.

## Demo / verification

Admin sidepanel tab **Broker** (KeyRound icon, cyan) —
[src/features/broker/BrokerView.tsx](../../features/broker/BrokerView.tsx), a
thin layer over the primitive. Steps in `docs/feature-tests.md` →
"Token broker — demo surface". Unit tests:
[tests/unit/broker-cache.test.ts](../../../tests/unit/broker-cache.test.ts).

## Known follow-ups

- First real consumers: voice/realtime session via `openai_realtime`;
  any direct-Anthropic feature via the proxied gateway.
- Offscreen streaming consumer helper (SSE through `brokeredFetch`) when the
  first streaming use case lands.
