---
name: matrx-oauth
type: Skill
title: matrx-oauth — the Matrx OAuth flow, end to end
description: End-to-end guide to the Matrx OAuth flow — a Next.js proxy in matrx-frontend fronting Supabase, the FastAPI (aidream) callback that does the admin gate, SPA callbacks (aidream apps/dashboard, apps/workflow-studio), and the Tauri desktop client (matrx-local). Use when wiring OAuth into a new Matrx SPA or service, debugging "Token exchange failed", "No access token received", silent flash-and-bounce login failures, or any auth issue involving aimatrx.com, Supabase tokens, the admin allowlist, or the /auth/aimatrx / /auth/callback endpoints.
tags: [auth, oauth, skill, aidream, matrx-frontend, matrx-local, matrx-extend]
resource: https://server.app.matrxserver.com/auth/aimatrx
timestamp: 2026-08-21T00:00:00Z
verified: 2026-08-21 — verdicts below checked against live code in aidream and matrx-frontend, not against either prior skill copy.
---

<!-- SYNCED COPY — do not edit here.
     Canonical: common-docs/skills/matrx-oauth/SKILL.md
     This file is distributed to every consuming repo by
     common-docs/meta/scripts/sync_skills.py. Edit the canonical, run the
     sync, and commit each repo. Edits made here are overwritten and lost. -->

# Matrx OAuth — Full A-to-Z

The Matrx OAuth provider is **a thin Next.js proxy in front of Supabase Auth**, hosted at `https://www.aimatrx.com`. It is NOT Google / GitHub / generic OAuth — it's our own provider, backed by the same Supabase project that issues Matrx user JWTs. Treat every external behavior as "Supabase OAuth 2.1 with PKCE", not "OAuth 2.0 in general" — Supabase has several non-standard quirks that have burned three weeks of debugging.

## Repositories

| Repo | Role |
|---|---|
| `aidream` | FastAPI `/auth/aimatrx` (authorize) and `/auth/callback` (token exchange + admin gate) — `aidream/api/routers/auth.py` + `aidream/services/auth_oauth/service.py`. Also hosts the two admin SPAs at `apps/dashboard/` and `apps/workflow-studio/`, and the JWT verification middleware every downstream API call goes through. |
| `matrx-frontend` | The Next.js OAuth proxy itself — `app/api/oauth/{authorize,token}/route.ts` — deployed as the `ai-matrx` Vercel project serving `aimatrx.com`. Thin passthrough to Supabase; don't add logic here. |
| `matrx-local` | Tauri desktop client — talks to Supabase directly, skipping aimatrx.com (`projects/matrx-local/desktop/src/lib/oauth.ts`). |
| `matrx-extend` | Consumes this skill for any OAuth wiring the Chrome extension needs; does not itself host provider or callback code. |

## This doc replaced two divergent copies

Prior to 2026-08-21 this skill existed as two independently-drifted bodies with no canonical source: `matrx-extend/matrx-oauth/` (nonstandard repo-root location) and `aidream/.claude/skills/matrx-oauth/`. Three claims were verified against live code to build this doc — see the changelog at the bottom for the full verdicts and evidence.

## Architecture

