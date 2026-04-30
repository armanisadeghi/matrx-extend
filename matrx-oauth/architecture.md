# Matrx OAuth — Architecture Decision Record

## Why we run our own OAuth provider in front of Supabase

### Naive option (rejected)

Each Matrx SPA could call Supabase Auth directly — exactly what `matrx-local`'s desktop client does. The client uses `${SUPABASE_URL}/auth/v1/oauth/authorize` and `/oauth/token`, runs its own PKCE handshake, gets a Supabase JWT, and uses it everywhere.

This works perfectly for matrx-local. We chose NOT to do it for the admin/studio SPAs for one reason: **the admin gate**. The dashboard and workflow-studio are admin tools; they should only let users with rows in `public.admins` in. If every SPA talked to Supabase directly, every SPA would have to:

1. Receive a token.
2. Call back to a Matrx API to ask "is this user an admin?".
3. Decide whether to accept the session.

That's three round-trips before the user sees anything. Worse, every SPA reimplements step 2, and every refactor risks one of them silently letting non-admins in.

### Chosen option: server-side admin gate

We put a thin OAuth server (`aidream/api/routers/auth.py`) in front of every admin SPA. The flow:

1. SPA sends the user to `GET /auth/aimatrx?app_redirect=<spa-callback>`.
2. Backend generates PKCE + state, then redirects to `aimatrx.com/api/oauth/authorize` (which is itself a thin proxy to Supabase).
3. Supabase login + consent.
4. Browser comes back to `/auth/callback` on **our** server (NOT directly to the SPA).
5. **Server** exchanges the code, decodes the JWT, runs the admin lookup against `public.admins`, and only then redirects the browser onward — to `<app_redirect>?access_token=...` if admin, to `/access-denied` otherwise.

The SPA never sees a token unless the user has already been admin-gated. This means:

- New admin SPAs are 1-route additions: copy the `/oauth/callback` pattern, point the login button at `/auth/aimatrx`, and they're done. They get the same admin gate for free.
- Non-admins land on a friendly `/access-denied?email=...` instead of being deep into a half-loaded admin UI when the gate fails.
- The admin lookup logic lives in exactly one place. Adding "must also be in beta program" later is a single edit, not N edits across N SPAs.

### Why `aimatrx.com` is in the middle

`aimatrx.com` is the Matrx product's main domain. The Next.js app at `projects/matrx-admin/` runs there and provides `/api/oauth/authorize`, `/api/oauth/token`, `/oauth/consent`, etc. All of these are thin proxies to Supabase.

We put aimatrx.com in the middle of the dance instead of having FastAPI talk to Supabase directly because:

- The user-visible OAuth URLs are stable Matrx URLs, not raw Supabase project URLs. If we ever migrate Supabase projects, we don't have to update every OAuth client we've registered.
- The consent UI (`/oauth/consent`) is branded.
- Non-Matrx OAuth clients (third parties, future integrations) can register against the Matrx OAuth provider just like the Matrx desktop and SPAs do.

For matrx-local desktop, the round-trip cost is high enough (custom URL scheme, OS-level deep-link handling) that we skip the aimatrx.com hop and talk to Supabase directly. Desktop users are owners of their own session, no admin gate needed; SPAs are admin tools, they need one.

## Why public PKCE, not confidential client

Confidential clients hold a `client_secret` and use it to authenticate to the token endpoint. They're meant for server-to-server flows where the secret can actually stay secret.

A SPA in a browser is not a confidential client — bundle splitting can't keep a secret secret. So we use the public PKCE flow, where the proof of possession is the `code_verifier` chosen at runtime. Supabase configures OAuth clients as either public or confidential at registration time; ours are public.

The desktop client (matrx-local) is also public, for the same reason: an installed app's binary is inspectable.

## Why HS256, not RS256, and what it costs us

The Supabase project signs all JWTs with HS256 (symmetric secret). This is the Supabase default.

