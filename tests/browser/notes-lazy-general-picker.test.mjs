import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { runNotesLazyGeneralPicker } from './notes-find-native-case.mjs';

const organizationId = '4b190b81-7ea2-40e1-8d6d-87fa4b520dfc';
const origin = 'https://browser-contract.invalid';
const home = {
  organization_id: organizationId,
  organization_name: 'Harbor Dental',
  name: 'Intake',
  scope_id: null,
  is_general: true,
};

// An intake coordinator sees canonical General before any scope row exists.
// The real driver must read both doors before it can touch the Notes tab.
async function precondition(homes) {
  const calls = [];
  const panel = {
    on() {
      return () => {};
    },
    async send(method, args) {
      assert.equal(method, 'Runtime.evaluate', 'bad precondition must stop before UI input');
      const value = await runInNewContext(args.expression, {
        chrome: {
          storage: {
            local: {
              get: async () => ({
                'matrx.auth.accessToken': 'local-contract-token',
              }),
            },
          },
        },
        async fetch(url, options) {
          const door = url.slice(url.lastIndexOf('/') + 1);
          calls.push({
            door,
            method: options.method,
            organization: options.headers['X-Organization-Id'],
            schema: options.headers['Content-Profile'],
          });
          assert.ok(['context_tree', 'my_homes'].includes(door));
          return {
            status: 200,
            json: async () => (door === 'context_tree' ? { scopes: [], types: [] } : homes),
          };
        },
      });
      return { result: { value } };
    },
  };
  return {
    report: await runNotesLazyGeneralPicker({
      panel,
      origin,
      publishableKey: 'contract-public-key',
      selectedOrganizationId: organizationId,
    }),
    calls,
  };
}

test('D201 requires selected-org nullable canonical General; initialized and foreign homes refuse before UI', async () => {
  for (const homes of [
    [{ ...home, scope_id: 'b47fc412-46fb-43e5-a496-8ff73d85cc80' }],
    [{ ...home, organization_id: '6a70d8c9-d151-4ae0-8417-cc21bc20b928' }],
    [],
  ]) {
    const { report, calls } = await precondition(homes);
    assert.equal(report.verdict, 'unverified');
    assert.equal(report.failure_code, 'notes_lazy_general_precondition_missing');
    assert.deepEqual(
      calls.map(({ door }) => door),
      ['context_tree', 'my_homes'],
    );
    assert.ok(
      calls.every((call) => call.method === 'POST' && call.organization === organizationId),
    );
    assert.deepEqual(
      calls.map(({ schema }) => schema),
      ['custom', 'platform'],
    );
  }
});

test('D201 report never echoes an unexpected browser error into hosted evidence', async () => {
  const panel = {
    on() {
      return () => {};
    },
    async send() {
      throw new Error('private organization row and URL');
    },
  };
  const report = await runNotesLazyGeneralPicker({
    panel,
    origin,
    publishableKey: 'contract-public-key',
    selectedOrganizationId: organizationId,
  });
  assert.equal(report.verdict, 'unverified');
  assert.equal(report.failure_code, 'notes_lazy_general_unverified');
  assert.doesNotMatch(JSON.stringify(report), /private organization row and URL/);
});

