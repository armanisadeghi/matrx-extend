import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
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

function get(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string; json: () => unknown }> {
  return new Promise((done, fail) => {
    httpGet(url, { headers }, (response) => {
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

it('manual old-page fetch completes without consuming the held replay request', async () => {
  const origin = await fixtureOrigin();
  const armed = await get(`${origin}/control/document-race/arm?response_order=manual-prior`);
  expect(armed.status).toBe(200);
  const oldPage = (await get(`${origin}/document-race/`)).text;
  expect(oldPage).toContain('id="manual-prior-request"');
  expect(oldPage).toContain(
    "fetch('/api/document-race', { headers: { 'X-D47-Manual-Observation': '1' }",
  );
  const held = get(`${origin}/api/document-race`);
  void held.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ old_pending: true, target_requests: 1, manual_prior_finished: false });
  const manual = await get(`${origin}/api/document-race`, { 'X-D47-Manual-Observation': '1' });
  expect(manual.json()).toEqual({ events: [{ eventName: 'Moonlit Transit' }], document: 'prior' });
  const after = (await get(`${origin}/control/document-race/status`)).json();
  expect(after).toMatchObject({
    old_pending: true,
    target_requests: 1,
    manual_prior_finished: true,
  });
  const pendingManual = get(`${origin}/api/document-race`, {
    'X-D47-Manual-Observation': 'pending',
  });
  void pendingManual.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ old_pending: true, manual_pending: true, target_requests: 1 });
  expect((await get(`${origin}/control/document-race/release-manual`)).status).toBe(409);
  await get(`${origin}/document-race/`);
  expect((await get(`${origin}/api/document-race`)).json()).toEqual({
    events: [{ eventName: 'Canyon Frequency' }],
    document: 'current',
  });
  expect((await get(`${origin}/control/document-race/release-manual`)).status).toBe(200);
  expect((await pendingManual).json()).toEqual({
    events: [{ eventName: 'Moonlit Transit' }],
    document: 'prior',
  });
  expect((await get(`${origin}/control/document-race/status`)).json()).toMatchObject({
    manual_pending_finished: true,
    target_requests: 2,
    old_pending: true,
  });
});

it('holds a real first saved-run request through a distinct second saved-run response', async () => {
  const origin = await fixtureOrigin();
  await get(`${origin}/document-race/`);
  expect((await get(`${origin}/control/document-race/arm?response_order=prior-saved`)).status).toBe(
    200,
  );
  expect((await get(`${origin}/document-race/`)).text).toContain('id="phase">old');
  const old = get(`${origin}/api/document-race`);
  void old.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ old_pending: true, target_requests: 1 });
  const firstPage = (await get(`${origin}/document-race/`)).text;
  expect(firstPage).toContain('id="phase">first-saved');
  expect(firstPage).toContain("'X-D47-Prior-Saved': 'held'");
  const held: ReturnType<typeof get>[] = [];
  expect(await executeFixturePage(firstPage, origin, held)).toBe('Canyon Frequency');
  expect(held).toHaveLength(1);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({
      prior_saved_first_finished: true,
      prior_saved_pending: true,
      target_requests: 2,
    });
  const arrival = (await get(`${origin}/control/document-race/status`)).json() as {
    prior_saved_held_arrival_order: number | null;
    prior_saved_first_finish_order: number | null;
  };
  expect(arrival.prior_saved_held_arrival_order).toBeTypeOf('number');
  expect(arrival.prior_saved_first_finish_order).toBeTypeOf('number');
  if (
    arrival.prior_saved_held_arrival_order === null ||
    arrival.prior_saved_first_finish_order === null
  )
    throw new Error('first_saved_arrival_order_missing');
  expect(arrival.prior_saved_held_arrival_order).toBeLessThan(
    arrival.prior_saved_first_finish_order,
  );
  expect((await get(`${origin}/control/document-race/release-prior-saved`)).status).toBe(409);
  expect((await get(`${origin}/document-race/`)).text).toContain('id="phase">current');
  const second = await get(`${origin}/api/document-race`);
  expect(second.json()).toEqual({
    events: [{ eventName: 'Silver Meridian' }],
    document: 'second',
  });
  expect((await get(`${origin}/control/document-race/release-prior-saved`)).status).toBe(200);
  const heldResponse = held[0];
  if (!heldResponse) throw new Error('held_first_saved_request_missing');
  expect((await heldResponse).json()).toEqual({
    events: [{ eventName: 'Moonlit Transit' }],
    document: 'prior',
  });
  expect((await get(`${origin}/control/document-race/status`)).json()).toMatchObject({
    prior_saved_first_finished: true,
    prior_saved_second_finished: true,
    prior_saved_finished: true,
    target_requests: 3,
  });
});

