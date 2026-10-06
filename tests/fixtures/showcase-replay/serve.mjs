#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
/**
 * Local-only Showcase replay fixture server. No external requests or dependencies.
 * Serves realistic synthetic event pages and query-distinct network responses.
 */
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SHOWCASE_FIXTURE_PORT ?? 4179);
const pages = new Map([
  ['/calendar/', 'calendar/index.html'],
  ['/calendar/missing-root/', 'calendar/missing-root.html'],
  ['/search/', 'search/index.html'],
]);
// The seed page lets an operator save an exact Network recipe through the real
// extension before arming the two-document race. No extension event is forged.
let racePhase = 'seed';
let racePageLoads = 0;
let raceTargetRequests = 0;
let oldResponse = null;
let oldResponseAborted = false;
let oldResponseFinished = false;
let oldResponseReleased = false;
let oldReleasePrestate = null;
let oldReleaseOutcome = null;
let currentResponseSent = false;
const racePayload = (document) => ({
  events: [{ eventName: document === 'current' ? 'Canyon Frequency' : 'Moonlit Transit' }],
  document,
});
const racePage = (generation) => `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Harborline Live — Document replay</title><h1>Document replay</h1>
<p id="phase">${generation}</p><output id="result">Waiting for the event schedule</output>
<script>
(async () => {
  ${generation === 'old' ? "await fetch('/api/race-warmup'); await fetch('/api/race-warmup');" : ''}
  try {
    const response = await fetch('/api/document-race', { keepalive: true, cache: 'no-store' });
    const data = await response.json();
    document.querySelector('#result').textContent = data.events[0].eventName;
  } catch {
    document.querySelector('#result').textContent = 'Request ended during navigation';
  }
})();
</script></html>`;
const raceStatus = () => ({
  phase: racePhase,
  page_loads: racePageLoads,
  target_requests: raceTargetRequests,
  old_pending: Boolean(oldResponse && !oldResponseAborted && !oldResponseFinished),
  old_response_aborted: oldResponseAborted,
  old_response_finished: oldResponseFinished,
  old_response_released: oldResponseReleased,
  old_release_prestate: oldReleasePrestate,
  old_release_outcome: oldReleaseOutcome,
  current_response_sent: currentResponseSent,
});
const eventResponses = new Map([
  [
    '2026-10-16',
    {
      date: '2026-10-16',
      events: [
        {
          eventName: 'Moonlit Transit',
          showDate: '2026-10-16',
          doors: '8:00 PM',
          venue: 'Sagebrush Hall',
          ageRestriction: '21+',
        },
        {
          eventName: 'Velvet Current',
          showDate: '2026-10-16',
          doors: '9:15 PM',
          venue: 'Copperlight Pavilion',
          ageRestriction: '18+',
        },
      ],
    },
  ],
  [
    '2026-10-17',
    {
      date: '2026-10-17',
      events: [
        {
          eventName: 'Canyon Frequency',
          showDate: '2026-10-17',
          doors: '7:45 PM',
          venue: 'Mesa Lantern Room',
          ageRestriction: '21+',
        },
      ],
    },
  ],
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end('GET only');
    return;
  }

  if (url.pathname === '/control/document-race/arm') {
    racePhase = 'armed';
    racePageLoads = 0;
    raceTargetRequests = 0;
    oldResponse = null;
    oldResponseAborted = false;
    oldResponseFinished = false;
    oldResponseReleased = false;
    oldReleasePrestate = null;
    oldReleaseOutcome = null;
    currentResponseSent = false;
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(raceStatus()));
    return;
  }
  if (url.pathname === '/control/document-race/status') {
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(raceStatus()));
    return;
  }
  if (url.pathname === '/control/document-race/release-old') {
    oldReleasePrestate = !oldResponse
      ? 'missing'
      : oldResponseAborted || oldResponse.destroyed
        ? 'aborted'
        : oldResponseFinished
          ? 'finished'
          : 'pending';
    if (!currentResponseSent || !oldResponse) {
      oldReleaseOutcome = 'refused_not_ready';
      return response.writeHead(409).end('Release requires old and current requests.');
    }
    if (oldReleasePrestate !== 'pending') {
      oldReleaseOutcome = `refused_${oldReleasePrestate}`;
      return response.writeHead(409).end('Old response is no longer pending.');
    }
    const finished = new Promise((resolveFinish) => {
      oldResponse.once('finish', () => resolveFinish(true));
      oldResponse.once('close', () => resolveFinish(oldResponse.writableFinished));
    });
    oldResponse
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(racePayload('prior')));
    if (!(await finished)) {
      oldReleaseOutcome = 'failed_before_finish';
      return response.writeHead(409).end('Old response closed before the server finished it.');
    }
    oldResponseReleased = true;
    oldReleaseOutcome = 'server_finished';
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(raceStatus()));
    return;
  }
  if (url.pathname === '/document-race/') {
    racePageLoads += 1;
    const generation = racePhase === 'seed' ? 'seed' : racePageLoads === 1 ? 'old' : 'current';
    response
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(racePage(generation));
    return;
  }
  if (url.pathname === '/api/race-warmup') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"warmup":true}');
    return;
  }
  if (url.pathname === '/api/document-race') {
    raceTargetRequests += 1;
    if (racePhase === 'armed' && raceTargetRequests === 1) {
      oldResponse = response;
      response.on('finish', () => {
        if (oldResponse === response) oldResponseFinished = true;
      });
      response.on('close', () => {
        if (oldResponse === response && !response.writableFinished) oldResponseAborted = true;
      });
      return;
    }
    currentResponseSent = racePhase === 'armed';
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(racePayload('current')));
    return;
  }

  if (url.pathname === '/api/events') {
    const payload = eventResponses.get(url.searchParams.get('date') ?? '');
    if (!payload) {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'No fixture response for this date.' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
    return;
  }

  if (url.pathname === '/') {
    response.writeHead(302, { Location: '/calendar/' }).end();
    return;
  }

  const relativePath = pages.get(url.pathname);
  if (!relativePath) {
    response
      .writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Fixture route not found.');
    return;
  }

  const filePath = resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(400).end();
    return;
  }
  const contentType =
    extname(filePath) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream';
  try {
    const body = await readFile(filePath, 'utf8');
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`;
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(body.replaceAll('http://127.0.0.1:4179', origin));
  } catch {
    response
      .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Fixture file unavailable.');
  }
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  process.stdout.write(`Showcase fixture: http://127.0.0.1:${actualPort}/calendar/\n`);
});
