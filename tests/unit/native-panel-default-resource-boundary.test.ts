// @vitest-environment node
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const harnessPath = resolve('tests/browser/native-sidepanel-qa-harness.mjs');
const { exerciseNativePanel, launchNativeBrowser } = await import(harnessPath);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function journalFixture() {
  const root = await mkdtemp(resolve('.output/native-default-guard-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const leaseRoot = join(root, 'lease');
  const policyDir = join(repo, 'docs/stabilization');
  const journalDir = join(policyDir, 'resource-journals');
  await mkdir(journalDir, { recursive: true });
  await mkdir(join(leaseRoot, 'heavy'), { recursive: true });
  const runId = 'native-default-composition';
  const nonce = 'owned-unit-journal';
  const stopFile = join(leaseRoot, `stop-${nonce}.json`);
  const now = Date.parse('2026-10-26T21:27:34.000Z');
  const sample = {
    pressureLevel: 1,
    availableMemoryGiB: 12,
    requiredMemoryGiB: 4,
    oneMinuteLoad: 1,
    logicalCpus: 4,
    cpuBusyFraction: 0.1,
    swapUsedMiB: 0,
    repoFreeGiB: 80,
    profileFreeGiB: 80,
    safetyFreeGiB: 80,
    systemFreeGiB: 80,
  };
  const event = (code: string, reasons: string[] = []) => ({
    schema: 1,
    runId,
    at: new Date(now).toISOString(),
    code,
    sample,
    reasons,
  });
  const rows = [event('RESOURCE_ADMITTED')];
  const journalPath = join(journalDir, `${runId}.pending.jsonl`);
  const publish = async () => {
    const staging = `${journalPath}.next`;
    await writeFile(staging, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    await rename(staging, journalPath);
  };
  await writeFile(
    join(policyDir, 'resource-policy.json'),
    JSON.stringify({
      watchIntervalSeconds: 1,
      unsafeSamplesToStop: 2,
      healthySamplesToResume: 3,
    }),
  );
  await writeFile(
    join(leaseRoot, 'heavy/owner.json'),
    JSON.stringify({ runId, nonce, kind: 'run' }),
  );
  await publish();
  return {
    options: {
      repo,
      leaseRoot,
      env: {
        MATRX_RESOURCE_RUN_ID: runId,
        MATRX_RESOURCE_OWNER: nonce,
        MATRX_RESOURCE_STOP_FILE: stopFile,
      },
      clock: () => now,
    },
    async pending() {
      rows.push(event('RESOURCE_CPU_PENDING', ['RESOURCE_CPU_BUSY']));
      await publish();
    },
    async recover() {
      rows.push(event('RESOURCE_CPU_RECOVERED'));
      await publish();
    },
    async stop() {
      await writeFile(stopFile, '{}');
    },
    async wrongOwner() {
      await writeFile(
        join(leaseRoot, 'heavy/owner.json'),
        JSON.stringify({ runId, nonce: 'another-owner', kind: 'run' }),
      );
    },
    async unsafe() {
      await writeFile(join(leaseRoot, 'unsafe-hold.json'), '{}');
    },
  };
}

function transport() {
  const sends: string[] = [];
  let detached = 0;
  const panel = Object.freeze({
    async send(method: string) {
      sends.push(method);
      return `forwarded:${method}`;
    },
    async detach() {
      detached++;
    },
  });
  return { panel, sends, detached: () => detached };
}

describe('actual native exercise callback composition with resourceAction omitted', () => {
  it('holds follow-up sends while pending, resumes only after recovery, and preserves healthy output', async () => {
    const fixture = await journalFixture();
    const wire = transport();
    await exerciseNativePanel({
      panel: wire.panel,
      resourceHealthOptions: fixture.options,
      createContext: (panel: unknown) => ({ panel }),
      exercisePanel: async ({ panel }: { panel: typeof wire.panel }) => {
        expect(await panel.send('Runtime.evaluate')).toBe('forwarded:Runtime.evaluate');
        await fixture.pending();
        let completed = false;
        const followup = panel.send('Input.dispatchKeyEvent').then((result: string) => {
          completed = true;
          return result;
        });
        await new Promise((done) => setTimeout(done, 150));
        try {
          expect(completed).toBe(false);
          expect(wire.sends).toEqual(['Runtime.evaluate']);
        } finally {
          await fixture.recover();
        }
        expect(await followup).toBe('forwarded:Input.dispatchKeyEvent');
      },
    });
    expect(wire.sends).toEqual(['Runtime.evaluate', 'Input.dispatchKeyEvent']);
    expect(wire.detached()).toBe(1);
  });

  it('refuses a stopped run before forwarding and still detaches the owned panel', async () => {
    const fixture = await journalFixture();
    const wire = transport();
    await fixture.stop();
    await expect(
      exerciseNativePanel({
        panel: wire.panel,
        resourceHealthOptions: fixture.options,
        createContext: (panel: unknown) => ({ panel }),
        exercisePanel: ({ panel }: { panel: typeof wire.panel }) => panel.send('Runtime.evaluate'),
      }),
    ).rejects.toThrow('NATIVE_RESOURCE_BOUNDARY_REFUSED:stop_requested');
    expect(wire.sends).toEqual([]);
    expect(wire.detached()).toBe(1);
  });
  it.each([
    'attachWorker',
    'attachOffscreen',
    'acquireLivePanel',
    'reloadExtension',
    'cycleOwnedPanel',
  ])('guards replacement and attached session from %s without a caller action', async (name) => {
    const fixture = await journalFixture();
    const root = transport();
    const attached = transport();
    await exerciseNativePanel({
      panel: root.panel,
      resourceHealthOptions: fixture.options,
      createContext: () => ({
        browserSession: root.panel,
        [name]: async () =>
          name === 'reloadExtension' || name === 'cycleOwnedPanel'
            ? { panel: attached.panel, lifecycle: true }
            : attached.panel,
      }),
      exercisePanel: async (
        context: { browserSession: typeof root.panel } & Record<string, unknown>,
      ) => {
        expect(await context.browserSession.send('Browser.getVersion')).toBe(
          'forwarded:Browser.getVersion',
        );
        const acquire = context[name] as () => Promise<
          typeof attached.panel | { panel: typeof attached.panel }
        >;
        const result = await acquire();
        const session = 'panel' in result ? result.panel : result;
        await fixture.stop();
        await expect(session.send('Runtime.evaluate')).rejects.toThrow('stop_requested');
      },
    });
    expect(attached.sends).toEqual([]);
    expect(root.sends).toEqual(['Browser.getVersion']);
    expect(root.detached()).toBe(1);
  });

  it.each([null, false])(
    'rejects an explicit falsey action %s without forwarding',
    async (action) => {
      const wire = transport();
      await expect(
        exerciseNativePanel({
          panel: wire.panel,
          resourceAction: action,
          createContext: () => ({}),
          exercisePanel: () => {
            throw new Error('must not execute');
          },
        }),
      ).rejects.toThrow('native_resource_action_invalid');
      expect(wire.sends).toEqual([]);
      expect(wire.detached()).toBe(1);
    },
  );

  it.each(['wrongOwner', 'unsafe'] as const)(
    'rejects %s evidence in the actual callback handoff',
    async (kind) => {
      const fixture = await journalFixture();
      const wire = transport();
      await fixture[kind]();
      await expect(
        exerciseNativePanel({
          panel: wire.panel,
          resourceHealthOptions: fixture.options,
          createContext: (panel: unknown) => ({ panel }),
          exercisePanel: ({ panel }: { panel: typeof wire.panel }) =>
            panel.send('Runtime.evaluate'),
        }),
      ).rejects.toThrow(kind === 'wrongOwner' ? 'wrong_run' : 'unsafe_hold');
      expect(wire.sends).toEqual([]);
      expect(wire.detached()).toBe(1);
    },
  );
  it('refuses stale health instead of forwarding a callback command', async () => {
    const fixture = await journalFixture();
    const wire = transport();
    const originalClock = fixture.options.clock;
    fixture.options.clock = () => originalClock() + 2000;
    await expect(
      exerciseNativePanel({
        panel: wire.panel,
        resourceHealthOptions: fixture.options,
        createContext: (panel: unknown) => ({ panel }),
        exercisePanel: ({ panel }: { panel: typeof wire.panel }) => panel.send('Runtime.evaluate'),
      }),
    ).rejects.toThrow('stale_health');
    expect(wire.sends).toEqual([]);
    expect(wire.detached()).toBe(1);
  });
});

describe('actual native Chrome launch composition with resourceAction omitted', () => {
  it('holds the actual spawn recorder while pending and returns its child only after recovery', async () => {
    const fixture = await journalFixture();
    await fixture.pending();
    const child = Object.freeze({ pid: 8765 });
    const spawned: (typeof child)[] = [];
    let completed = false;
    const starting = launchNativeBrowser({
      resourceHealthOptions: fixture.options,
      launch: () => {
        spawned.push(child);
        return child;
      },
    }).then((result: typeof child) => {
      completed = true;
      return result;
    });
    await new Promise((done) => setTimeout(done, 150));
    try {
      expect(completed).toBe(false);
      expect(spawned).toEqual([]);
    } finally {
      await fixture.recover();
    }
    expect(await starting).toBe(child);
    expect(spawned).toEqual([child]);
  });

  it('does not create a child when the run stopped before launch', async () => {
    const fixture = await journalFixture();
    await fixture.stop();
    const spawned: string[] = [];
    await expect(
      launchNativeBrowser({
        resourceHealthOptions: fixture.options,
        launch: () => {
          spawned.push('child');
          return { pid: 8765 };
        },
      }),
    ).rejects.toThrow('stop_requested');
    expect(spawned).toEqual([]);
  });
});