The cost is `scope=openid` doesn't work — the OIDC ID token requires asymmetric signing keys, and Supabase returns "Error generating ID token" when asked to mint one with HS256. We work around this by simply not requesting `openid`. The `access_token` is itself a JWT containing `sub`, `email`, `aud`, etc. — everything we need for identity. There's no separate ID token we're missing out on.

Migrating Supabase to RS256 would unblock `openid` and make our JWTs verifiable by third parties without sharing the secret. That's a future migration; for now, every backend that verifies these tokens has access to the symmetric secret (`SUPABASE_JWT_SECRET`) anyway.

## Why state is in-memory and not in a cookie or Redis

The state store maps `state → {app_redirect, code_verifier, ts}` for ≤10 minutes during in-flight logins. It's in-memory in a `dict` on the FastAPI process.

Cookies don't work cleanly because the SPA and the FastAPI server are on different origins (`admin.app.matrxserver.com` vs `server.app.matrxserver.com`); SameSite/Secure rules around cross-origin redirects make cookie-based state fragile.

Redis would work, but we run a single FastAPI worker per Coolify deployment. The cost of an in-flight login being lost on deploy is "user retries", which is negligible. Adding Redis just for OAuth state is unnecessary complexity at our scale. If we ever scale FastAPI horizontally, this becomes the first thing to migrate.

## Why we don't trust the JWT signature in `oauth_callback`

`_decode_jwt_payload` base64url-decodes the middle JWT segment and returns the claims. **It does not verify the signature.**

This is intentional: we use the claims (`sub`, `email`) only to perform the admin lookup before handing the token back to the SPA. The `AuthMiddleware` in `aidream/api/middleware/auth.py` re-verifies the signature on every subsequent API call against `SUPABASE_JWT_SECRET` and the configured audience. Verifying twice is wasteful; the second verification is the one that actually gates real API access.

The token we hand to the SPA must of course still be a valid Supabase-signed JWT — but we know it is, because we received it from the Supabase token endpoint moments earlier.

## What the access-denied page is for

When a non-admin successfully signs in, we redirect them to `<spa-origin>/access-denied?email=...`. The page tells them they need admin access and provides a `mailto:` link to request it. Two reasons:

- It's a clear signal: not "broken" or "logged out", but "logged in, not authorized for this UI". Different fix.
- It captures their email so they know which account is asking.

The pattern is also a forcing function: if a SPA author forgets to add the `/access-denied` route, non-admins land on a 404. That's an immediate visible bug, which is much better than non-admins silently seeing the admin shell with all data calls returning 403.

## How this differs from a generic "OAuth + JWT in localStorage" setup

| Aspect | Generic SPA OAuth | Matrx OAuth |
|---|---|---|
| Provider | Some OAuth server (Auth0, Cognito, etc.) | aimatrx.com Next.js → Supabase |
| Token exchange location | SPA (or the SPA's BFF) | FastAPI server |
| Admin gate | Per-SPA, after token | Server, before token reaches SPA |
| Storage | localStorage | localStorage (`matrx_admin_token`) |
| Token format | Provider-specific | Supabase JWT (HS256) |
| Public vs confidential | Either | Public PKCE only |
| `openid` scope | Usually yes | No (HS256 limitation) |
| Refresh tokens | Common | Not currently used by SPAs (re-auth on expiry) |

## Open questions / future work

- Refresh tokens are returned by Supabase but the SPAs currently throw them away. When token expiry becomes a UX problem, we should either:
  - Store the refresh token alongside the access token and refresh client-side; or
  - Stand up a `/auth/refresh` endpoint that takes the refresh token, calls Supabase, and returns a fresh access token (keeps the secret-handling on the server).

- The state store will need to migrate to Redis the day we scale to multiple FastAPI workers.

- An `/auth/logout` endpoint that revokes the Supabase refresh token would close the loop. Right now the SPA just deletes the localStorage entry, which is fine for the common case but doesn't invalidate the upstream session.
