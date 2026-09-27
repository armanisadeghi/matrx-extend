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
    const origin = `http://127.0.0.1:${actualPort}`;
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
