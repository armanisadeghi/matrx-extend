# Auth, Sessions, and Admin Gating

## OAuth 2.1 PKCE flow

Mirror of [matrx-local/desktop/src/lib/oauth.ts](../../matrx-local/desktop/src/lib/oauth.ts). Public PKCE client; talks directly to Supabase OAuth endpoints; Supabase renders the aimatrx.com-branded consent UI itself.

### Client registration (one-time, in Supabase dashboard)

- **Type**: Public Client (PKCE) — no client secret
- **Allowed redirect URI**: `https://<EXTENSION_ID>.chromiumapp.org/` — exactly, with trailing slash
- **Scopes**: `email profile` — never `openid` (HS256 project can't mint ID tokens)
- **Client ID**: `f0e5f5c2-ef0e-441e-b26f-1f0bf0be4131` (committed to `.env.development` / `.env.production`; not a secret)

The extension's stable ID `cihdmkcdjjckfhjpgoedmgfpoljebaml` is locked via the `key` field in `wxt.config.ts`, generated once by `node scripts/generate-extension-key.mjs`. The private key sits in `.secrets/matrx-extend.pem` (gitignored).

### Runtime steps (`src/lib/auth/flow.ts`)

```
signIn()
  1. generateCodeVerifier()        — 32 random bytes, base64url
  2. generateCodeChallenge(v)      — base64url(sha256(v))
  3. state = `${verifier}.${nonce}` — verifier travels in state to survive
                                      cross-origin redirects (matrx-local trick)
  4. authorize URL = `${SUPABASE_URL}/auth/v1/oauth/authorize?...`
  5. chrome.identity.launchWebAuthFlow({ url, interactive: true })
     → user signs in, sees aimatrx.com consent
     → Supabase redirects to https://<EXTENSION_ID>.chromiumapp.org/?code=…&state=…
  6. parseCallbackUrl()             — read code + state ONCE
  7. extractVerifierFromState(state) — split on first '.'
  8. POST `${SUPABASE_URL}/auth/v1/oauth/token`
        grant_type=authorization_code
        client_id=<EXTENSION_OAUTH_CLIENT_ID>
        code=<code>
        code_verifier=<verifier>
        redirect_uri=https://<EXTENSION_ID>.chromiumapp.org/
     ← { access_token, refresh_token, expires_in }
  9. persistTokens(tokens)
       chrome.storage.local:
         matrx.auth.accessToken     (plaintext — short-lived JWT)
         matrx.auth.refreshTokenEnc (AES-GCM ciphertext)
         matrx.auth.refreshTokenIv  (AES-GCM IV)
         matrx.auth.expiresAt
 10. scheduleRefresh(tokens)
       chrome.alarms.create('matrx.alarm.tokenRefresh',
                            { delayInMinutes: ~50 })
 11. fetchSupabaseUser(access_token)
       GET ${SUPABASE_URL}/auth/v1/user → user profile
 12. checkIsAdmin(user.id)
       SELECT user_id FROM public.admins WHERE user_id = $1
       → matrx.user.isAdmin (cached)
 13. broadcast(AUTH_STATE_CHANGED, { user, isAdmin })
 14. pingHealth('after sign-in')
```

### Hard-won facts

1. **Never send `client_secret`** — Supabase rejects with 400 for public PKCE clients.
2. **Never include `openid`** — Matrx Supabase signs JWTs HS256; openid asks for an asymmetric ID token → 500 "Error generating ID token".
3. **Supabase 4xx bodies are inconsistent** — try `error_description`, `error_message`, `msg`, `error`, `code` (in order) and always log truncated raw body for unknowns.
4. **Read callback URL once** — `chrome.identity.launchWebAuthFlow` resolves with the URL synchronously; reactive frameworks can re-read after `replaceState` and lose the token.
5. **`.gitignore` `lib/` rule** — pre-empted in our `.gitignore` with `!src/lib/**`. Run `git check-ignore -v <new-lib-file>` after creating one.

## Token storage at rest

| Token | Storage | Encryption |
|---|---|---|
| Access token (~1h JWT) | `chrome.storage.local['matrx.auth.accessToken']` | None — Chrome encrypts at rest, and tokens are short-lived |
| Refresh token | `chrome.storage.local` (`Enc` + `Iv` keys) | AES-GCM, key derived via PBKDF2(salt=`chrome.runtime.id`, 100k iterations, SHA-256) |
| Expiry | `chrome.storage.local['matrx.auth.expiresAt']` | None |

Encryption uses WebCrypto only. The derivation key is install-bound (changes if you reinstall) but doesn't require a user passphrase. `src/lib/auth/crypto.ts` has the helpers.

## Refresh strategy

`auth.autoRefreshToken: false` on the supabase-js client — its built-in refresher races with SW kill cycles.

Manual refresh in two places:

1. **Scheduled**: `chrome.alarms('matrx.alarm.tokenRefresh')` fires ~5 min before expiry. SW's alarm listener calls `refreshAccessToken()` → POST `/auth/v1/oauth/token` with `grant_type=refresh_token`.
2. **On 401**: `apiClient` catches a 401, calls `refreshAccessToken()`, retries once. Only one retry per request to avoid loops.

Concurrent refreshes are serialized through `refreshMutex` (`src/lib/utils.ts`) so we don't burn rate limits firing N parallel refreshes.

## Session restoration on context boot

Each surface (sidepanel, SW, offscreen, popup, options) gets its own `supabase-js` client because they're independent JS bundles. Each must call `restoreSupabaseSession()` on boot or RLS reads go anonymous (you'll see only `is_public = true` rows — the public agents).

