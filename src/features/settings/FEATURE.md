# Extension settings

The Settings surface exposes user-facing preferences and account state. Operational endpoint overrides and other sensitive diagnostics belong in the admin-gated Debug surface, not here.

## Invariants

- A fresh installation has automatic page capture off. The user must explicitly enable **Auto-scrape on load**.
- Guest account state is truthful: email renders as unavailable and the account action says **Sign in**. **Sign out** appears only when a user is authenticated.
- Settings that require an account must identify that boundary before making a request; an expected guest boundary must not become a generic connection error.
- Changing a privacy default requires updating the Chrome Web Store submission record, the extension privacy policy, and the relevant reviewer test in the same release.
- Privacy → "Offer to save logins to the Vault" (`captureLoginsEnabled`, default ON, signed-in only) gates the page-driven save prompt; "Never ask on these sites" lists the per-origin opt-outs (`src/lib/credentials/capture-settings.ts`) with **Ask again**. See `/Users/armanisadeghi/code/common-docs/systems/clients/extension/STATE.md` § Save this login?.
