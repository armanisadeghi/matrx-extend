# Matrx OAuth — Gotchas Playbook

Each entry: symptom → root cause → fix → reproduction. Read top-to-bottom only when stuck; otherwise jump to the matching symptom.

---

## 1. "Token exchange failed: unknown error"

**Symptom in browser**: SPA `/oauth/callback?error=Token%20exchange%20failed%3A%20unknown%20error`. UI shows "Sign in failed".

**Symptom in FastAPI logs** (older code, before fix):
```
[ERROR] [auth/callback] token exchange failed: status=400 detail=unknown error
[ERROR] [auth/callback] FAIL: Token exchange failed: unknown error
```

**Root causes (any one of these)**:

1. **`client_secret` is being sent in the token POST body.** The Matrx OAuth client is a public PKCE client; PKCE replaces the secret. Supabase rejects with 400.
2. **`scope=openid email profile` is being requested at authorize time.** Supabase HS256 projects can't sign ID tokens, so the token endpoint fails. (Authorize step succeeds — the failure shows up at `/token`.)
3. **The error log is using the old detail-extraction**: only checking `error` and `error_description`. Supabase responds with `error_message`, `msg`, or `code` in many cases — falling through to the `"unknown error"` literal.

**Fix**: confirm `aidream/api/routers/auth.py` matches the canonical version:
- Token POST body: `grant_type`, `code`, `client_id`, `redirect_uri`, `code_verifier` only — **no `client_secret`**.
- Authorize URL: `scope=email profile` — **no `openid`**.
- 4xx response handler: tries `error_description`, `error_message`, `msg`, `error`, `code` and logs the truncated body.

**Reproduction**: with bad config, hit `GET /auth/aimatrx?app_redirect=...` in a browser, complete the consent screen, watch FastAPI logs for the 400 from `/api/oauth/token`. With the fix in place, look for the new line `[auth/callback] token exchange ok: status=200`.

---

## 2. Sign-in flashes back to /login with no message

**Symptom**: Click "Sign in with Matrx", browser redirects to aimatrx.com, comes back, lands on `/login` again. No error, no toast, nothing in the URL.

**Likely root cause**: the SPA running in production is an OLD build. Coolify auto-deploys have been failing silently on every push.

**Fix**:

```bash
# Inspect last 5 deploys for the SPA. If they're all "failed", the SPA you're
# debugging is running an image from before the regression that broke the build.
docker exec coolify-db psql -U coolify -d coolify -t -c "
  SELECT q.status, substr(q.commit,1,8), q.created_at
  FROM application_deployment_queues q
  JOIN applications a ON a.id::text = q.application_id
  WHERE a.uuid = '<SPA_UUID>'
  ORDER BY q.id DESC LIMIT 10;
"
```

If everything is `failed`, pull the latest deployment's logs:

```bash
docker exec coolify-db psql -U coolify -d coolify -At -c "
  SELECT logs FROM application_deployment_queues
  WHERE application_id = (SELECT id::text FROM applications WHERE uuid='<UUID>')
  AND status='failed' ORDER BY id DESC LIMIT 1;
" | python3 -c 'import sys,json; [print(e.get("output","")[:200]) for e in json.loads(sys.stdin.read())[-30:]]'
```

Most common build failure: `Cannot find module '@/lib/orm-proxy'` (or any `@/lib/<x>`) — see Gotcha 4.

---

## 3. SPA shows "No access token received" right after a successful round-trip

**Symptom**: full happy path runs (FastAPI logs show `token exchange ok`, no FAIL), but the SPA briefly shows "Signed in. Redirecting…" and then snaps to "Sign in failed: No access token received". The URL ends up at `/oauth/callback` with no query params. The token IS in localStorage.

**Root cause**: the callback effect uses TanStack Router's reactive `useSearch()` and lists `access_token` in its dep array. After we successfully process the token and call `window.history.replaceState({}, "", window.location.pathname)`, the router re-reads `window.location` and the `access_token` search drops to `undefined`. React re-runs the effect, which now hits the `if (!accessToken)` branch and overwrites the success state.

**Fix**: read the URL exactly once from `window.location.search` inside `useEffect`. Do not declare a `validateSearch` schema on the route. The dep array must be `[navigate]` only — never `access_token` or `error`. See the SPA callback example in `SKILL.md`.

