# Agent Tasks

Active worklist managed by agents. **See `AGENT_INSTRUCTIONS.md` for rules** — especially around task format, condensation, and the retention policy for completed tasks.

> Quick scan order for arriving agents:
> 1. **Needs Clarification** below (questions waiting on the user)
> 2. **Blocked** (waiting on external)
> 3. **Active** (`ready` and `in-progress`)
> 4. **Completed** (recent context, condensed — pruned weekly)

> **Highest TASK ID issued: TASK-012.** Never reuse or renumber — increment from here.

---

## Needs Clarification

_(none)_

---

## Blocked

_(none)_

## Active

### TASK-011: Vault management in the extension (edit / change password / delete)
- **Status:** ready
- **Created:** 2026-08-22
- **Source:** Arman — "the UI for updating the vault is in AI Matrx but not in the extension, which is where you'd actually be entering vault information."

**Goal**
The side-panel Vault tab can fully maintain a `website_login` item without bouncing to the web `/vault`: rename, edit login URLs / match mode / notes, **change a field value** (new password), add a field, and delete (or archive) the item. Sharing / transfer / ownership / attachments stay web-only (link-out remains).

**Why**
The extension is where the user is standing on the login page; today every edit is a tab switch. TASK-012's "update existing login" path also needs the change-value wrapper.

**Subtasks**
- [ ] `src/lib/api/routes/vault.ts`: add `updateVaultFieldValue(itemId, fieldId, value)` → `PUT /api/vault/items/{id}/fields/{fid}/value` (silent, plaintext-out-once like `createVaultItem`), `addVaultField` → `POST /items/{id}/fields`, `deleteVaultItem` → `DELETE /items/{id}`, `deleteVaultField` → `DELETE /items/{id}/fields/{fid}`. Check `aidream/aidream/api/routers/vault.py:255-364` for exact bodies + whether delete is soft (status) or hard.
- [ ] `useVault.ts`: `changeFieldValue`, `addField`, `removeItem` with the same generation-guarded list refresh `patchItem` uses.
- [ ] `VaultView.tsx` `ItemRow`: inline "Edit" (name, login URLs, match mode, notes) using the existing `VaultItemMetadataPatch`; `FieldRow`: "Change" → masked input → save (drop plaintext from state on resolve, same as `CreateLoginForm`); "Add field"; "Delete" with confirm. Gate every control on `item.capabilities.can_edit` / `can_manage`.
- [ ] Extend `tests/unit/vault-panel.test.ts` + the plaintext-egress greps (`tests/unit/credential-login-leak.test.ts` pattern) so a typed value can never reach a log / storage / store.
- [ ] `docs/feature-tests.md` + `docs/SYSTEM_STATE.md` § Vault ("field editing deliberately NOT rebuilt here" line becomes false — fix it). Update `common-docs/projects/credential-sharing-browser-login/HANDOFF.md` § C.1.

**Notes**
Server routes already exist for all of this; this is extension-only. Values travel OUT once over `silent:true` calls and are never logged; reveal stays through `transient-secret.ts`. Keep the web link-out for sharing/attachments — do not rebuild grants here.

### TASK-012: Auto-capture logins into the Vault (save / update prompt on login)
- **Status:** ready (depends on TASK-011 for the "update existing" path)
- **Created:** 2026-08-22
- **Source:** Arman — "when a user is logging into a website, they can activate our extension and have it capture and save the username and password… like LastPass… straight to our vault, or they can manually do/update it."

**Goal**
When the user submits a login form in a normal tab, the extension offers **Save to Matrx Vault** (new item) or **Update saved login** (a server-matched item for this origin exists and the password differs), or **Never for this site**. Confirming writes via the existing `createVaultItem` (new) / `updateVaultFieldValue` (update). Off by default? NO — on by default for signed-in users, with a Settings toggle; signed-out users see nothing (Vault is signed-in only by design). Fill stays as it is today (Vault tab → **Use here**) — no in-page autofill UI in this task.

