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
let responseOrder = 'current-first';
let oldResponse = null;
let currentResponse = null;
let oldResponseAborted = false;
let oldResponseFinished = false;
let oldResponseReleased = false;
let oldReleasePrestate = null;
let oldReleaseOutcome = null;
let currentResponseSent = false;
let currentResponseFinished = false;
let currentResponseAborted = false;
let currentProbeFinished = false;
let recoveryEnabled = false;
let recoveryTargetFinished = false;
let manualPriorFinished = false;
let manualPendingResponse = null;
let manualPendingFinished = false;
let manualPendingAborted = false;
let manualReleasePrestate = null;
let priorSavedResponse = null;
let priorSavedFinished = false;
let priorSavedAborted = false;
let priorSavedReleasePrestate = null;
let priorSavedFirstFinished = false;
let priorSavedSecondFinished = false;
const responseFinishOrder = [];
const racePayload = (document) => ({
  events: [{ eventName: document === 'current' ? 'Canyon Frequency' : 'Moonlit Transit' }],
  document,
});
const racePage = (generation) => `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Harborline Live — Document replay</title><h1>Document replay</h1>
<p id="phase">${generation}</p><output id="result">Waiting for the event schedule</output>
${generation === 'old' ? '<button id="manual-prior-request" type="button">Load prior event schedule</button><output id="manual-prior-result">Waiting for manual request</output><button id="manual-pending-request" type="button">Load delayed prior schedule</button>' : ''}
<script>
${generation === 'old' ? "document.querySelector('#manual-prior-request').addEventListener('click', async () => { const response = await fetch('/api/document-race', { headers: { 'X-D47-Manual-Observation': '1' }, cache: 'no-store' }); const data = await response.json(); document.querySelector('#manual-prior-result').textContent = data.events[0].eventName; });" : ''}
${generation === 'old' ? "document.querySelector('#manual-pending-request').addEventListener('click', () => { void fetch('/api/document-race', { headers: { 'X-D47-Manual-Observation': 'pending' }, keepalive: true, cache: 'no-store' }).catch(() => undefined); });" : ''}
(async () => {
  ${generation === 'old' ? "await fetch('/api/race-warmup'); await fetch('/api/race-warmup');" : generation === 'stale-only' ? "await fetch('/api/race-warmup'); return;" : ''}
  try {
    const firstRequest = fetch('/api/document-race', { keepalive: true, cache: 'no-store' });
    ${generation === 'first-saved' ? "void fetch('/api/document-race', { headers: { 'X-D47-Prior-Saved': 'held' }, keepalive: true, cache: 'no-store' }).catch(() => undefined);" : ''}
    const response = await firstRequest;
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
  response_order: responseOrder,
  response_finish_order: [...responseFinishOrder],
  old_pending: Boolean(oldResponse && !oldResponseAborted && !oldResponseFinished),
  old_response_aborted: oldResponseAborted,
  old_response_finished: oldResponseFinished,
  old_response_released: oldResponseReleased,
  old_release_prestate: oldReleasePrestate,
  old_release_outcome: oldReleaseOutcome,
  current_response_sent: currentResponseSent,
  current_pending: Boolean(currentResponse && !currentResponseFinished && !currentResponseAborted),
  current_response_finished: currentResponseFinished,
  current_response_aborted: currentResponseAborted,
  current_probe_finished: currentProbeFinished,
  recovery_enabled: recoveryEnabled,
  recovery_target_finished: recoveryTargetFinished,
  manual_prior_finished: manualPriorFinished,
  manual_pending: Boolean(manualPendingResponse && !manualPendingFinished && !manualPendingAborted),
  manual_pending_finished: manualPendingFinished,
  manual_pending_aborted: manualPendingAborted,
  manual_release_prestate: manualReleasePrestate,
  prior_saved_pending: Boolean(priorSavedResponse && !priorSavedFinished && !priorSavedAborted),
  prior_saved_finished: priorSavedFinished,
  prior_saved_aborted: priorSavedAborted,
  prior_saved_release_prestate: priorSavedReleasePrestate,
  prior_saved_first_finished: priorSavedFirstFinished,
  prior_saved_second_finished: priorSavedSecondFinished,
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
    const requestedOrder = url.searchParams.get('response_order') ?? 'current-first';
    if (
      !['current-first', 'old-first', 'stale-only', 'manual-prior', 'prior-saved'].includes(
        requestedOrder,
      )
    )
      return response.writeHead(400).end('Unsupported response order.');
    racePhase = 'armed';
    responseOrder = requestedOrder;
    racePageLoads = 0;
    raceTargetRequests = 0;
    oldResponse = null;
    currentResponse = null;
    oldResponseAborted = false;
    oldResponseFinished = false;
    oldResponseReleased = false;
    oldReleasePrestate = null;
    oldReleaseOutcome = null;
    currentResponseSent = false;
    currentResponseFinished = false;
    currentResponseAborted = false;
    currentProbeFinished = false;
    recoveryEnabled = false;
    recoveryTargetFinished = false;
    manualPriorFinished = false;
    manualPendingResponse = null;
    manualPendingFinished = false;
    manualPendingAborted = false;
    manualReleasePrestate = null;
    priorSavedResponse = null;
    priorSavedFinished = false;
    priorSavedAborted = false;
    priorSavedReleasePrestate = null;
    priorSavedFirstFinished = false;
    priorSavedSecondFinished = false;
    responseFinishOrder.length = 0;
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
  if (url.pathname === '/control/document-race/recover') {
    if (
      responseOrder !== 'stale-only' ||
      !currentProbeFinished ||
      !oldResponseFinished ||
      raceTargetRequests !== 1 ||
      recoveryEnabled
    )
      return response.writeHead(409).end('Stale-only refusal prerequisites missing.');
    recoveryEnabled = true;
    racePhase = 'recovery';
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
    const newRequestReady =
      responseOrder === 'old-first'
        ? Boolean(currentResponse && !currentResponseAborted && racePageLoads >= 2)
        : responseOrder === 'stale-only'
          ? currentProbeFinished && racePageLoads >= 2 && raceTargetRequests === 1
          : currentResponseSent;
    if (!newRequestReady || !oldResponse) {
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
  if (url.pathname === '/control/document-race/release-manual') {
    manualReleasePrestate = !manualPendingResponse
      ? 'missing'
      : manualPendingAborted || manualPendingResponse.destroyed
        ? 'aborted'
        : manualPendingFinished
          ? 'finished'
          : 'pending';
    if (!currentResponseSent || manualReleasePrestate !== 'pending')
      return response.writeHead(409).end('Manual response is not pending after current response.');
    const finished = new Promise((resolveFinish) => {
      manualPendingResponse.once('finish', () => resolveFinish(true));
      manualPendingResponse.once('close', () =>
        resolveFinish(manualPendingResponse.writableFinished),
      );
    });
    manualPendingResponse
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(racePayload('prior')));
    if (!(await finished))
      return response.writeHead(409).end('Manual response closed before finish.');
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(raceStatus()));
    return;
  }
  if (url.pathname === '/control/document-race/release-prior-saved') {
    priorSavedReleasePrestate = !priorSavedResponse
      ? 'missing'
      : priorSavedAborted || priorSavedResponse.destroyed
        ? 'aborted'
        : priorSavedFinished
          ? 'finished'
          : 'pending';
    if (!priorSavedSecondFinished || priorSavedReleasePrestate !== 'pending')
      return response.writeHead(409).end('Prior saved response unavailable after second run.');
    const finished = new Promise((resolveFinish) => {
      priorSavedResponse.once('finish', () => resolveFinish(true));
      priorSavedResponse.once('close', () => resolveFinish(priorSavedResponse.writableFinished));
    });
    priorSavedResponse
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(racePayload('prior')));
    if (!(await finished)) return response.writeHead(409).end('Prior saved response closed.');
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(raceStatus()));
    return;
  }
  if (url.pathname === '/control/document-race/release-current') {
    if (
      responseOrder !== 'old-first' ||
      !oldResponseFinished ||
      !currentResponse ||
      currentResponseAborted ||
      currentResponseFinished
    )
      return response.writeHead(409).end('Current response is not ready for release.');
    const finished = new Promise((resolveFinish) => {
      currentResponse.once('finish', () => resolveFinish(true));
      currentResponse.once('close', () => resolveFinish(currentResponse.writableFinished));
    });
    currentResponseSent = true;
    currentResponse
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(racePayload('current')));
    if (!(await finished))
      return response.writeHead(409).end('Current response closed before finish.');
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(raceStatus()));
    return;
  }
  if (url.pathname === '/document-race/') {
    racePageLoads += 1;
    const generation =
      racePhase === 'seed'
        ? 'seed'
        : racePageLoads === 1
          ? 'old'
          : responseOrder === 'prior-saved' && racePageLoads === 2
            ? 'first-saved'
            : responseOrder === 'stale-only' && !recoveryEnabled
              ? 'stale-only'
              : 'current';
    response
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(racePage(generation));
    return;
  }
  if (url.pathname === '/api/race-warmup') {
    if (responseOrder === 'stale-only' && racePhase === 'armed' && racePageLoads >= 2)
      response.on('finish', () => {
        currentProbeFinished = true;
      });
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"warmup":true}');
    return;
  }
  if (url.pathname === '/api/document-race') {
    if (racePhase === 'armed' && responseOrder === 'prior-saved') {
      if (request.headers['x-d47-prior-saved'] === 'held') {
        priorSavedResponse = response;
        response.on('finish', () => {
          priorSavedFinished = true;
        });
        response.on('close', () => {
          if (!response.writableFinished) priorSavedAborted = true;
        });
        return;
      }
      raceTargetRequests += 1;
      if (raceTargetRequests === 1) {
        oldResponse = response;
        response.on('finish', () => {
          oldResponseFinished = true;
          responseFinishOrder.push('old');
        });
        response.on('close', () => {
          if (!response.writableFinished) oldResponseAborted = true;
        });
        return;
      }
      if (raceTargetRequests === 2) {
        currentResponseSent = true;
        currentResponseFinished = true;
        response.on('finish', () => {
          priorSavedFirstFinished = true;
          responseFinishOrder.push('first-saved');
        });
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(racePayload('current')));
        return;
      }
      if (raceTargetRequests === 3) {
        response.on('finish', () => {
          priorSavedSecondFinished = true;
          responseFinishOrder.push('second-saved');
        });
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ events: [{ eventName: 'Canyon Frequency' }], document: 'second' }));
        return;
      }
      return response.writeHead(409).end('Unexpected saved replay request.');
    }
    if (racePhase === 'armed' && request.headers['x-d47-manual-observation'] === 'pending') {
      manualPendingResponse = response;
      response.on('finish', () => {
        manualPendingFinished = true;
      });
      response.on('close', () => {
        if (!response.writableFinished) manualPendingAborted = true;
      });
      return;
    }
    if (racePhase === 'armed' && request.headers['x-d47-manual-observation'] === '1') {
      response.on('finish', () => {
        manualPriorFinished = true;
      });
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(racePayload('prior')));
      return;
    }
    raceTargetRequests += 1;
    if (racePhase === 'recovery' && responseOrder === 'stale-only') {
      response.on('finish', () => {
        recoveryTargetFinished = true;
      });
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(racePayload('current')));
      return;
    }
    if (racePhase === 'armed' && raceTargetRequests === 1) {
      oldResponse = response;
      response.on('finish', () => {
        if (oldResponse === response) {
          oldResponseFinished = true;
          responseFinishOrder.push('old');
        }
      });
      response.on('close', () => {
        if (oldResponse === response && !response.writableFinished) oldResponseAborted = true;
      });
      return;
    }
    if (racePhase === 'armed' && responseOrder === 'old-first' && raceTargetRequests === 2) {
      currentResponse = response;
      response.on('finish', () => {
        if (currentResponse === response) {
          currentResponseFinished = true;
          responseFinishOrder.push('current');
        }
      });
      response.on('close', () => {
        if (currentResponse === response && !response.writableFinished)
          currentResponseAborted = true;
      });
      return;
    }
    currentResponseSent = racePhase === 'armed';
    if (racePhase === 'armed')
      response.on('finish', () => {
        currentResponseFinished = true;
        responseFinishOrder.push('current');
      });
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
