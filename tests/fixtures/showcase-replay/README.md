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
