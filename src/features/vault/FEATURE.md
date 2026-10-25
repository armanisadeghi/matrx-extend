# Vault host mechanics

Product truth and acceptance: [Vault closeout register](../../../../aidream/common-docs/projects/credential-sharing-browser-login/REGISTER.md).

`VaultView` renders the shared `@ai-matrx/vault` workspace. `vault-confirmation-host.ts` mounts the
reviewed in-place controller over the generated primary-step-up operation and the canonical API
adapter. Source tests do not establish installed acceptance.

## In-place controller contract

- Reuse `createSupabaseIdentity` and the shared dialog. Each password/email attempt owns a new
  ephemeral auth client with persistence, auto-refresh and URL-session detection disabled.
  Never replace the extension's OAuth session, profile or refresh material with a proof session.
- `parent()` returns the verified current actor/session/org; null is definitive sign-out,
  while transient read failures throw. Transient failures retain a completed grant.
- `issueGrant` is the generated `account.primaryStepUpGrant` operation on the unchanged parent
  session. It must pin that parent and organization; the proof belongs in the body only.
- The host supplies shared session-only storage and one cross-context lock. All cache readers
  and writers use that lock. The canonical API awaits grant hydration, then rereads the pinned
  parent bearer before every protected dispatch and after a 401 refresh.
- A completed grant survives tab/panel disposal. `cancel()` invalidates unfinished attempts
  only. The server's fixed deadline and each action's effective org window remain authoritative.
- End an owned proof session before publishing its grant. Cleanup failure is an incident and
  failure, never success. After cancellation, the locked write restores the prior completed
  grant or removes its first entry without a fallible verification read.
- Expiry, definitive sign-out and identity/session/org changes invalidate mismatched grants.
  An old workspace cannot erase a newer identity's grant. Store no password, code, proof token
  or refresh material in the confirmation cache.

Installed first-confirmation/reuse/expiry/cancellation journeys remain M1 work in the register.
