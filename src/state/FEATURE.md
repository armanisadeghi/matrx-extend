# Extension preferences

User-facing preferences are persisted in `chrome.storage.local` through the Zustand adapter.

## Privacy defaults

A fresh install must not capture page content in the background. `scrapeAutoOnLoad` defaults to `false`; the user may enable it explicitly in Settings. Direct actions such as Capture, Data extraction, SEO audit, and a sent chat message may read the active page because the user initiated that feature.

Changing a privacy default requires updating the Chrome Web Store disclosures, the public privacy policy, and the matching recipe in `docs/feature-tests.md` in the same release.

## Default Chat target

A fresh install persists the UI reference
`mandate:chat.default_new_chat`, never an Agent UUID. Execution routes the
corresponding Mandate key to aidream for principal-aware Holder resolution.
An existing user's explicit saved Agent selection remains valid.
