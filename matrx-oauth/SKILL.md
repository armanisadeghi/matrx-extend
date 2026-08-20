---
name: matrx-oauth
description: End-to-end guide to the Matrx OAuth flow — Next.js (matrx-admin) provider proxying Supabase, FastAPI (aidream) callback that does the admin gate, SPA callback (dashboard, workflow-studio), and the Tauri desktop client (matrx-local). Use when wiring OAuth into a new Matrx SPA or service, debugging "Token exchange failed", "No access token received", silent flash-and-bounce login failures, or any auth issue involving aimatrx.com, Supabase tokens, the admin allowlist, or the /auth/aimatrx / /auth/callback endpoints.
---

# Matrx OAuth — Full A-to-Z

The Matrx OAuth provider is **a thin Next.js proxy in front of Supabase Auth**, hosted at `https://www.aimatrx.com`. It is NOT Google / GitHub / generic OAuth — it's our own provider, backed by the same Supabase project that issues Matrx user JWTs. Treat every external behavior as "Supabase OAuth 2.1 with PKCE", not "OAuth 2.0 in general", because Supabase has several non-standard quirks that have burned three weeks of debugging.

## Architecture

```
┌──────────────────────────┐       ┌──────────────────────────────┐
│  SPA  (admin / studio)   │       │  Tauri desktop (matrx-local) │
│  origin: *.matrxserver   │       │  redirect: aimatrx://        │
└────────────┬─────────────┘       └────────────┬─────────────────┘
             │ ① click sign-in                  │ ① shell.open()
             ▼                                  ▼
┌──────────────────────────┐       ┌──────────────────────────────┐
│ FastAPI /auth/aimatrx    │       │ Direct call to Supabase      │
│ (server.app.matrxserver) │       │ /auth/v1/oauth/authorize     │
│ generates PKCE+state,    │       └──────────────┬───────────────┘
│ stores them in memory,   │                      │ matrx-local skips
│302→ aimatrx authorize    │                      │ aimatrx.com — public
└────────────┬─────────────┘                      │ PKCE talks to Supabase
             │                                    │ directly. SPAs go
             ▼                                    │ through aimatrx.com
   ┌──────────────────────┐                       │ + the FastAPI bouncer
   │ aimatrx.com Next.js  │ ◄─────────────────────┘ so we can run our
   │ /api/oauth/authorize │     own admin gate.
   │  → Supabase authorize│
   │ /oauth/consent (UI)  │
   │ /api/oauth/token     │
   │  → Supabase token    │
   └──────────┬───────────┘
              │ ② redirects browser to FastAPI /auth/callback
              ▼
   ┌──────────────────────┐
   │ FastAPI /auth/callback│ ③ POST code → aimatrx /token (PUBLIC PKCE)
   │  decodes JWT (sub,    │ ④ SELECT from public.admins WHERE user_id=sub
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

## The five hard-won facts

These are the facts that took three weeks of debugging to nail down. **Internalize them.** Most "fixes" that don't respect these will reintroduce one of the bugs.

1. **The Matrx OAuth client is a PUBLIC PKCE client. Never send `client_secret`.**
   Supabase rejects confidential-client params for public clients with `400`. The proof of possession is the PKCE `code_verifier`, not a secret. Same client type matrx-local desktop uses — see `projects/matrx-local/desktop/src/lib/oauth.ts`.

2. **Drop the `openid` scope. Use `scope=email profile` only.**
   The Supabase project signs JWTs with HS256 (symmetric). The `openid` scope asks Supabase to mint an ID token, which requires asymmetric (RS256/ES256) keys. With HS256 it returns "Error generating ID token". The `access_token` is itself a Supabase JWT and is sufficient for our admin lookup and downstream API auth.

3. **Supabase error responses don't always use `{error, error_description}`.**
   We've seen `{error_description}`, `{error_message}`, `{msg}`, `{error}`, `{code}` — pick whichever is present, and always log the truncated raw body of 4xx responses. A 4xx body cannot contain access/refresh tokens, so logging it is safe.

4. **The SPA callback must read the URL exactly once, NOT reactively.**
   TanStack Router's `useSearch()` is reactive. After `window.history.replaceState()` strips the token from the URL (which we do for security), `useSearch()` re-reads and returns `access_token=undefined`, re-firing the effect into the "No access token received" branch even though we just successfully signed in. **Pattern**: read params once from `window.location.search` inside `useEffect`, depend only on `navigate`. See `dashboard/src/routes/oauth.callback.tsx` and `workflow-studio/src/routes/oauth.callback.tsx`.

5. **The repo's `.gitignore` has a Python `lib/` rule that swallows TS source.**
   Anything new under `dashboard/src/lib/`, `workflow-studio/src/lib/`, etc. is silently dropped from git unless explicitly allow-listed. Symptom: the GitHub/ECR build fails with `Cannot find module '@/lib/...'`, while ECS continues serving the previous healthy image. **Always run `git check-ignore -v <new-lib-file>` after creating one** — a hit against `.gitignore:28:lib/` means add an explicit `!path/**` rule next to the existing dashboard/studio entries.

## Happy path, step by step

### Authorize (start)

`GET https://server.app.matrxserver.com/auth/aimatrx?app_redirect=<spa-callback-url>`

`aidream/api/routers/auth.py:initiate_oauth` does:

1. Generate `code_verifier` (`secrets.token_urlsafe(64)`).
2. Generate `code_challenge` (`base64url(sha256(verifier))`, no padding).
3. Generate `state` (`secrets.token_urlsafe(32)`).
4. Store `{app_redirect, code_verifier, ts}` in the in-memory `_state_store` keyed by `state`. TTL is `_STATE_TTL_SECONDS = 600` (10 minutes). Process-local — restarts drop in-flight logins, which is fine.
5. Build authorize URL pointing to `https://www.aimatrx.com/api/oauth/authorize` with the standard params **plus `scope=email profile`** (no `openid`).
6. `redirect_uri` is built by `_build_callback_uri(request)` in `auth.py`:
   - **Production / any non-localhost host**: `${AIMATRX_AIDREAM_REDIRECT_URI}/auth/callback` (the canonical URL registered with Supabase). This is the path that took weeks to stabilize — leave it alone.
   - **Localhost dev** (`request.url.hostname` ∈ `localhost`/`127.0.0.1`/`::1`): derived from the incoming request, e.g. `http://localhost:8000/auth/callback`. Without this branch, `uv run` + `pnpm dev` rounds the user back to PROD `/auth/callback`, where the in-memory state store has no record of their login attempt and they bounce to `https://server.app.matrxserver.com/login?error=OAuth state missing...`. The local URL must also be added to the Supabase OAuth client's allowed redirect URIs (one-time setup).
   - The chosen `callback_uri` is persisted into `_state_store[state]` so the `/callback` token-exchange uses byte-identical `redirect_uri` (Supabase string-compares it).
   - The browser is the user-agent doing the round trip; the SPA's URL is in `app_redirect` (a separate query param), not in the OAuth `redirect_uri`.
7. Return `302` to the authorize URL.

The legacy alias `/auth/aimatrx-admin` exists as a compatibility shim — it just calls `initiate_oauth`. Remove after one release cycle once no SPA references it.

### Consent + login (Supabase via aimatrx)

The browser hits `https://www.aimatrx.com/api/oauth/authorize` which is a thin proxy that forwards every query param to `${SUPABASE_URL}/auth/v1/oauth/authorize` (see `projects/matrx-admin/app/api/oauth/authorize/route.ts`). Supabase shows the consent page at `https://www.aimatrx.com/oauth/consent?authorization_id=...`. After approval, Supabase redirects the browser back to our `redirect_uri` with `?code=<uuid>&state=<state>`.

### Callback (token exchange + admin gate)

`GET https://server.app.matrxserver.com/auth/callback?code=...&state=...`

`oauth_callback` in `auth.py`:

1. Pop `state` from `_state_store`. Recover `app_redirect` and `code_verifier`. Missing/expired → `_fail("OAuth state missing or expired...")`.
2. POST to `https://www.aimatrx.com/api/oauth/token` (proxies to `${SUPABASE_URL}/auth/v1/oauth/token`) with form body:
   ```
   grant_type=authorization_code
   code=<code>
   client_id=<AIMATRX_OAUTH_CLIENT_ID>
   redirect_uri=<AIMATRX_AIDREAM_REDIRECT_URI>/auth/callback
   code_verifier=<verifier>
   ```
   **No `client_secret`.** **No `scope`.**
3. On non-2xx: log `status` + `detail` + truncated body. The detail-extraction tries `error_description`, `error_message`, `msg`, `error`, `code` in that order. Redirect to `{app_redirect}?error=...`.
4. On 2xx: parse `access_token` from the JSON body.
5. `_decode_jwt_payload(access_token)` — base64url-decode the middle JWT segment WITHOUT signature verification. Pull `sub` and `email`. Signature is re-checked by `AuthMiddleware` on every subsequent API call; here we just need to identify the user before the admin lookup.
6. `_is_admin(user_id)` → `await Admins.filter(user_id=...).all()`. Any DB exception → `_fail`.
7. **Admin** → `302` to `{app_redirect}?access_token=<urlencoded>`.
   **Non-admin** → `302` to `{origin}/access-denied?email=<urlencoded>` (where `origin` is the SPA's `scheme://netloc` parsed from `app_redirect`, falling back to a stripped `app_redirect`).

### SPA callback (token storage)

The SPA's `/oauth/callback` route component MUST follow this pattern (mirrors the working dashboard implementation):

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

  // …status-driven UI omitted — see dashboard/studio for examples.
}
```

The matching `/access-denied` route just reads `?email=` and shows a friendly request-access screen with a `mailto:` link. See `dashboard/src/routes/access-denied.tsx`.

### Tauri desktop (matrx-local)

`projects/matrx-local/desktop/src/lib/oauth.ts` is the canonical reference for a public PKCE client. Two key differences from the SPA flow:

- It hits `${SUPABASE_URL}/auth/v1/oauth/authorize` and `/oauth/token` **directly** (skips aimatrx.com). It doesn't need an admin gate.
- The `state` parameter encodes the `code_verifier` itself: `state = "<verifier>.<nonce>"`. This survives cross-origin tab navigations on the web dev flow when localStorage may be cleared. Brilliant pattern; not required for SPAs since they store the verifier on the server.

Don't copy matrx-local's flow into a SPA — the SPA pattern is intentionally different because the server-side admin gate has to live somewhere and we don't want every SPA reimplementing it.

## Wiring OAuth into a new Matrx SPA

Checklist. All five steps are required. Skipping any of them produces one of the failure modes documented in `gotchas.md`.

```
- [ ] 1. Add /oauth/callback route — copy from dashboard or studio verbatim.
       Use the read-once-from-window.location pattern. NO validateSearch.

- [ ] 2. Add /access-denied route — copy from dashboard or studio.

- [ ] 3. Add VITE_AIDREAM_API_URL (or VITE_MATRX_ADMIN_URL legacy alias) and
       VITE_APP_URL to .env.production. Bake them into the Vite build.

- [ ] 4. Wire the login button to:
       window.location.href =
         `${AIDREAM_API_URL}/auth/aimatrx?app_redirect=${encodeURIComponent(window.location.origin + "/oauth/callback")}`

- [ ] 5. If you put any new files under <new-spa>/src/lib/, run
       `git check-ignore -v <file>` to confirm git tracks them. If the
       Python lib/ rule catches one, add `!<new-spa>/src/lib/**` next to
       the existing dashboard/studio allow-rules in .gitignore.

- [ ] 6. Add the new SPA's origin to CORS_DEFAULT_ORIGIN_REGEX in
       aidream/api/config.py if it's outside *.matrxserver.com /
       *.aimatrx.com / *.aidream.ai / *.vercel.app.

- [ ] 7. Disable strict tsc during the Docker build:
       package.json `build: "vite build"` (NOT `tsc -b && vite build`),
       and add `typecheck: "tsc -b --noEmit"` for local CI use.
```

## Debugging playbook

Open `gotchas.md` next to this file when any of these symptoms shows up. Each entry there documents the symptom, root cause, and the exact fix.

| Symptom | Likely cause |
|---|---|
| "Sign in failed: Token exchange failed: unknown error" in the SPA | Supabase returned 400 with a JSON shape we didn't recognize. Tail FastAPI logs for `[auth/callback] token exchange failed: status=... detail=... body=...` and act on the body. |
| Login flashes back to /login with no error message | Old SPA build is running. Check the GitHub release run, ECR image SHA, ECS service deployment, and `/health/version`; dashboard/Studio are no longer Coolify-owned. |
| Build fails with `Cannot find module '@/lib/...'` | `lib/` rule in `.gitignore` swallowed your file. Add an allow-rule. |
| Token exchange returns 400 immediately after deploying a refactor | Re-introduced `client_secret` or `scope=openid`. Compare against `auth.py`. |
| /oauth/callback shows "No access token received" but the redirect URL had `?access_token=...` | Re-introduced reactive `useSearch()` in the callback. Read `window.location.search` once instead. |
| "OAuth state missing or expired" | FastAPI restarted between authorize and callback (in-memory state), or it's been > 10 minutes. Retry. |
| Admin user sees /access-denied | Their Supabase `sub` isn't in `public.admins`. Add it. |
| Studio works but dashboard shows old UI / stale features | Same root cause as above — one ECS service is still on an older image. The `lib/` gitignore is by far the most common build killer. |

## Environment variables

Required on the FastAPI server (AWS Secrets Manager payload consumed by the ECS `ai-dream-server` task):

- `AIMATRX_OAUTH_CLIENT_ID` — public OAuth client UUID registered with the Matrx Supabase project. Currently `867ea8ad-7eaa-4614-b866-ecaf72c52e14` for the aidream→aimatrx flow.
- `AIMATRX_AIDREAM_REDIRECT_URI` — base URL of the FastAPI server (e.g. `https://server.app.matrxserver.com`). The `/auth/callback` suffix is appended in code; do NOT include it in the env var. Only consulted when the incoming `/auth/aimatrx` request's hostname is **not** localhost — for localhost dev, the redirect URI is derived from the request itself (see the architecture section).
- `AIMATRX_OAUTH_CLIENT_SECRET` is **not** required and is **not** read by the current code. If you see it in env, leave it; it's harmless. Don't introduce it back into the code.

Required on each SPA (baked into the Vite build via `.env.production`):

- `VITE_AIDREAM_API_URL` (preferred) or `VITE_MATRX_ADMIN_URL` (legacy alias) — the FastAPI base URL.
- `VITE_APP_URL` — the SPA's own origin, used for default redirect targets.

## Reference files

| File | Why it matters |
|---|---|
| `aidream/api/routers/auth.py` | Canonical FastAPI implementation of authorize + callback + admin gate. Source of truth for the server side. |
| `dashboard/src/routes/oauth.callback.tsx` | Working SPA callback pattern. Copy verbatim into new SPAs. |
| `dashboard/src/routes/access-denied.tsx` | Friendly non-admin landing page. Copy verbatim. |
| `dashboard/src/features/auth/login.tsx` | Login button wiring. Note the `app_redirect` URL building. |
| `workflow-studio/src/routes/oauth.callback.tsx` | Identical pattern in a different SPA. Useful as a second example. |
| `projects/matrx-admin/app/api/oauth/{authorize,token}/route.ts` | Next.js proxy to Supabase. Don't add logic here — it must stay a thin passthrough. |
| `projects/matrx-local/desktop/src/lib/oauth.ts` | Canonical public PKCE client. Reference for client params (no secret, no openid). |
| `aidream/api/config.py` (`CORS_DEFAULT_ORIGIN_REGEX`) | Whitelist of allowed SPA origins. Add new SPAs here. |
| `aidream/api/middleware/auth.py` + `packages/matrx-connect/matrx_connect/middleware/auth.py` | JWT verification on every API call. The token from this OAuth flow flows through here. |

## Additional resources

- For the full debugging playbook with reproduction steps and exact log lines, see [gotchas.md](gotchas.md).
- For the architectural decision record explaining why we run our own OAuth provider in front of Supabase (instead of using Supabase OAuth directly from each SPA, like matrx-local does), see [architecture.md](architecture.md).
