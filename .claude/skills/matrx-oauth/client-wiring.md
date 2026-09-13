---
type: Reference
title: "matrx-oauth — client wiring"
description: "The client-side half of the Matrx OAuth flow: the required SPA /oauth/callback and /access-denied pattern, the Tauri desktop (matrx-local) public PKCE client, and the checklist for wiring OAuth into a new Matrx SPA; the skill sends you here when writing or fixing client-side OAuth code. Companion to the matrx-oauth skill."
tags: [matrx-oauth, skills, oauth, spa, tauri]
timestamp: 2026-09-10T00:00:00Z
---

# matrx-oauth — client wiring

## SPA callback (token storage)

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
    let cancelled = false;
    // Read ONCE from window.location.search, before replaceState clears it.
    // Do NOT use useSearch() — it's reactive and re-fires after replaceState.
    const intent = classifyCallback(window.location.search);

    // 🚨 REFUSAL COMES FIRST. A token in the address bar is a security defect,
    // never a sign-in: by the time you can read it, it has already reached
    // browser history, the Referer header and every proxy log on the way.
    if (intent.kind === "token-in-query") {
      scrubAddressBar();
      void reportTokenInQuery(API_BASE_URL, intent.params, "<app>/oauth/callback");
      setErrorMessage(TOKEN_IN_QUERY_MESSAGE);
      setStatus("error");
      return;
    }
    if (intent.kind === "error") { setErrorMessage(intent.message); setStatus("error"); return; }
    if (intent.kind !== "handoff") { setErrorMessage("No sign-in code received."); setStatus("error"); return; }

    scrubAddressBar();
    void (async () => {
      try {
        const token = await exchangeHandoff(API_BASE_URL, intent.handoff);
        if (cancelled) return;
        setAuthToken(token);
        setStatus("success");
        setTimeout(() => void navigate({ to: "/", replace: true }), 600);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "Sign in could not be completed.");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]); // <-- only navigate; NEVER the search params here.

  // …status-driven UI omitted — see apps/dashboard or apps/workflow-studio for examples.
}
```

`classifyCallback` / `exchangeHandoff` / `reportTokenInQuery` / `scrubAddressBar` / `TOKEN_IN_QUERY_MESSAGE` are the ~60-line `src/lib/oauth-callback.ts` module each SPA carries verbatim (`aidream/apps/workflow-studio/src/lib/oauth-callback.ts` is the reference; `apps/dashboard` holds the identical twin). Copy it whole, with its test.

The matching `/access-denied` route just reads `?email=` and shows a friendly request-access screen with a `mailto:` link. See `aidream/apps/dashboard/src/routes/access-denied.tsx`.

## Tauri desktop (matrx-local)

`projects/matrx-local/desktop/src/lib/oauth.ts` is the canonical reference for a public PKCE client. Two key differences from the SPA flow:

- It hits `${SUPABASE_URL}/auth/v1/oauth/authorize` and `/oauth/token` **directly** (skips aimatrx.com). It doesn't need an admin gate.
- **Codex correction, 2026-09-12 (Vault Improvements): never encode the PKCE verifier in `state` or any authorization URL.** Desktop source now retains a local transaction and validates independent state plus the exact redirect before a single-use exchange. Local implementation: `matrx-local/app/api/FEATURE.md` section OAuth callback handling. Live native/web acceptance remains pending; the old URL-carried verifier guidance is withdrawn.

Don't copy matrx-local's flow into a SPA — the SPA pattern is intentionally different because the server-side admin gate has to live somewhere and we don't want every SPA reimplementing it.

## Wiring OAuth into a new Matrx SPA

Checklist. All steps are required. Skipping any of them produces one of the failure modes documented in the Debugging playbook in SKILL.md.

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
