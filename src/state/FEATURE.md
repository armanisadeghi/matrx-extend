# Extension preferences

User-facing preferences are persisted in `chrome.storage.local` through the Zustand adapter.

## Privacy defaults

A fresh install must not capture page content in the background. `scrapeAutoOnLoad` defaults to `false`; the user may enable it explicitly in Settings. Direct actions such as Capture, Data extraction, SEO audit, and a sent chat message may read the active page because the user initiated that feature.

Changing a privacy default requires updating the Chrome Web Store disclosures, the public privacy policy, and the matching recipe in `docs/feature-tests.md` in the same release.