```
┌──────────────────────────┐       ┌──────────────────────────────┐
│  SPA (apps/dashboard,     │       │  Tauri desktop (matrx-local) │
│  apps/workflow-studio)    │       │  redirect: aimatrx://        │
│  origin: *.matrxserver    │       │                              │
└────────────┬─────────────┘       └────────────┬─────────────────┘
             │ ① click sign-in                  │ ① shell.open()
             ▼                                  ▼
┌──────────────────────────┐       ┌──────────────────────────────┐
│ FastAPI /auth/aimatrx     │       │ Direct call to Supabase      │
│ (server.app.matrxserver)  │       │ /auth/v1/oauth/authorize     │
│ generates PKCE+state,     │       └──────────────┬───────────────┘
│ stores them in memory,    │                      │ matrx-local skips
│ 302→ aimatrx authorize    │                      │ aimatrx.com — public
└────────────┬─────────────┘                       │ PKCE talks to Supabase
             │                                     │ directly. SPAs go
             ▼                                     │ through aimatrx.com
   ┌──────────────────────┐                        │ + the FastAPI bouncer
   │ aimatrx.com (Next.js  │ ◄──────────────────────┘ so we can run our
   │ app in matrx-frontend,│     own admin gate.
   │ Vercel project        │
   │ "ai-matrx")           │
   │ /api/oauth/authorize  │
   │  → Supabase authorize │
   │ /oauth/consent (UI)   │
   │ /api/oauth/token      │
   │  → Supabase token     │
   └──────────┬────────────┘
              │ ② redirects browser to FastAPI /auth/callback
              ▼
   ┌──────────────────────┐
   │ FastAPI /auth/callback│ ③ POST code → aimatrx /token (PUBLIC PKCE)
   │  decodes JWT (sub,    │ ④ SELECT from admin.admins WHERE user_id=sub
   │  email)               │ ⑤ admin → 302 to {app_redirect}?access_token=...
   │  admin lookup         │     non-admin → 302 to {origin}/access-denied
   │  redirects to SPA     │     failure   → 302 to {app_redirect}?error=...
   └──────────┬────────────┘
              ▼
   ┌─────────────────────────┐
   │ SPA /oauth/callback     │ Reads ?access_token / ?error ONCE from
   │  setItem(AUTH_TOKEN_KEY)│ window.location.search, then strips the URL.
   │  navigate("/")          │ See "SPA callback gotcha" below.
   └─────────────────────────┘
```

## The hard-won facts

These took three weeks of debugging to nail down. **Internalize them.** Most "fixes" that don't respect these will reintroduce one of the bugs.

1. **The Matrx OAuth client is a PUBLIC PKCE client. Never send `client_secret`.**
   Supabase rejects confidential-client params for public clients with `400`. The proof of possession is the PKCE `code_verifier`, not a secret. Same client type matrx-local desktop uses — see `projects/matrx-local/desktop/src/lib/oauth.ts`.

2. **JWT signing algorithm: ES256 is current, not HS256.** VERIFIED (see changelog). Matrx Main signs JWTs with **ES256** (asymmetric). `aidream/aidream/api/middleware/auth.py` documents this explicitly and keeps `JWT_ALGORITHMS = ("HS256", "ES256")` — HS256 stays in the allow-list only as a rotation-window compatibility fallback, not because it's the live signer. Any JWT verification code must accept both via the configured allow-list and JWKS, never hard-code one algorithm.
   The OAuth authorize/token flow still drops the `openid` scope (`scope=email profile` only) — the comment in `aidream/services/auth_oauth/service.py` justifying this still says "Supabase HS256 projects can't sign ID tokens," which is the stale rationale for a decision that may still be operationally correct. **Flagged, not resolved:** re-verify against the live token response before trusting that comment if `openid` is ever needed.

3. **Supabase error responses don't always use `{error, error_description}`.**
   We've seen `{error_description}`, `{error_message}`, `{msg}`, `{error}`, `{code}` — pick whichever is present, and always log the truncated raw body of 4xx responses. A 4xx body cannot contain access/refresh tokens, so logging it is safe.

4. **The SPA callback must read the URL exactly once, NOT reactively.**
   TanStack Router's `useSearch()` is reactive. After `window.history.replaceState()` strips the token from the URL (which we do for security), `useSearch()` re-reads and returns `access_token=undefined`, re-firing the effect into the "No access token received" branch even though we just successfully signed in. **Pattern**: read params once from `window.location.search` inside `useEffect`, depend only on `navigate`. See `aidream/apps/dashboard/src/routes/oauth.callback.tsx` and `aidream/apps/workflow-studio/src/routes/oauth.callback.tsx`.

