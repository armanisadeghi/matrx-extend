# Structured page data extraction

The Data surface extracts information already present on the active page. It supports JSON script payloads, JSON-formatted `window.*` assignments, metadata, tables, lists, and user-selected page elements.

## Security boundary

Page content is data, never executable extension code. Framework-state readers may parse strict JSON but must not call `eval`, `new Function`, or otherwise execute a page-provided string. A JavaScript object literal that is not valid JSON is skipped.

This boundary keeps the packaged extension deterministic under Manifest V3 and ensures the Chrome Web Store remote-code declaration remains truthful.