**Reproduction**: with the buggy version, observe in DevTools that `setStatus("success")` runs first, then `setStatus("error")` runs immediately after. The token will still be in localStorage afterwards, so the user is "logged in" but stuck on the callback error screen.

---

## 4. Coolify build fails with `Cannot find module '@/lib/<X>'`

**Symptom**: the Coolify deploy log ends with TS2307 errors for files you can clearly see on disk locally (`dashboard/src/lib/orm-proxy.ts`, `workflow-studio/src/lib/api-client.ts`, etc.).

**Root cause**: `.gitignore` has a stock-Python `lib/` rule (line 28-ish) that matches **every** nested `lib/` directory, including the SPAs' TypeScript source folders. New files under those folders are silently untracked.

**Detection**:
```bash
git check-ignore -v dashboard/src/lib/<your-new-file>.ts
# Hit on .gitignore:NN:lib/  →  the rule is eating it.
```

**Fix**: add a negation rule for the affected SPA next to the existing entries:
```gitignore
lib/
lib64/
!dashboard/src/lib/
!dashboard/src/lib/**
!workflow-studio/src/lib/
!workflow-studio/src/lib/**
!<new-spa>/src/lib/
!<new-spa>/src/lib/**
```
Then `git add -f <file>` if needed and commit. **Verify after**: `git check-ignore -v <file>` should now hit one of the `!` lines (allow rule) instead of the bare `lib/` rule.

**Why we don't just delete the `lib/` rule**: the repo also has Python distribution build outputs that legitimately want it. Allow-rules are surgical.

---

## 5. "OAuth state missing or expired"

**Symptom**: FastAPI redirect lands at `{app_redirect}?error=OAuth%20state%20missing%20or%20expired...`.

**Root causes**:

1. **FastAPI was restarted** between the authorize and callback steps (e.g. a deploy finished). The state store is in-memory.
2. **More than 10 minutes** elapsed (the `_STATE_TTL_SECONDS = 600` window).
3. **The state value was tampered with** or doesn't match what we issued (extremely unlikely outside a CSRF attempt).

**Fix**: just retry. If you're seeing this consistently in normal use, increase `_STATE_TTL_SECONDS` or move the store to Redis (we currently run a single FastAPI worker per Coolify deployment, so process-local works fine for single-host).

---

## 6. Admin user lands on `/access-denied`

**Symptom**: known-admin user signs in and gets bounced to `/access-denied?email=<their-email>` instead of the SPA home.

**Diagnosis**: their Supabase `sub` is not in `public.admins`.

**Fix**: insert the row.

```sql
INSERT INTO public.admins (user_id, email, ...)
VALUES ('<their-supabase-sub-uuid>', '<their-email>', ...);
```

Find the `sub` either from the FastAPI logs around the failed callback (`[auth/callback] non-admin login: user_id=... email=...`) or by decoding any access_token they have at https://jwt.io.

**Sanity check**: `aidream/api/routers/auth.py:_is_admin` does `await Admins.filter(user_id=user_id).all()` and any DB exception is caught and surfaced as `"Failed to verify admin access. Please try again."`. If you see that string in the SPA, the DB lookup itself is failing — check connectivity and the `Admins` model definition, not the admin row.

---

## 7. CORS errors on the SPA after a refactor

**Symptom**: SPA's network panel shows the API call as `(failed) net::ERR_FAILED` with CORS preflight rejection.

**Root cause**: SPA origin not allowed by `CORS_DEFAULT_ORIGIN_REGEX` in `aidream/api/config.py`.

**Fix**: add the origin pattern. The current regex covers:
- `*.aimatrx.com`
- `*.aidream.ai`
- `*.matrxserver.com` (admin, studio, server)
- `localhost(:port)`, `127.0.0.1(:port)`, `[::1](:port)`
- `*.vercel.app`

Anything outside these needs to be added or the SPA needs to be deployed to a covered domain.

---

## 8. The "studio doesn't work" without a clear error

**Symptom (specific)**: studio's `/oauth/callback` lands with `?access_token=` correctly, briefly shows success, then shows "Sign in failed: No access token received" — but the token IS in localStorage and you can manually navigate to `/` and the app works.