5. **The repo's `.gitignore` has a Python `lib/` rule that swallows TS source.**
   Anything new under `aidream/apps/dashboard/src/lib/`, `aidream/apps/workflow-studio/src/lib/`, etc. is silently dropped from git unless explicitly allow-listed. Symptom: the build fails with `Cannot find module '@/lib/...'`, while the running service continues serving the previous healthy image. **Always run `git check-ignore -v <new-lib-file>` after creating one** — a hit against the bare `lib/` rule means add an explicit `!path/**` rule next to the existing dashboard/studio entries.

6. **The admin table is `admin.admins`, not `public.admins`.** VERIFIED (see changelog) — `aidream/db/models/admin.py` defines `Admins` with `_db_schema = "admin"`, `_table_name = "admins"`.

7. **The token-verification path in `oauth_callback` is currently UNVERIFIED, as-is.** `aidream/services/auth_oauth/service.py:_decode_jwt_payload` base64url-decodes the JWT payload without checking the signature — this is live code, not a historical artifact. It's defended as safe because `AuthMiddleware` re-verifies the signature on every subsequent API call, so an attacker who forges the callback's decoded claims can't get real API access — but the callback DOES use those unverified claims to decide `access_token` vs `/access-denied` redirect. Route this through `aidream.api.middleware.token_verifier.verify_supabase_token` (the shared, JWKS/ES256-aware verifier) rather than treating unverified decode as the intended end state.

## Happy path, step by step

### Authorize (start)

`GET https://server.app.matrxserver.com/auth/aimatrx?app_redirect=<spa-callback-url>`

`aidream/api/routers/auth.py:initiate_oauth` (logic in `aidream/services/auth_oauth/service.py`) does:

1. Generate `code_verifier` (`secrets.token_urlsafe(64)`).
2. Generate `code_challenge` (`base64url(sha256(verifier))`, no padding).
3. Generate `state` (`secrets.token_urlsafe(32)`).
4. Store `{app_redirect, code_verifier, ts}` in the in-memory `_state_store` keyed by `state`. TTL is `_STATE_TTL_SECONDS = 600` (10 minutes). Process-local — restarts drop in-flight logins, which is fine.
5. Build authorize URL pointing to `https://www.aimatrx.com/api/oauth/authorize` with the standard params **plus `scope=email profile`** (no `openid`).
6. `redirect_uri` is built by `_build_callback_uri(request)`:
   - **Production / any non-localhost host**: `${AIMATRX_AIDREAM_REDIRECT_URI}/auth/callback` (the canonical URL registered with Supabase). Leave it alone.
   - **Localhost dev** (`request.url.hostname` ∈ `localhost`/`127.0.0.1`/`::1`): derived from the incoming request, e.g. `http://localhost:8000/auth/callback`. Without this branch, dev rounds the user back to PROD `/auth/callback`, where the in-memory state store has no record of their login attempt and they bounce to an "OAuth state missing" error. The local URL must also be added to the Supabase OAuth client's allowed redirect URIs (one-time setup).
   - The chosen `callback_uri` is persisted into `_state_store[state]` so the `/callback` token-exchange uses byte-identical `redirect_uri` (Supabase string-compares it).
   - The browser is the user-agent doing the round trip; the SPA's URL is in `app_redirect` (a separate query param), not in the OAuth `redirect_uri`.
7. Return `302` to the authorize URL.

The legacy alias `/auth/aimatrx-admin` exists as a compatibility shim — it just calls `initiate_oauth`. Remove after one release cycle once no SPA references it.

### Consent + login (Supabase via aimatrx)

The browser hits `https://www.aimatrx.com/api/oauth/authorize` — a thin proxy in `matrx-frontend/app/api/oauth/authorize/route.ts` that forwards every query param to `${SUPABASE_URL}/auth/v1/oauth/authorize`. Supabase shows the consent page at `https://www.aimatrx.com/oauth/consent?authorization_id=...`. After approval, Supabase redirects the browser back to our `redirect_uri` with `?code=<uuid>&state=<state>`.

### Callback (token exchange + admin gate)

`GET https://server.app.matrxserver.com/auth/callback?code=...&state=...`

`oauth_callback` (delegating to `aidream/services/auth_oauth/service.py`):