**Subtasks**
- [ ] Detector in the persistent content bridge (`src/lib/content/bridge.ts`, already on `<all_urls>`, top frame only): find forms with an `input[type=password]` + a username-ish input (type email/text, autocomplete username/email); on `submit` / Enter / submit-button click snapshot `{ origin, username, password, form action scheme }`. Refuse GET forms and non-https origins via `isSafeDestination` / `isFillablePageUrl` from `src/lib/credentials/login-urls.ts` (one source of truth). Ignore `autocomplete="new-password"` pairs that look like registration unless two passwords match (v2).
- [ ] New channel pair in `src/lib/messaging/schemas.ts`: `CREDENTIAL_CAPTURE_CANDIDATE` (content → SW) / `…_DECISION` (SW ↔ UI). SW holds the candidate **in memory only**, per-tab, for ≤ a short TTL; never `chrome.storage`, never `log` (the stream/tool logs must see only origin + field keys). Drop on tab close / navigation settle.
- [ ] SW asks the server which existing items match the origin (`fetchBrowserLoginMatches`) to decide New vs Update; compares username only (never sends the password to decide).
- [ ] Prompt surface: (a) a small shadow-DOM in-page toast mounted by the content script ("Save login for {host} to Matrx Vault?  Save · Not now · Never for this site") — needed because `chrome.sidePanel.open` can't be opened from a submit without a user gesture; (b) the same candidate rendered as a card at the top of the Vault tab if the panel is open (reuse the `AgentCaptureCredentialCard` pattern: values stay in local state, write via vault routes, drop on unmount). Confirm → `createVaultItem({ definition_key: 'website_login', login_urls:[origin], browser_fill_enabled:true })` or `updateVaultFieldValue`.
- [ ] "Never for this site" + global on/off live in `src/lib/settings/persisted.ts` (origin list, NOT credentials). Settings toggle under the Vault/Privacy section.
- [ ] Tests: detector unit tests (fixture forms: one-step, two-step username→password, GET form refused, http refused, new-password registration ignored), SW candidate lifecycle (TTL, no persistence), plaintext-egress grep guard extended to the new files.
- [ ] Store: no manifest change (gate `scripts/check-cws-release-risk.mjs` should stay green). Refresh `docs/CWS_LISTING_DRAFT.md` privacy/description wording to mention saving logins to the user's own vault on request, and add a reviewer step; tag release with the `chrome-web-store-release` skill flow.
- [ ] `docs/feature-tests.md`, `docs/SYSTEM_STATE.md` § Vault, HANDOFF.md § C.1 ("Open & Fill/save") marked shipped for the save half.

**Notes**
Detection needs NO new permission: content script + `<all_urls>` host permission are already in the published surface; "Authentication information" is already a declared data category. The plaintext DOES transit the SW (same as `credential_login`'s materialize→fill path) — acceptable; the invariant is: no log, no storage, no store, no model context, no tool result. Consider firing the prompt only after the submit navigates/settles (LastPass-style) in a follow-up; v1 prompts on submit. Do not build a second matcher/encryption/write path — server routes only.


---

## Completed

> Per the retention policy in `AGENT_INSTRUCTIONS.md`, completed tasks older than
> one week are pruned to keep this list short. Full detail for every completed
> task lives in git history (commit messages + the code itself). Tasks completed
> **within the last week** stay here.

- [TASK-004] Cloud-sync guidance metadata — `wbx_guidance` table (applied + ledger-recorded), storage-layer push/delete, sign-in hydration (last-write-wins), round-trip unit tests. Guidance now follows the user across machines. 2026-06-10

_(older than the last week — see git history for the May 2026 batch: TASK-001 through TASK-010, voice/audio pipeline, receipts, Pilot, parallel-tab orchestration, screenshot history, tab-assignment, and the mic-permission UX work.)_