// CDP and Supabase are external to the driver. The panel only advances its
// visible state after the driver's trusted native click sequence reaches it.
function workingPanel({
  writeOnSelect = false,
  initializeAfterPick = false,
  interceptionFailed = false,
} = {}) {
  const listeners = new Map();
  const calls = [];
  const state = { active: false, expanded: false, selected: false, target: null, reads: 0 };
  const label = 'Intake · Harbor Dental';
  const panel = {
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    async send(method, args) {
      if (method === 'Runtime.evaluate') {
        const expression = args.expression;
        if (expression.includes('await fetch(')) {
          const value = await runInNewContext(expression, {
            chrome: {
              storage: {
                local: {
                  get: async () => ({
                    'matrx.auth.accessToken': 'local-contract-token',
                  }),
                },
              },
            },
            async fetch(url, options) {
              const door = url.slice(url.lastIndexOf('/') + 1);
              calls.push({ door, method: options.method });
              listeners.get('Network.requestWillBeSent')?.({
                request: { url, method: options.method },
              });
              if (door === 'my_homes') state.reads += 1;
              return {
                status: 200,
                json: async () =>
                  door === 'context_tree'
                    ? { scopes: [], types: [] }
                    : [
                        {
                          ...home,
                          scope_id:
                            initializeAfterPick && state.reads > 1
                              ? 'b47fc412-46fb-43e5-a496-8ff73d85cc80'
                              : null,
                        },
                      ],
              };
            },
          });
          return { result: { value } };
        }
        if (expression.includes('const kind = ')) {
          const match = /const kind = "([^"]+)", label = "([^"]+)"/.exec(expression);
          assert.ok(match, 'trusted click must name its target');
          state.target =
            match[1] === 'title' && match[2] === 'Notes'
              ? 'notes-tab'
              : match[1] === 'button-text' && match[2] === 'All homes'
                ? 'picker-trigger'
                : null;
          assert.ok(state.target, `unexpected native click ${match[1]}`);
          return {
            result: { value: { count: 1, x: 10, y: 20, hitTarget: true, animating: false } },
          };
        }
        if (expression.includes('const candidates = [...(scope?.querySelectorAll(')) {
          assert.ok(state.active && state.expanded, 'option requires opened Notes picker');
          assert.match(expression, /div\.relative ul button/);
          assert.ok(expression.includes(JSON.stringify(label)));
          state.target = 'picker-option';
          return { result: { value: { count: 1, target: { x: 10, y: 20 } } } };
        }
        if (expression.includes('const search = root?.querySelector'))
          return {
            result: {
              value: {
                active: state.active,
                create: state.active,
                homeLabel: state.selected ? label : 'All homes',
                homeExpanded: state.expanded,
                homeOptions: state.expanded ? ['All homes', label] : [],
              },
            },
          };
        throw new Error('unrecognized CDP expression');
      }
      if (method === 'Input.dispatchMouseEvent') {
        if (args.type === 'mouseReleased') {
          if (state.target === 'notes-tab') state.active = true;
          else if (state.target === 'picker-trigger') state.expanded = true;
          else if (state.target === 'picker-option') {
            state.selected = true;
            state.expanded = false;
            if (writeOnSelect)
              listeners.get('Network.requestWillBeSent')?.({
                request: {
                  url: `${origin}/rest/v1/rpc/ensure_general_scope`,
                  method: 'POST',
                },
              });
          }
        }
        return {};
      }
      throw new Error(`unexpected CDP command ${method}`);
    },
  };
  const transport = { state: () => ({ blockedWrites: writeOnSelect ? 1 : 0, interceptionFailed }) };
  return { panel, transport, calls, state };
}

async function walkPicker(options) {
  const harness = workingPanel(options);
  const report = await runNotesLazyGeneralPicker({
    panel: harness.panel,
    transport: harness.transport,
    origin,
    publishableKey: 'contract-public-key',
    selectedOrganizationId: organizationId,
  });
  return { report, ...harness };
}

test('D201 valid lazy General reaches the native picker, selects its label, and rereads without writing', async () => {
  const { report, state, calls } = await walkPicker();
  assert.equal(report.verdict, 'pass', report.failure_code);
  assert.equal(state.selected, true);
  assert.deepEqual(
    calls.map(({ door }) => door),
    ['context_tree', 'my_homes', 'context_tree', 'my_homes'],
  );
  assert.ok(calls.every(({ method }) => method === 'POST'));
  assert.deepEqual(report.observations.picker, {
    synthetic_general_visible: true,
    selected_as_filter: true,
    selection_stable: true,
  });
  assert.equal(report.observations.after.unexpected_write_requests, 0);
});

test('D201 valid path refuses a write attempt, initialized after-state, and failed interception', async () => {
  for (const [options, expected] of [
    [{ writeOnSelect: true }, 'notes_lazy_general_unexpected_write_or_initialization'],
    [{ initializeAfterPick: true }, 'notes_lazy_general_precondition_missing'],
    [{ interceptionFailed: true }, 'notes_lazy_general_unexpected_write_or_initialization'],
  ]) {
    const { report, state } = await walkPicker(options);
    assert.equal(state.selected, true, 'scenario must reach the actual picker selection');
    assert.equal(report.verdict, 'unverified');
    assert.equal(report.failure_code, expected);
  }
});
