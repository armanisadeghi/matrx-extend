# Structured page data extraction

The Data surface extracts information already present on the active page. It supports JSON script payloads, JSON-formatted `window.*` assignments, metadata, tables, lists, and user-selected page elements.

## Security boundary

Page content is data, never executable extension code. Framework-state readers may parse strict JSON but must not call `eval`, `new Function`, or otherwise execute a page-provided string. A JavaScript object literal that is not valid JSON is skipped.

This boundary keeps the packaged extension deterministic under Manifest V3 and ensures the Chrome Web Store remote-code declaration remains truthful.

## Guest boundary

Guests may select fields and inspect the resulting selectors without an account. Saving and reusing an extraction pattern requires a signed-in user because saved patterns are durable account data. The Data surface must state that boundary before an attempted save and offer the normal sign-in action; it must never turn an expected guest boundary into a generic connection error.