Currently called from:
- **Sidepanel**: in `useAuth` mount effect (BEFORE the user state propagates, so feature views never run a query before the JWT lands)
- **SW**: in `bootstrapBackground()`

The offscreen doesn't run any RLS-gated queries directly, so it doesn't need restore. If we ever do, add it.

## Admin gating

```sql
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
```

`checkIsAdmin(userId)` runs a single SELECT — RLS allows users to read their own row.

The flag is cached in `chrome.storage.local['matrx.user.isAdmin']` so it's available synchronously to every context. `src/lib/debug/log.ts` populates a module-level `isAdminCached` from storage on load and listens for changes.

### Where it gates

| Surface | Gate |
|---|---|
| Debug tab visibility | `App.tsx` only renders the `<TabsTrigger value="debug">` and its `<TabsContent>` when `useAuth().isAdmin` is true |
| Cross-context log relay | `log.ts:emit()` only broadcasts to other surfaces when `isAdminCached === true`. Non-admin SW/offscreen still log to their own console; nothing leaks to the sidepanel. |
| (Future) "Advanced" UI toggles | Read `useAuth().isAdmin` directly |

### Admin lifecycle

- **First sign-in** as admin → `signIn()` calls `checkIsAdmin()`, stores `true`, broadcasts to all surfaces
- **Re-open extension** → `useAuth` mount effect reads cached `true` immediately, then re-checks in background to catch revocation
- **Admin removed mid-session** → background re-check sees `false`, updates storage, `chrome.storage.onChanged` fires, `log.ts` flips `isAdminCached`, Debug tab vanishes on next render
- **Sign-out** → flag cleared via `chrome.storage.local.remove(['matrx.user.isAdmin'])`

## Files

- [src/lib/auth/flow.ts](../src/lib/auth/flow.ts) — signIn, signOut, refresh, restoreSupabaseSession, getAccessToken
- [src/lib/auth/pkce.ts](../src/lib/auth/pkce.ts) — code_verifier / code_challenge helpers
- [src/lib/auth/crypto.ts](../src/lib/auth/crypto.ts) — AES-GCM encrypt/decrypt for refresh token
- [src/lib/auth/types.ts](../src/lib/auth/types.ts) — Zod schemas for OAuthTokens, UserProfile
- [src/lib/supabase/client.ts](../src/lib/supabase/client.ts) — supabase-js singleton
- [src/lib/supabase/queries.ts](../src/lib/supabase/queries.ts) — `checkIsAdmin`, `fetchUserAgents`, etc.
- [src/state/auth.ts](../src/state/auth.ts) — Zustand auth store with `isAdmin`
- [src/hooks/use-auth.ts](../src/hooks/use-auth.ts) — sidepanel-side hook that ties it all together
- [matrx-oauth/SKILL.md](../.claude/skills/matrx-oauth/SKILL.md) — full OAuth debugging playbook
