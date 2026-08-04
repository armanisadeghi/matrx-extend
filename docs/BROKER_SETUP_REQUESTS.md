# Token broker — what we need set up for the extension to work (and keep working)

> Written 2026-07-12, alongside shipping the client primitive
> ([src/lib/broker/FEATURE.md](../src/lib/broker/FEATURE.md)). This is the
> ask-list for the server/ops side, ordered by blocking-ness, plus the
> permission/auth bug history that shaped the client's failure policy.

## Verified live (2026-07-12)

`POST https://server.app.matrxserver.com/api/broker/tokens` is DEPLOYED on
prod — an unauthenticated probe returns the broker's own
"Brokered credentials require an authenticated user" 401 envelope (not a 404,
not a 503). So the router + auth middleware are live. What a probe canNOT
verify is the per-host env config below — that needs one authenticated mint
per host (the admin Broker tab does exactly this in ~10 seconds).

## The asks

### P0 — blocks every mint on a host
1. **`BROKER_TOKEN_SIGNING_KEY`** (EC P-256 PEM) set on **every** aidream
   host (prod / staging / dev). It's in aidream's `REQUIRED_ENV`; a host
   missing it 503s every broker route. Verify per host: Broker tab →
   Mint `anthropic` / `none` → green card (or 503 card naming the host).
2. **`public_url`** configured per host — the anthropic (proxied) minter
   refuses to mint without it (503) because the credential's `endpoint` is
   built from it. Must be the PUBLIC url incl. the `/api` prefix behavior
   that host actually serves.

### P0 — blocks specific audiences
3. **`ANTHROPIC_API_KEY`** present (gateway relay 503s without it).
4. **`OPENAI_API_KEY`** present (openai_realtime native minter).

### P1 — needed as we scale to "hundreds of things" over the coming weeks
5. **Broker endpoints in the OpenAPI schema.** `types/python-generated/openapi.json`
   has no `/broker/*` paths today, so `pnpm update-api-types` can't generate
   the envelope types — the extension hand-mirrors them in
   `src/lib/broker/types.ts` (Zod-validated, so drift fails loudly, but
   generated types are the durable fix). Ask: ensure the broker router is
   included in the exported OpenAPI app.
6. **New audiences server-first.** Every upcoming provider/feature = one
   minter + one registry line in aidream (global `token-broker` skill). The
   extension needs ZERO changes per audience — please never ship a client
   workaround key.
7. **Guest policy decision.** Guests cannot mint in v1 (verified above). If
   any guest-facing surface will need brokered reach, that's a deliberate
   server decision (forced `tier_policy="guest"`), not a client change.
8. **Quota / metering follow-ups** already tracked in aidream's FEATURE.md
   (cost-spine metering for proxied relays, budget gates on grants). Flag
   before wide rollout — proxied Anthropic calls are currently audited but
   unmetered.

## Permission/auth bug history that shaped the client design

Recent incidents (git + docs/AUDIT_2026_06_10.md) and how the broker client
responds to each class:

- **Refresh-token races → spurious sign-outs (P1-1, fixed `a6eb844`).** The
  broker mint rides the shared `apiPost` path, which now single-flights
  refresh under one mutex — no new token-refresh code paths were added.
- **Hung connections (P1-2).** Mint inherits the 30s request deadline.
- **401 handling that nobody reacted to (P2-23).** The primitive has an
  explicit two-level policy: Supabase-401 on mint → client.ts refresh+retry;
  grant-401 at a credential's endpoint → invalidate + ONE re-mint, then loud
  failure. Never a retry loop, never a silent fallback.
- **Token leakage patterns (P1-5 desktop bridge; audit "backend override
  URL unvalidated").** Brokered tokens are memory-only, never persisted or
  logged, UI sees 6-char tails, and the proxied round-trip runs in the SW.
  The credential's `endpoint` comes from the server envelope — the client
  never constructs privileged URLs. NOTE (still-open audit item, applies to
  the mint call too): `getBackendUrl()` override validation exists at write
  time only; the audit recommends validating at read time — worth fixing
  repo-wide, tracked in docs/AUDIT_2026_06_10.md.
- **Chrome-permission UX cluster (mic/getUserMedia, `44d0b4a`/`46acf48`/
  `637e24f`).** Not applicable: the broker needs NO new Chrome permissions —
  plain `fetch` from contexts we already own. Nothing new lands in the
  install dialog or the CWS review surface.
