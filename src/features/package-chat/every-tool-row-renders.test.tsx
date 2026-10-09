import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * EVERY browser-tool row config this extension registers into the package chat is drawn through the package's
 * real row component in its three states (running, done, error), with args and results shaped like the real
 * payloads. Asserts, per state: the row draws visible text, nothing throws, the row never falls back to the
 * generic row while a config exists, and a shimmering running label never depends on host CSS (token-class
 * gradient, no `hsl(var(...))`, no host-defined animation). Snapshotted so a wording change is a visible diff.
 */
import { toolDisplayRegistry } from '@/features/chat/tool-display/registry';
import { CONFIGURED_ROW_NAMES } from '@/features/chat/tool-display/row-names';
import type { ToolLifecycleEntry } from '@ai-matrx/chat/agents/types/request.types';
import { toolRendererRegistry } from '@ai-matrx/chat/tool-call-visualization/registry/registry';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerExtensionToolRenderers } from './tool-renderers';

vi.mock('@ai-matrx/chat/tool-call-visualization/registry/GenericRenderer', () => ({
  GenericRenderer: () => <span data-generic-fallback>generic</span>,
}));

afterEach(cleanup);

// ─── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────
function fixtureValue(key: string): unknown {
  if (/url$/i.test(key)) return 'https://example.com/pricing';
  if (/^(x|y)$/.test(key)) return 120;
  if (/count|total|number|width|height|duration|timeout|index/i.test(key)) return 3;
  if (/selector/.test(key)) return '#checkout-submit';
  if (/^ref$/.test(key)) return 'ref_12';
  if (/query|text|question|reason|command|condition/.test(key)) return 'quarterly revenue report';
  if (/domain/.test(key)) return 'example.com';
  if (/title|subject|deck_name/.test(key)) return 'Pricing - Example';
  if (/status/.test(key)) return 'ok';
  return `sample ${key}`;
}

function setPath(root: Record<string, unknown>, parts: string[], leaf: unknown): void {
  let cur = root;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      cur[part] = leaf;
      return;
    }
    const next = cur[part];
    if (typeof next !== 'object' || next === null) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  });
}

/** Args/output built from the paths the config itself reads, so each fixture matches what the row looks up. */
function payloadsFor(cfgJson: string): {
  args: Record<string, unknown>;
  output: Record<string, unknown>;
} {
  const args: Record<string, unknown> = {};
  const output: Record<string, unknown> = {
    success: true,
    text: 'Quarterly revenue grew 12% on subscription renewals.',
    title: 'Pricing - Example',
    url: 'https://example.com/pricing',
    count: 3,
  };
  for (const [, root, rest] of cfgJson.matchAll(/"(args|output)(?:\.([A-Za-z0-9_.]+))?"/g)) {
    if (!rest) continue;
    const target = root === 'args' ? args : output;
    const parts = rest.split('.');
    if (parts[parts.length - 1] === 'length') {
      setPath(target, parts.slice(0, -1), [{ id: 1 }, { id: 2 }, { id: 3 }]);
    } else {
      setPath(target, parts, fixtureValue(parts[parts.length - 1]!));
    }
  }
  return { args, output };
}

/** The action names a mega-tool dispatches on, read from the extension's own verb tables. */
const TRANSFORMS_SOURCE = readFileSync(
  join(__dirname, '../chat/tool-display/registry-transforms.ts'),
  'utf8',
);
function actionsFor(tool: string): string[] {
  const table = `${tool.toUpperCase()}_VERBS_PAST`;
  const m = new RegExp(`const ${table}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(TRANSFORMS_SOURCE);
  const keys = m ? [...m[1]!.matchAll(/^\s*['"]?([a-z_]+)['"]?\s*:/gm)].map((k) => k[1]!) : [];
  return keys.length > 0 ? keys : ['list', 'get', 'search'];
}

const entryFor = (
  tool: string,
  status: 'started' | 'completed' | 'error',
  args: Record<string, unknown>,
  output: Record<string, unknown>,
): ToolLifecycleEntry =>
  ({
    callId: `call-${tool}`,
    toolName: tool,
    displayName: tool,
    status,
    arguments: args,
    startedAt: '2026-10-08T10:00:00.000Z',
    completedAt: status === 'started' ? null : '2026-10-08T10:00:02.000Z',
    latestMessage: status === 'started' ? 'Working on it' : null,
    latestData: null,
    result: status === 'completed' ? output : null,
    resultPreview: null,
    errorType: status === 'error' ? 'tool_error' : null,
    errorMessage: status === 'error' ? 'Tab 12 is not reachable' : null,
    isDelegated: false,
    events: [],
  }) as unknown as ToolLifecycleEntry;

async function draw(entry: ToolLifecycleEntry): Promise<HTMLElement> {
  const Inline = toolRendererRegistry[entry.toolName]!.InlineComponent;
  const view = render(<Inline entry={entry} />);
  // The row's chunk and the config load on a later tick.
  for (let i = 0; i < 40 && !(view.container.textContent ?? '').trim(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
  return view.container;
}

describe("every browser-tool row config draws through the package's row", () => {
  registerExtensionToolRenderers();

  it('covers every configured tool (94 at the time of writing, never fewer than the registry)', () => {
    expect(CONFIGURED_ROW_NAMES.length).toBeGreaterThanOrEqual(90);
  });

  it('draws visible text in the running, done and error states, never throws, never falls to the generic row', async () => {
    const snapshot: Record<string, Record<string, string>> = {};
    const problems: string[] = [];
    for (const tool of [...CONFIGURED_ROW_NAMES].sort()) {
      const cfgJson = JSON.stringify(toolDisplayRegistry[tool]);
      const { args, output } = payloadsFor(cfgJson);
      const actions = cfgJson.includes('args.action') ? actionsFor(tool) : [undefined];
      for (const action of actions) {
        const callArgs = action ? { ...args, action } : args;
        const key = action ? `${tool}:${action}` : tool;
        snapshot[key] = {};
        for (const status of ['started', 'completed', 'error'] as const) {
          const entry = entryFor(tool, status, callArgs, output);
          let container: HTMLElement;
          try {
            container = await draw(entry);
          } catch (e) {
            problems.push(`${key} ${status}: threw ${(e as Error).message}`);
            continue;
          }
          const text = (container.textContent ?? '').replace(/\d+ms$/, '').trim();
          snapshot[key]![status] = text;
          if (!text) problems.push(`${key} ${status}: no visible text`);
          if (container.querySelector('[data-generic-fallback]'))
            problems.push(`${key} ${status}: generic fallback`);
          for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
            if (/hsl\(\s*var\(/.test(el.getAttribute('style') ?? ''))
              problems.push(`${key} ${status}: hsl(var()) style`);
          }
          for (const el of container.querySelectorAll<HTMLElement>('[class]')) {
            if (/animate-(text-)?shimmer/.test(el.className))
              problems.push(`${key} ${status}: host-defined shimmer animation`);
            // Transparent text depends on a class the host's stylesheet must contain.
            if (/(^|\s)text-transparent(\s|$)/.test(el.className))
              problems.push(`${key} ${status}: class-based transparent text`);
          }
          // A shimmering label carries its gradient inline, from its own text colour.
          for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
            const style = el.getAttribute('style') ?? '';
            if (/text-fill-color:\s*transparent/.test(style) && !/gradient\([^)]*currentcolor/i.test(style))
              problems.push(`${key} ${status}: transparent text without an inline gradient`);
          }
          cleanup();
        }
      }
    }
    expect(problems).toEqual([]);
    expect(snapshot).toMatchSnapshot();
  }, 240_000);
});
