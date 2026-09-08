# Arman Tasks — Matrx Extend

> Secrets, accounts, CDN, OS-only steps. Agents **ask you** when blocked here.
> Code work → `.matrx/AGENT_TASKS.md`. Discoveries → the repo defect ledger (if present).

---

## Active

### Complete Google account recovery for the prepared 0.2.8 Store submission
**Updated 2026-09-08.** Agents completed the release work. `0.2.8` passed the full release
battery, its approval-risk gate is green (routine update — manifest surface identical to the
approved `0.1.72` baseline), and release commit `b0fad09` plus tag `v0.2.8` are on `origin/main`.
The exact Store artifact is `.output/matrx-extend-0.2.8-store.zip` with SHA-256
`dae6f7a5d1a7a66e202ae240e851b73a0571d12beffdcf0fd2fd3a308a94733e`.

The in-app Browser is positioned at Google's account-recovery gate for
`arman@armansadeghi.com`. The saved agent password is not current; Google offers only a recovery-
device approval or recovery-email code. Arman must complete that identity challenge once. The
agent then owns every remaining dashboard step: primary item `hnfolienncfklkgmdjjmhhegglimlamg`
only, upload the Store zip (never the local zip or duplicate draft), save change notes, and submit
with automatic publication.

Change notes to paste: "Vault: manage saved website logins in the side panel (edit, change
password, delete) and an optional signed-in prompt to save a login you just used. Bug fixes and
internal improvements. No permission changes."

After publication: update `config/chrome-web-store-approved-baseline.json` (version/commit) and
run the deferred `credential_login` DB-contract cutover — both are queued agent work, just say go.

## Done

_(none)_
