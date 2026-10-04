import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { click, evaluate } from './settings-panel-driver.mjs';

const source = await readFile(
  new URL('./profile-identity-employment-cases.mjs', import.meta.url),
  'utf8',
);
const body = source.slice(
  source.indexOf('async function toggle('),
  source.indexOf('async function ensureOpen('),
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const toggle = new AsyncFunction(
  'assert',
  'sectionState',
  'waitFor',
  'evaluate',
  'clickAt',
  'click',
  'panel',
  `${body}\nreturn toggle(panel, 'Billing address', true);`,
);

test('Billing reexpand uses a stable trusted pointer when its animated header moves', async () => {
  let expanded = false;
  let samples = 0;
  const panel = {
    async send(method, args) {
      if (method === 'Runtime.evaluate') {
        if (args.expression.includes('const kind = "section"')) {
          samples++;
          const x = samples < 3 ? 10 : 20;
          return {
            result: {
              value: {
                count: 1,
                matchedCount: 1,
                x,
                y: 12,
                hitTarget: true,
                animating: samples < 3,
                pointerDiagnostic: { selected_point_available: true },
              },
            },
          };
        }
        return { result: { value: { x: 10, y: 12 } } };
      }
      if (method === 'Input.dispatchMouseEvent' && args.type === 'mouseReleased' && args.x === 20)
        expanded = true;
      return {};
    },
  };
  const sectionState = async () => ({
    section_count: 1,
    expanded: String(expanded),
    hidden: String(!expanded),
    inert: !expanded,
  });
  const waitFor = async (_label, read, accept) => {
    for (let i = 0; i < 3; i++) {
      const value = await read();
      if (accept(value)) return value;
    }
    throw new Error('billing_reexpand_did_not_change');
  };
  const clickAt = async (target) => {
    await panel.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...target });
    await panel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target });
  };
  await toggle(assert, sectionState, waitFor, evaluate, clickAt, click, panel);
  assert.equal(expanded, true);
  assert.ok(samples >= 5, 'the real pointer driver must observe movement before clicking');
});