1. Pop `state` from `_state_store`. Recover `app_redirect` and `code_verifier`. Missing/expired → fail with `"OAuth state missing or expired..."`.
2. POST to `https://www.aimatrx.com/api/oauth/token` (proxies to `${SUPABASE_URL}/auth/v1/oauth/token`) with form body: `grant_type=authorization_code`, `code`, `client_id=<AIMATRX_OAUTH_CLIENT_ID>`, `redirect_uri=<AIMATRX_AIDREAM_REDIRECT_URI>/auth/callback`, `code_verifier`. **No `client_secret`. No `scope`.**
3. On non-2xx: log `status` + `detail` + truncated body (detail-extraction tries `error_description`, `error_message`, `msg`, `error`, `code` in that order). Redirect to `{app_redirect}?error=...`.
4. On 2xx: parse `access_token` from the JSON body.
5. `_decode_jwt_payload(access_token)` — base64url-decode the middle JWT segment WITHOUT signature verification (see hard-won fact 7 above) — pulls `sub` and `email`. Signature is re-checked by `AuthMiddleware` on every subsequent API call.
6. `_is_admin(user_id)` → `await Admins.filter(user_id=...).all()` against `admin.admins`. Any DB exception → fail closed.
7. **Admin** → `302` to `{app_redirect}?access_token=<urlencoded>`. **Non-admin** → `302` to `{origin}/access-denied?email=<urlencoded>` (`origin` is the SPA's `scheme://netloc` parsed from `app_redirect`). **Failure** → `302` to `{app_redirect}?error=...`.

### SPA callback (token storage)

The SPA's `/oauth/callback` route component MUST follow this pattern (mirrors the working `apps/dashboard` implementation):

```tsx
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AUTH_TOKEN_KEY } from "@/lib/constants";
import { setAuthToken } from "@/hooks/use-auth";

export const Route = createFileRoute("/oauth/callback")({
  beforeLoad: () => {
    if (localStorage.getItem(AUTH_TOKEN_KEY)) {
      throw redirect({ to: "/" });
    }
    // NO validateSearch / search schema — we read window.location once.
  },
  component: OAuthCallback,
});

function OAuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    // Read ONCE from window.location.search, before replaceState clears it.
    // Do NOT use useSearch() — it's reactive and re-fires after replaceState.
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get("access_token");
    const errorParam = params.get("error");

    if (errorParam) { setErrorMessage(decodeURIComponent(errorParam)); setStatus("error"); return; }
    if (!accessToken) { setErrorMessage("No access token received."); setStatus("error"); return; }

    setAuthToken(accessToken);
    setStatus("success");
    window.history.replaceState({}, "", window.location.pathname);
    const t = setTimeout(() => void navigate({ to: "/", replace: true }), 600);
    return () => clearTimeout(t);
  }, [navigate]); // <-- only navigate; NEVER access_token/error here.

  // …status-driven UI omitted — see apps/dashboard or apps/workflow-studio for examples.
}
```

The matching `/access-denied` route just reads `?email=` and shows a friendly request-access screen with a `mailto:` link. See `aidream/apps/dashboard/src/routes/access-denied.tsx`.

### Tauri desktop (matrx-local)

`projects/matrx-local/desktop/src/lib/oauth.ts` is the canonical reference for a public PKCE client. Two key differences from the SPA flow:

- It hits `${SUPABASE_URL}/auth/v1/oauth/authorize` and `/oauth/token` **directly** (skips aimatrx.com). It doesn't need an admin gate.
- The `state` parameter encodes the `code_verifier` itself: `state = "<verifier>.<nonce>"`. This survives cross-origin tab navigations on the web dev flow when localStorage may be cleared. Not required for SPAs since they store the verifier on the server.

Don't copy matrx-local's flow into a SPA — the SPA pattern is intentionally different because the server-side admin gate has to live somewhere and we don't want every SPA reimplementing it.

## Wiring OAuth into a new Matrx SPA

Checklist. All steps are required. Skipping any of them produces one of the failure modes documented in the Debugging playbook above.

```
- [ ] 1. Add /oauth/callback route — copy from apps/dashboard or apps/workflow-studio
       verbatim. Use the read-once-from-window.location pattern. NO validateSearch.

- [ ] 2. Add /access-denied route — copy from apps/dashboard or apps/workflow-studio.

- [ ] 3. Add VITE_AIDREAM_API_URL (or VITE_MATRX_ADMIN_URL legacy alias) and
       VITE_APP_URL to .env.production. Bake them into the Vite build.

- [ ] 4. Wire the login button to:
       window.location.href =
         `${AIDREAM_API_URL}/auth/aimatrx?app_redirect=${encodeURIComponent(window.location.origin + "/oauth/callback")}`

- [ ] 5. If you put any new files under <new-spa>/src/lib/, run
       `git check-ignore -v <file>` to confirm git tracks them. If the
       Python lib/ rule catches one, add `!<new-spa>/src/lib/**` next to
       the existing apps/dashboard, apps/workflow-studio allow-rules in .gitignore.

- [ ] 6. Add the new SPA's origin to CORS_DEFAULT_ORIGIN_REGEX in
       aidream/api/config.py if it's outside *.matrxserver.com /
       *.aimatrx.com / *.aidream.ai / *.vercel.app.

- [ ] 7. Keep tsc out of the Docker build path: package.json `build: "vite build"`
       (NOT `tsc -b && vite build`), and add `typecheck: "tsc -b --noEmit"` for
       local CI use.
```

## Debugging playbook

| Symptom | Likely cause |
|---|---|
| "Sign in failed: Token exchange failed: unknown error" in the SPA | Supabase returned 400 with a JSON shape we didn't recognize. Tail server logs for `[auth/callback] token exchange failed: status=... detail=... body=...` and act on the body. |
| Login flashes back to /login with no error message | Old SPA build is running — check the deploy pipeline and running image/version. |
| Build fails with `Cannot find module '@/lib/...'` | `lib/` rule in `.gitignore` swallowed your file. Add an allow-rule. |
| Token exchange returns 400 immediately after deploying a refactor | Re-introduced `client_secret` or `scope=openid`. Compare against `auth.py`/`service.py`. |
| /oauth/callback shows "No access token received" but the redirect URL had `?access_token=...` | Re-introduced reactive `useSearch()` in the callback. Read `window.location.search` once instead. |
| "OAuth state missing or expired" | Server restarted between authorize and callback (in-memory state), or it's been > 10 minutes. Retry. |
| Admin user sees /access-denied | Their Supabase `sub` isn't in `admin.admins`. Add it. |

## Environment variables

Required on the FastAPI server:

- `AIMATRX_OAUTH_CLIENT_ID` — public OAuth client UUID registered with the Matrx Supabase project. Currently `867ea8ad-7eaa-4614-b866-ecaf72c52e14` for the aidream→aimatrx flow.
- `AIMATRX_AIDREAM_REDIRECT_URI` — base URL of the FastAPI server (e.g. `https://server.app.matrxserver.com`). The `/auth/callback` suffix is appended in code; do NOT include it in the env var. Only consulted when the incoming `/auth/aimatrx` request's hostname is **not** localhost — for localhost dev, the redirect URI is derived from the request itself.
- `AIMATRX_OAUTH_CLIENT_SECRET` is **not** required and is **not** read by the current code. If you see it in env, leave it; it's harmless. Don't introduce it back into the code.

Required on each SPA (baked into the Vite build via `.env.production`):

- `VITE_AIDREAM_API_URL` (preferred) or `VITE_MATRX_ADMIN_URL` (legacy alias) — the FastAPI base URL.
- `VITE_APP_URL` — the SPA's own origin, used for default redirect targets.

## Reference files

| File | Why it matters |
|---|---|
| `aidream/api/routers/auth.py` + `aidream/services/auth_oauth/service.py` | Canonical implementation of authorize + callback + admin gate. Source of truth for the server side. |
| `aidream/apps/dashboard/src/routes/oauth.callback.tsx` | Working SPA callback pattern. Copy verbatim into new SPAs. |
| `aidream/apps/dashboard/src/routes/access-denied.tsx` | Friendly non-admin landing page. Copy verbatim. |
| `aidream/apps/dashboard/src/features/auth/login.tsx` | Login button wiring. Note the `app_redirect` URL building. |
| `aidream/apps/workflow-studio/src/routes/oauth.callback.tsx` | Identical pattern in a different SPA. Useful as a second example. |
| `matrx-frontend/app/api/oauth/{authorize,token}/route.ts` | Next.js proxy to Supabase (the `ai-matrx` Vercel project serving aimatrx.com). Don't add logic here — it must stay a thin passthrough. |
| `projects/matrx-local/desktop/src/lib/oauth.ts` | Canonical public PKCE client. Reference for client params (no secret, no openid). |
| `aidream/api/config.py` (`CORS_DEFAULT_ORIGIN_REGEX`) | Whitelist of allowed SPA origins. Add new SPAs here. |
| `aidream/aidream/api/middleware/auth.py` + `packages/matrx-connect/matrx_connect/middleware/auth.py` + `aidream/aidream/api/middleware/token_verifier.py` | JWT verification (HS256/ES256 allow-list, JWKS) on every API call and for the shared out-of-band verifier. The token from this OAuth flow flows through here. |
| `aidream/db/models/admin.py` | `Admins` model — `_db_schema = "admin"`, `_table_name = "admins"`. |

## Changelog

- **2026-08-21 — canonical body created, merging two divergent copies** (`matrx-extend/matrx-oauth/` at a nonstandard repo-root location, and `aidream/.claude/skills/matrx-oauth/`). Board row: `operations/doc-migration.md` #47. Three disputed claims verified against live code, not voted between:
  1. **JWT signing algorithm** — matrx-extend copy claimed HS256 (symmetric) is the live signer, used to justify dropping the `openid` scope. aidream copy claimed ES256 is current and the HS256 rationale obsolete. **Verdict: ES256 is correct** (aidream copy) — `aidream/aidream/api/middleware/auth.py` carries an explicit, detailed comment: "Matrx Main signs JWTs with ES256 (asymmetric)... HS256 stays for the rotation window," and `JWT_ALGORITHMS = ("HS256", "ES256")`. HS256 remains accepted only as a compatibility fallback, not as the live signer.
  2. **Repo path for the SPAs** — matrx-extend copy used `dashboard/`, `workflow-studio/` at repo root. aidream copy used `apps/dashboard/`, `apps/workflow-studio/`. **Verdict: `apps/dashboard/` and `apps/workflow-studio/` are correct** (aidream copy) — confirmed on disk at `aidream/apps/dashboard` and `aidream/apps/workflow-studio`; no bare `dashboard/` exists at aidream's repo root.
  3. **App/provider naming ("matrx-admin" vs "ai-matrx")** — matrx-extend copy labeled the Next.js provider app "matrx-admin" and referenced it at `projects/matrx-admin/`. aidream copy labeled it "ai-matrx" and referenced `../ai-matrx/`. **Verdict: neither path was correct; the label "ai-matrx" is correct.** The actual Next.js OAuth proxy lives at `matrx-frontend/app/api/oauth/{authorize,token}/route.ts`, deployed as the `ai-matrx` Vercel project (`matrx-frontend/next.config.js` documents `ai-matrx → aimatrx.com → MATRX_PROFILE=slim`). "matrx-admin" does not match any live deployment or directory name.
  - Also corrected in the merge (found during verification, not part of the three named disputes): the admin table is `admin.admins` (matrx-extend copy still said `public.admins`); the callback's token-claim path (`_decode_jwt_payload`) is confirmed still unverified in live code as of this date — the aidream copy's claim that it already routes through `verify_supabase_token` is aspirational, not the current state, and is corrected above (hard-won fact 7).
  - **Unverified, left out:** whether `openid` truly cannot be requested today — the code comment justifying that decision is itself stale (still cites HS256), so this is flagged rather than asserted either way.
