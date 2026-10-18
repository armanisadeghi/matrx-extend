import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main as runDriftCheck } from '../../scripts/check-tool-db-drift';

const diagnosticScript = resolve(__dirname, '../../scripts/release-tool-drift-diagnostics.mjs');

function diagnose(output: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tool-drift-diagnostic-'));
  try {
    const file = join(dir, 'gate.out');
    writeFileSync(file, output);
    return spawnSync(process.execPath, [diagnosticScript, file], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('hosted strict tool-drift diagnostics', () => {
  it('the real strict gate fails with a catalog-read category when both database paths fail', async () => {
    const originalFetch = globalThis.fetch;
    const originalArgv = process.argv;
    const names = [
      'WXT_SUPABASE_URL',
      'WXT_SUPABASE_PUBLISHABLE_KEY',
      'MATRX_SUPABASE_PROJECT_REF',
      'SUPABASE_ACCESS_TOKEN',
    ] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const output: string[] = [];
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation((message) => output.push(String(message)));
    try {
      process.argv = [...originalArgv, '--strict'];
      process.env.WXT_SUPABASE_URL = 'https://unavailable.invalid';
      process.env.WXT_SUPABASE_PUBLISHABLE_KEY = 'fixture-key';
      process.env.MATRX_SUPABASE_PROJECT_REF = 'abcdefghijklmnopqrst';
      process.env.SUPABASE_ACCESS_TOKEN = 'fixture-operator';
      globalThis.fetch = vi.fn(async () => new Response('unavailable', { status: 503 }));
      expect(await runDriftCheck()).toBe(3);
      expect(output).toContain('drift-check: verification unavailable (catalog-read)');
    } finally {
      globalThis.fetch = originalFetch;
      process.argv = originalArgv;
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      error.mockRestore();
    }
  });

  it.each([
    ['catalog-read', 'catalog-read'],
    ['server-contract', 'server-contract'],
    ['bundle-membership', 'bundle-membership'],
  ])('reports only the %s verification category', (input, expected) => {
    const output = diagnose(
      `drift-check: verification unavailable (${input})\nBearer PRIVATE_TOKEN\nhttps://private.invalid/path?key=PRIVATE_TOKEN\n`,
    );
    expect(output.status).toBe(0);
    expect(output.stdout).toBe(`tool-drift-verification=${expected}\n`);
    expect(output.stderr).toBe('');
  });

  it('does not treat unrecognized or spoofed text as a verification category', () => {
    for (const output of [
      'drift-check: verification unavailable (unexpected)\n',
      'prefix drift-check: verification unavailable (catalog-read)\n',
      'drift-check: verification unavailable (catalog-read) SECRET\n',
      'drift-check: verification unavailable (catalog-read)\ndrift-check: verification unavailable (server-contract)\n',
      'Bearer PRIVATE_TOKEN\n',
    ]) {
      const result = diagnose(output);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('tool-drift-verification=unknown\n');
      expect(result.stderr).toBe('');
    }
  });
});