it('receives the held first-run request before finishing the first saved response', async () => {
  const origin = await fixtureOrigin();
  await get(`${origin}/document-race/`);
  await get(`${origin}/control/document-race/arm?response_order=prior-saved`);
  await get(`${origin}/document-race/`);
  const old = get(`${origin}/api/document-race`);
  void old.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ old_pending: true, target_requests: 1 });
  await get(`${origin}/document-race/`);
  const first = get(`${origin}/api/document-race`);
  void first.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ target_requests: 2 });
  expect((await get(`${origin}/control/document-race/status`)).json()).toMatchObject({
    prior_saved_first_pending: true,
    prior_saved_first_finished: false,
    prior_saved_held_arrival_order: null,
    prior_saved_first_finish_order: null,
  });
  const held = get(`${origin}/api/document-race`, { 'X-D47-Prior-Saved': 'held' });
  void held.catch(() => undefined);
  expect((await first).json()).toEqual({
    events: [{ eventName: 'Canyon Frequency' }],
    document: 'current',
  });
  const after = (await get(`${origin}/control/document-race/status`)).json() as {
    prior_saved_held_arrival_order: number;
    prior_saved_first_finish_order: number;
  };
  expect(after.prior_saved_held_arrival_order).toBeLessThan(after.prior_saved_first_finish_order);
});

async function executeFixturePage(
  html: string,
  origin: string,
  heldRequests: ReturnType<typeof get>[] = [],
) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(script).toBeTruthy();
  const result = { textContent: 'Waiting for the event schedule' };
  await runInNewContext(script ?? '', {
    fetch: async (path: string, options: { headers?: Record<string, string> } = {}) => {
      const response = get(`${origin}${path}`, options.headers);
      if (options.headers?.['X-D47-Prior-Saved'] === 'held') {
        void response.catch(() => undefined);
        heldRequests.push(response);
      }
      return { json: async () => (await response).json() };
    },
    document: { querySelector: () => result },
  });
  return result.textContent;
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

it('finishes a genuinely pending old response before releasing the held current response', async () => {
  const origin = await fixtureOrigin();
  const armed = await get(`${origin}/control/document-race/arm?response_order=old-first`);
  expect(armed.status).toBe(200);
  await get(`${origin}/document-race/`);
  const oldResult = get(`${origin}/api/document-race`);
  void oldResult.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ old_pending: true, target_requests: 1 });
  expect((await get(`${origin}/control/document-race/release-old`)).status).toBe(409);
  await get(`${origin}/document-race/`);
  const currentResult = get(`${origin}/api/document-race`);
  void currentResult.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({
      response_order: 'old-first',
      target_requests: 2,
      old_pending: true,
      current_pending: true,
      current_response_sent: false,
      response_finish_order: [],
    });
  expect((await get(`${origin}/control/document-race/release-current`)).status).toBe(409);
  const releaseOld = await get(`${origin}/control/document-race/release-old`);
  expect(releaseOld.status).toBe(200);
  expect((await oldResult).json()).toEqual({
    events: [{ eventName: 'Moonlit Transit' }],
    document: 'prior',
  });
  expect((await get(`${origin}/control/document-race/status`)).json()).toMatchObject({
    old_release_prestate: 'pending',
    old_response_finished: true,
    current_pending: true,
    current_response_sent: false,
    response_finish_order: ['old'],
  });
  const releaseCurrent = await get(`${origin}/control/document-race/release-current`);
  expect(releaseCurrent.status).toBe(200);
  expect((await currentResult).json()).toEqual({
    events: [{ eventName: 'Canyon Frequency' }],
    document: 'current',
  });
  expect((await get(`${origin}/control/document-race/status`)).json()).toMatchObject({
    old_response_aborted: false,
    current_response_finished: true,
    response_finish_order: ['old', 'current'],
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

it('keeps the saved target stale-only until refusal prerequisites allow a fresh recovery response', async () => {
  const origin = await fixtureOrigin();
  const armed = await get(`${origin}/control/document-race/arm?response_order=stale-only`);
  expect(armed.status).toBe(200);
  await get(`${origin}/document-race/`);
  const oldResult = get(`${origin}/api/document-race`);
  void oldResult.catch(() => undefined);
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ old_pending: true, target_requests: 1 });
  expect((await get(`${origin}/control/document-race/recover`)).status).toBe(409);
  const currentPage = (await get(`${origin}/document-race/`)).text;
  expect(currentPage).toContain('id="phase">stale-only');
  expect(await executeFixturePage(currentPage, origin)).toBe('Waiting for the event schedule');
  await expect
    .poll(async () => (await get(`${origin}/control/document-race/status`)).json())
    .toMatchObject({ current_probe_finished: true, target_requests: 1, old_pending: true });
  expect((await get(`${origin}/control/document-race/recover`)).status).toBe(409);
  expect((await get(`${origin}/control/document-race/release-old`)).status).toBe(200);
  expect((await oldResult).json()).toEqual({
    events: [{ eventName: 'Moonlit Transit' }],
    document: 'prior',
  });
  const stale = (await get(`${origin}/control/document-race/status`)).json();
  expect(stale).toMatchObject({
    target_requests: 1,
    response_finish_order: ['old'],
    recovery_enabled: false,
    recovery_target_finished: false,
  });
  expect((await get(`${origin}/control/document-race/recover`)).status).toBe(200);
  const recoveryPage = (await get(`${origin}/document-race/`)).text;
  expect(recoveryPage).toContain('id="phase">current');
  expect(await executeFixturePage(recoveryPage, origin)).toBe('Canyon Frequency');
  expect((await get(`${origin}/control/document-race/status`)).json()).toMatchObject({
    target_requests: 2,
    response_finish_order: ['old'],
    recovery_target_finished: true,
  });
});
