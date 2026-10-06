# Showcase replay fixture

Controlled synthetic source for manual comparison of saved Showcase recipes. The business use case is an independent Las Vegas concert publisher checking its calendar and venue schedule. All acts, venues, and values below are fictional test data; this fixture is not customer evidence and does not replace real public-page acceptance.

Start it only under the coordinator's browser/resource permit:

```sh
node tests/fixtures/showcase-replay/serve.mjs
```

Open `http://127.0.0.1:4179/calendar/` (or set `SHOWCASE_FIXTURE_PORT` before launching if that port is occupied). The server binds loopback only and uses Node built-ins. It serves three same-host pages:

- `/calendar/` — three repeating Schema.org Event cards with nested detail lists, two distinguishable HTML tables, JSON-LD, Microdata, OpenGraph metadata, and buttons that fetch two same-path query variants.
- `/calendar/missing-root/` — `.event-card` elements remain, but the `#events` root is absent; this exposes document-wide fallback as unrelated output.
- `/search/` — alternate route with different `.event-card` values outside `#events`; route guidance and missing-root behavior can be checked on the same host.

Click “Load 16 October API result” and “Load 17 October API result” while Network capture is active. Both requests use `/api/events` but distinct `date` query values and visibly different payloads. The exact expected rows are fixed in `serve.mjs`:

- 16 October: Moonlit Transit / Sagebrush Hall / 8:00 PM; Velvet Current / Copperlight Pavilion / 9:15 PM.
- 17 October: Canyon Frequency / Mesa Lantern Room / 7:45 PM.

For repeatable UI comparisons, use `name`, `startDate`, `location.name`, `doors`, `ageRestriction`, table `event-schedule`, and table `venue-capacity`; compare actual field values after reopen/replay, not only row counts. Changing the display-list filter must not change the selected request. The two API URLs are deliberately query-distinguished on one pathname, so the default saved matcher can be checked against both.

No extension server, browser, API, or user account is started or contacted by this fixture. There is no AI/provider fixture here.

## D47 document replay boundary

This route supplies real same-URL HTTP responses for a native saved Network replay. It is a controlled local page, so it supplements the required public-site T57 acceptance. Run only under the campaign's coordinated browser permit on an exact development build. The extension still signs in through its real UI, saves the recipe to the real service, asks for debugger approval, and renders its real saved result.

1. Start this server and open `/document-race/` in the assigned Chrome tab. The `seed` page fetches `/api/document-race` immediately. In Showcase → Network, use **Capture page load**, approve, select this response, and save an exact Network recipe under the current host. Reopen it in Showcase → Patterns. Confirm the saved request is `GET /api/document-race` with no body.
2. Open `/control/document-race/arm` from the operator or a separate tab. Reload `/document-race/` once outside the extension. Wait until `/control/document-race/status` says `old_pending: true` and `target_requests: 1`. That old page makes two warmup fetches, then starts the held target as its third request. Keep the original target URL/method/body unchanged.
3. Run the saved recipe from Patterns and approve its real debugger card. Its reload serves the `current` page, which starts the same target as its first request. Wait for `current_response_sent: true` and `target_requests: 2`; then open `/control/document-race/release-old`. The server returns `Canyon Frequency` to the current page and `Moonlit Transit` to the prior request. The old release is refused with HTTP 409 before the current response is sent.
4. Capture the visible terminal saved-result row, recipe name, run outcome, page `#result`, server status, and exact artifact receipt/tree hash. A correct current result is `Canyon Frequency`; the old response must never replace it. Also record whether the old response socket closed before release. `old_response_closed: true` means Chrome canceled the old document's request; that run **does not** prove rejection of a delivered stale callback. A successful server write alone likewise does not prove a `Runtime.bindingCalled` event reached the extension.

The adversarial provenance branch is accepted only if a trusted observation establishes that the old response reached the capture boundary after the new document began, with its old execution-context identity and higher sequence, and the visible saved result still belongs to the current document. This fixture provides the real timing and colliding request identity, but cannot force a destroyed browser execution context to deliver a callback. If Chrome cancels it, record native lifecycle evidence and keep that branch unverified; use the existing controlled CDP regression as supporting source proof, never label it native proof.
