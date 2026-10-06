import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const children: ReturnType<typeof spawn>[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
});

it('tears down when the fixture child exited before cleanup', async () => {
  await fixtureOrigin();
  const child = children.at(-1);
  expect(child).toBeDefined();
  if (!child) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
});

async function fixtureOrigin() {
  const child = spawn(
    process.execPath,
    [resolve(process.env.MATRX_D47_FIXTURE_SERVER ?? 'tests/fixtures/showcase-replay/serve.mjs')],
    {
      env: { ...process.env, SHOWCASE_FIXTURE_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);
  let output = '';
  const origin = await new Promise<string>((done, fail) => {
    const timeout = setTimeout(() => fail(new Error('Document-race fixture did not start')), 5_000);
    child.once('exit', () => fail(new Error('Document-race fixture exited before start')));
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Showcase fixture: (http:\/\/127\.0\.0\.1:\d+)\/calendar\//.exec(output);
      if (match?.[1]) {
        clearTimeout(timeout);
        done(match[1]);
      }
    });
  });
  return origin;
}

function get(url: string): Promise<{ status: number; text: string; json: () => unknown }> {
  return new Promise((done, fail) => {
    httpGet(url, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        text += chunk;
      });
      response.on('end', () =>
        done({
          status: response.statusCode ?? 0,
          text,
          json: () => JSON.parse(text),
        }),
      );
      response.on('error', fail);
    }).on('error', fail);
  });
}

it('holds the older identical request until after the current document has its result', async () => {
  const origin = await fixtureOrigin();
  const seed = (await get(`${origin}/document-race/`)).text;
  expect(seed).toContain('id="phase">seed');
  await get(`${origin}/control/document-race/arm`);
  const old = (await get(`${origin}/document-race/`)).text;
  expect(old).toContain('id="phase">old');
  expect(old.match(/race-warmup/g)).toHaveLength(2);
  const oldResult = get(`${origin}/api/document-race`);
  void oldResult.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ old_pending: true, target_requests: 1 });
  await expect(get(`${origin}/control/document-race/release-old`)).resolves.toHaveProperty(
    'status',
    409,
  );
  const current = (await get(`${origin}/document-race/`)).text;
  expect(current).toContain('id="phase">current');
  expect(current).not.toContain('race-warmup');
  const currentResult = (await get(`${origin}/api/document-race`)).json();
  expect(currentResult).toEqual({
    events: [{ eventName: 'Canyon Frequency' }],
    document: 'current',
  });
  const beforeRelease = (await get(`${origin}/control/document-race/status`)).json();
  expect(beforeRelease).toMatchObject({
    target_requests: 2,
    old_pending: true,
    current_response_sent: true,
    old_response_released: false,
  });
  const release = await get(`${origin}/control/document-race/release-old`);
  expect(release.status).toBe(200);
  const priorResult = (await oldResult).json();
  expect(priorResult).toEqual({
    events: [{ eventName: 'Moonlit Transit' }],
    document: 'prior',
  });
  const completed = (await get(`${origin}/control/document-race/status`)).json();
  expect(completed).toMatchObject({
    old_pending: false,
    old_response_aborted: false,
    old_response_finished: true,
    old_response_released: true,
    old_release_prestate: 'pending',
    old_release_outcome: 'server_finished',
  });
});

it('refuses release when the old client aborts before the server finishes its response', async () => {
  const origin = await fixtureOrigin();
  await get(`${origin}/control/document-race/arm`);
  await get(`${origin}/document-race/`);
  const oldRequest = httpGet(`${origin}/api/document-race`);
  oldRequest.on('error', () => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ old_pending: true, target_requests: 1 });
  oldRequest.destroy();
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({
      old_pending: false,
      old_response_aborted: true,
      old_response_finished: false,
    });
  await get(`${origin}/document-race/`);
  await get(`${origin}/api/document-race`);
  const release = await get(`${origin}/control/document-race/release-old`);
  expect(release.status).toBe(409);
  const status = (await get(`${origin}/control/document-race/status`)).json();
  expect(status).toMatchObject({
    current_response_sent: true,
    old_response_aborted: true,
    old_response_finished: false,
    old_response_released: false,
    old_release_prestate: 'aborted',
    old_release_outcome: 'refused_aborted',
  });
});
