# Arman Tasks — Matrx Extend

> Secrets, accounts, CDN, OS-only steps. Agents **ask you** when blocked here.
> Code work → `.matrx/AGENT_TASKS.md`. Discoveries → the repo defect ledger (if present).

---

## Active

### Upload Chrome Web Store build 0.2.6 (Vault management + Save-this-login prompt)
**Added 2026-08-26.** Everything else is done: `0.2.6` passed the full release battery, the
approval-risk gate is green (routine update — manifest identical to the approved `0.1.72`
surface), and the privacy policy with the Vault/save-prompt wording is verified live. The only
remaining steps need your authenticated Google session:

1. **Easiest:** open Chrome with the Claude extension signed in and tell any agent session to
   "finish the Store upload" — it will run the clean-profile test, upload, and submit
   (dashboard → publisher **Matrx** → item `hnfolienncfklkgmdjjmhhegglimlamg` only, never the
   duplicate draft).
2. Or do it yourself: https://chrome.google.com/webstore/devconsole → upload
   `.output/matrx-extend-0.2.6-store.zip`
   (SHA-256 `e35b40784b4eb0c303ec72ba6142da49304645b6264a958a5aaa4b681eb86674`) → Submit for
   review, automatic publication on.

Change notes to paste: "Vault: manage saved website logins in the side panel (edit, change
password, delete) and an optional signed-in prompt to save a login you just used. Bug fixes and
internal improvements. No permission changes."

After publication: update `config/chrome-web-store-approved-baseline.json` (version/commit) and
run the deferred `credential_login` DB-contract cutover — both are queued agent work, just say go.

## Done

_(none)_