**Root cause**: same as Gotcha 3 (replaceState + reactive useSearch). The studio version had `[access_token, error, navigate]` in its effect deps; the working dashboard version has `[navigate]`. Always copy the SPA callback pattern verbatim from `dashboard/src/routes/oauth.callback.tsx` or `workflow-studio/src/routes/oauth.callback.tsx`.

**Faster diagnosis**: open the browser MCP, navigate to the SPA, click sign-in, snapshot the page after the round-trip. You'll see the success banner flash and then the error replace it. Pure SPA-side bug.

---

## 9. `tsc -b` blocks the Docker build on pre-existing errors

**Symptom**: build was working, then someone introduces an implicit `any` somewhere, and now every Coolify deploy fails on TS errors that aren't related to runtime correctness.

**Fix**: the SPAs' `package.json` should use `"build": "vite build"` (no `tsc -b`). Add a separate `"typecheck": "tsc -b --noEmit"` for local CI use. Vite/esbuild strips types — type-check separately, don't gate deploys on it. Already applied to dashboard and workflow-studio in commit `95c2b9f5`.

---

## 10. The token-override input is gone after a SPA "redeploy"

**Symptom**: dashboard's `/login` previously had a "Enter admin token" emergency input. It disappears after a deploy.

**Root cause** (most common): the SPA didn't actually redeploy — Coolify build failed silently. The user is still seeing an OLD bundle that pre-dated the override feature, or the override is hidden behind a button (`Enter admin token` → reveals the input). See Gotcha 2.

**Less common**: the feature was actually removed in a refactor. Check `dashboard/src/features/auth/login.tsx` for the `Enter admin token` button — if it's there in main, the running prod is stale.

---

## 11. Localhost dev round-trips through PROD instead of local

**Symptom**: `uv run` aidream on `http://localhost:8000`, `pnpm dev` workflow-studio on `http://localhost:3101`, click "Sign in with Matrx". The Matrx consent page appears (so the authorize step worked), but after clicking Approve the browser lands on `https://server.app.matrxserver.com/login?error=OAuth%20state%20missing%20or%20expired...` instead of returning to localhost.

**Root cause**: the OAuth `redirect_uri` we send to Supabase was always built from `AIMATRX_AIDREAM_REDIRECT_URI`, which is set to the prod domain. Supabase, after consent, redirects to the *prod* `/auth/callback`. The prod process has no record of the local in-memory state, so it fails state lookup and bounces to `/login?error=...` — relative to its own host (prod), not the SPA's localhost origin.

**Fix**: `_build_callback_uri(request)` in `aidream/api/routers/auth.py` now branches on `request.url.hostname`:
- localhost / 127.0.0.1 / `::1` → derive `redirect_uri` from the incoming request (e.g. `http://localhost:8000/auth/callback`).
- anything else → `${AIMATRX_AIDREAM_REDIRECT_URI}/auth/callback` (prod path unchanged).

**Required one-time setup**: add `http://localhost:8000/auth/callback` to the allowed redirect URIs of OAuth client `867ea8ad-7eaa-4614-b866-ecaf72c52e14` in the Supabase OAuth client config. Without that, Supabase rejects the authorize step with `redirect_uri mismatch`.

**Reproduction with the fix**: hit `http://localhost:8000/auth/aimatrx?app_redirect=http://localhost:3101/oauth/callback` directly, complete consent, and confirm the browser lands at `http://localhost:3101/oauth/callback?access_token=...` rather than at the prod domain. FastAPI logs should show `[auth/callback] token exchange ok` from the *local* process.

---

## Quick log greps

```bash
# Find which container is running ai-dream-server
CONTAINER=$(docker ps --filter "name=j4sos40" --format "{{.Names}}" | head -1)

# All recent OAuth events
docker logs --since 10m "$CONTAINER" 2>&1 | grep -E "auth/callback|auth/aimatrx|FAIL:|token exchange|admin lookup|non-admin"

# Just failures
docker logs --since 1h "$CONTAINER" 2>&1 | grep -E "ERROR.*auth|FAIL:"

# Confirm secret env vars (lengths only — never echo values)
docker exec "$CONTAINER" sh -c 'echo "ID=${#AIMATRX_OAUTH_CLIENT_ID} REDIRECT=$AIMATRX_AIDREAM_REDIRECT_URI"'
```
