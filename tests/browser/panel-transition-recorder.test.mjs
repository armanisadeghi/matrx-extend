import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import {
  PRODUCTION_BACKEND_ORIGIN,
  observeMemberLogicalOrganizationGet,
} from './member-logical-org-proof.mjs';
import {
  classifyPanelTransition,
  startPanelTransitionRecorder,
  traceOrganizationPointers,
} from './panel-transition-recorder.mjs';
import {
  observeMemberExtensionIdentity,
  runMemberAuthBoundary,
} from './settings-member-auth-diagnostic.mjs';

const scrapeSource = await readFile(
  new URL('./scrape-guest-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const authSource = await readFile(
  new URL('./settings-native-auth-driver.mjs', import.meta.url),
  'utf8',
);
const browserSession = {
  send: async (method) => {
    assert.equal(method, 'Browser.getVersion');
    return { product: 'Chrome/fixture' };
  },
};
const evaluatePanel = async (panel, expression) =>
  (await panel.send('Runtime.evaluate', { expression })).result.value;

function fixture() {
  let tick = 0;
  let visibility = 'visible';
  const listeners = new Map();
  const context = createContext({
    window: {},
    chrome: { runtime: { id: 'fixture-extension' } },
    performance: { now: () => ++tick },
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
    },
  });
  const calls = [];
  const networkListeners = new Map();
  const panel = {
    on(event, listener) {
      const group = networkListeners.get(event) ?? new Set();
      group.add(listener);
      networkListeners.set(event, group);
      return () => group.delete(listener);
    },
    async send(method, args) {
      calls.push(method);
      if (method === 'Runtime.evaluate')
        return { result: { value: runInContext(args.expression, context) } };
      return { ok: true };
    },
  };
  return {
    panel,
    calls,
    listeners,
    emitNetwork(event, payload) {
      for (const listener of networkListeners.get(event) ?? []) listener(payload);
    },
    networkListenerCount() {
      return [...networkListeners.values()].reduce((count, group) => count + group.size, 0);
    },
    hide() {
      visibility = 'hidden';
      listeners.get('visibilitychange')?.();
    },
    hideWithoutEvent() {
      visibility = 'hidden';
    },
    corruptClock(value) {
      runInContext(`window.__matrxPanelTransitionRecorder.events[0].ms = ${value}`, context);
    },
  };
}

test('resource wait hidden event precedes organization entry with no pointer action', async () => {
  const env = fixture();
  const recorder = await startPanelTransitionRecorder(env.panel);
  await recorder.mark('before_health');
  env.hide();
  await recorder.mark('after_health');
  await recorder.mark('organization_entry');
  await recorder.mark('organization_skip');
  const result = await recorder.stop();
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.events.map(({ kind, visibility }) => [kind, visibility]))),
    [
      ['start', 'visible'],
      ['before_health', 'visible'],
      ['visibilitychange', 'hidden'],
      ['after_health', 'hidden'],
      ['organization_entry', 'hidden'],
      ['organization_skip', 'hidden'],
      ['stop', 'hidden'],
    ],
  );
  assert.deepEqual(
    Array.from(result.events, (event) => event.ms),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(result.status, 'measured');
  assert.equal(classifyPanelTransition(result), 'during_resource_wait');
  assert.equal(env.listeners.size, 0);
  assert.equal(env.calls.includes('Input.dispatchMouseEvent'), false);
});

test('actual pointer dispatch brackets hidden transition and strips input details', async () => {
  const env = fixture();
  const recorder = await startPanelTransitionRecorder(env.panel);
  await recorder.mark('after_health');
  await recorder.mark('organization_entry');
  await recorder.mark('organization_select');
  const instrumented = traceOrganizationPointers(env.panel, recorder);
  const originalSend = env.panel.send;
  env.panel.send = async (method, args) => {
    if (method === 'Input.dispatchMouseEvent') env.hide();
    return originalSend(method, args);
  };
  await instrumented.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 37,
    y: 59,
    privateIdentity: 'do-not-record',
  });
  const result = await recorder.stop();
  assert.deepEqual(JSON.parse(JSON.stringify(result.events.map((event) => event.kind))), [
    'start',
    'after_health',
    'organization_entry',
    'organization_select',
    'pointer_before',
    'visibilitychange',
    'pointer_after',
    'stop',
  ]);
  assert.equal(JSON.stringify(result).includes('do-not-record'), false);
  assert.equal(classifyPanelTransition(result), 'during_pointer_dispatch');
  assert.equal(JSON.stringify(result).includes('37'), false);
  assert.equal(env.listeners.size, 0);
});

test('immutable connection delegates with its original receiver and brackets only pointer dispatch', async () => {
  const env = fixture();
  const recorder = await startPanelTransitionRecorder(env.panel);
  const originalSend = env.panel.send;
  const calls = [];
  Object.defineProperty(env.panel, 'send', {
    value: async function (method, args) {
      assert.equal(this, env.panel);
      calls.push([method, args]);
      if (method === 'Input.dispatchMouseEvent' && args.type === 'mouseReleased')
        throw new Error('pointer transport error');
      if (method === 'Input.dispatchMouseEvent') env.hide();
      if (method === 'Input.dispatchKeyEvent') throw new Error('original transport error');
      return originalSend.call(this, method, args);
    },
    writable: false,
    configurable: false,
  });
  Object.defineProperty(env.panel, 'connectionId', {
    value() {
      assert.equal(this, env.panel);
      return 'panel-session';
    },
    writable: false,
    configurable: false,
  });
  Object.freeze(env.panel);
  const instrumented = traceOrganizationPointers(env.panel, recorder);
  assert.equal(instrumented.connectionId(), 'panel-session');
  assert.deepEqual(await instrumented.send('Page.enable', { enabled: true }), { ok: true });
  await assert.rejects(
    instrumented.send('Input.dispatchKeyEvent', { type: 'keyDown' }),
    /original transport error/,
  );
  await instrumented.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 37, y: 59 });
  await assert.rejects(
    instrumented.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 37, y: 59 }),
    /pointer transport error/,
  );
  const result = await recorder.stop();
  assert.deepEqual(
    calls.map(([method]) => method).filter((method) => method !== 'Runtime.evaluate'),
    [
      'Page.enable',
      'Input.dispatchKeyEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ],
  );
  assert.deepEqual(
    Array.from(result.events, (event) => event.kind),
    [
      'start',
      'pointer_before',
      'visibilitychange',
      'pointer_after',
      'pointer_before',
      'pointer_after',
      'stop',
    ],
  );
  assert.equal(classifyPanelTransition(result), 'during_pointer_dispatch');
  assert.equal(Object.getOwnPropertyDescriptor(env.panel, 'send').configurable, false);
});

test('lost renderer context is explicitly unavailable', async () => {
  const env = fixture();
  const recorder = await startPanelTransitionRecorder(env.panel);
  env.panel.send = async () => {
    throw new Error('private-url-or-identity');
  };
  assert.deepEqual(await recorder.stop(), { status: 'unavailable', events: [] });
  assert.equal(classifyPanelTransition({ status: 'unavailable', events: [] }), 'unmeasured');
  assert.equal(JSON.stringify(await recorder.stop()).includes('private'), false);
});

test('missed event or phase marker cannot claim a complete interval', async () => {
  const missedEvent = fixture();
  const first = await startPanelTransitionRecorder(missedEvent.panel);
  missedEvent.hideWithoutEvent();
  assert.equal(classifyPanelTransition(await first.stop()), 'unmeasured');

  const missedMarker = fixture();
  const second = await startPanelTransitionRecorder(missedMarker.panel);
  const send = missedMarker.panel.send;
  missedMarker.panel.send = async () => {
    throw new Error('private');
  };
  await second.mark('before_health');
  missedMarker.panel.send = send;
  assert.deepEqual(await second.stop(), { status: 'unavailable', events: [] });
  assert.equal(missedMarker.listeners.size, 0);

  const badClock = fixture();
  const third = await startPanelTransitionRecorder(badClock.panel);
  badClock.corruptClock('Infinity');
  assert.deepEqual(await third.stop(), { status: 'unavailable', events: [] });
  assert.equal(badClock.listeners.size, 0);

  const reversedClock = fixture();
  const fourth = await startPanelTransitionRecorder(reversedClock.panel);
  reversedClock.corruptClock('1000');
  assert.deepEqual(await fourth.stop(), { status: 'unavailable', events: [] });
  assert.equal(reversedClock.listeners.size, 0);

  const incompleteAuth = fixture();
  const fifth = await startPanelTransitionRecorder(incompleteAuth.panel, {
    requireAuthTrace: true,
  });
  await fifth.mark('auth_admin_before');
  assert.deepEqual(await fifth.stop(), { status: 'unavailable', events: [] });
  assert.equal(incompleteAuth.listeners.size, 0);
});

test('actual Scrape setup wires resource and organization pointer intervals to the real recorder', async () => {
  const start = scrapeSource.indexOf('exercisePanel: async ({');
  const end = scrapeSource.indexOf('        expectedIdentity =', start);
  assert.ok(start >= 0 && end > start, 'authenticated setup seam missing');
  const prefix = scrapeSource.slice(start + 'exercisePanel: '.length, end);
  const exercise = new Function(
    'startPanelTransitionRecorder',
    'traceOrganizationPointers',
    'classifyPanelTransition',
    'signInSettings',
    'selectRequiredSettingsOrganization',
    'selection',
    'requiredOrganizationName',
    'report',
    'assert',
    'REPO',
    'evaluate',
    `return (${prefix} } return report; });`,
  );
  for (const scenario of ['resource_wait', 'pointer_dispatch']) {
    const env = fixture();
    const report = {};
    let actions = 0;
    const run = exercise(
      startPanelTransitionRecorder,
      traceOrganizationPointers,
      classifyPanelTransition,
      async () => ({ mode: 'member', email: 'private@example.test', profileId: 'private-id' }),
      async ({ panel, onBranch, requiredOrganizationName: selectedName }) => {
        assert.equal(selectedName, 'Matrx Org');
        await onBranch(scenario === 'resource_wait' ? 'organization_skip' : 'organization_select');
        if (scenario === 'pointer_dispatch')
          await panel.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: 37,
            y: 59,
            privateIdentity: 'secret',
          });
        return { organizationId: 'private-org' };
      },
      { mode: 'admin' },
      'Matrx Org',
      report,
      assert,
      '',
      evaluatePanel,
    );
    const originalSend = env.panel.send;
    env.panel.send = async (method, args) => {
      if (scenario === 'pointer_dispatch' && method === 'Input.dispatchMouseEvent') env.hide();
      return originalSend(method, args);
    };
    if (scenario === 'pointer_dispatch') Object.freeze(env.panel);
    const result = await run({
      panel: env.panel,
      page: {},
      browserSession,
      observePanelVisibility: async () => {},
      observeAuthenticatedPanel: async () => {},
      requireResourceHealth: async () => {},
      resourceAction: async (action) => {
        actions += 1;
        if (scenario === 'resource_wait' && actions === 2) env.hide();
        return action();
      },
    });
    assert.equal(actions, 2);
    assert.equal(result.panel_transition.status, 'measured');
    assert.equal(
      result.panel_transition.interval,
      scenario === 'resource_wait' ? 'during_resource_wait' : 'during_pointer_dispatch',
    );
    assert.deepEqual(
      Array.from(result.panel_transition.events, (event) => event.kind),
      scenario === 'resource_wait'
        ? [
            'start',
            'before_health',
            'visibilitychange',
            'after_health',
            'organization_entry',
            'organization_skip',
            'after_organization',
            'stop',
          ]
        : [
            'start',
            'before_health',
            'after_health',
            'organization_entry',
            'organization_select',
            'pointer_before',
            'visibilitychange',
            'pointer_after',
            'after_organization',
            'stop',
          ],
    );
    assert.equal(env.listeners.size, 0);
    assert.equal(JSON.stringify(result.panel_transition).includes('private'), false);
    assert.equal(JSON.stringify(result.panel_transition).includes('37'), false);
  }
});

test('real Scrape auth caller records first member selection, skip, identity, and cleanup intervals', async () => {
  const start = scrapeSource.indexOf('exercisePanel: async ({');
  const end = scrapeSource.indexOf('        expectedIdentity =', start);
  assert.ok(start >= 0 && end > start, 'authenticated setup seam missing');
  const prefix = scrapeSource.slice(start + 'exercisePanel: '.length, end);
  const authBody = authSource
    .slice(authSource.indexOf('export async function signInSettings('))
    .replace('export async function', 'async function');
  const organizationResolutionSource = authSource
    .slice(
      authSource.indexOf('export function resolveMemberOrganizationSelection('),
      authSource.indexOf('async function privateJson('),
    )
    .replace('export function', 'function');
  assert.match(
    organizationResolutionSource,
    /^function resolveMemberOrganizationSelection\(/,
    'real organization resolution helper seam missing',
  );
  const selectSource = authSource
    .slice(
      authSource.indexOf('export async function waitForOrganizationOption('),
      authSource.indexOf('/** Select and verify'),
    )
    .replaceAll('export async function', 'async function');
  const runSetup = (source, signInSettings, report) =>
    new Function(
      'startPanelTransitionRecorder',
      'traceOrganizationPointers',
      'classifyPanelTransition',
      'signInSettings',
      'selectRequiredSettingsOrganization',
      'selection',
      'requiredOrganizationName',
      'report',
      'assert',
      'REPO',
      'evaluate',
      `return (${source} } return report; });`,
    )(
      startPanelTransitionRecorder,
      traceOrganizationPointers,
      classifyPanelTransition,
      signInSettings,
      async () => ({ organizationId: '123e4567-e89b-42d3-a456-426614174001' }),
      { mode: 'member' },
      undefined,
      report,
      assert,
      '',
      evaluatePanel,
    );

  async function scenario(
    selectionRequired,
    source = prefix,
    failAdmin = false,
    proofOrganizationId = '123e4567-e89b-42d3-a456-426614174001',
  ) {
    const env = fixture();
    let selected = !selectionRequired;
    let cleanup = 0;
    const inputs = [];
    const originalSend = env.panel.send;
    Object.defineProperty(env.panel, 'send', {
      value: async function (method, args) {
        assert.equal(this, env.panel);
        if (method === 'Input.dispatchMouseEvent') {
          inputs.push(args.type);
          if (args.type === 'mouseReleased') selected = true;
        }
        return originalSend.call(this, method, args);
      },
      writable: false,
      configurable: false,
    });
    Object.freeze(env.panel);
    const identity = { userId: '123e4567-e89b-42d3-a456-426614174000', email: 'member@matrx.test' };
    const organizationId = '123e4567-e89b-42d3-a456-426614174001';
    const proofActions = [];
    const accountIdentity = async () => ({
      signInEnabled: true,
      emailMatches: true,
      profileId: identity.userId,
      accessTokenPresent: true,
      signOutVisible: true,
      isAdmin: false,
      adminRole: false,
      organizationSelected: selected,
      organizationPickerAvailable: true,
      organizationLabel: selected ? "Matrx's Org" : null,
    });
    const deps = {
      assert,
      URL,
      ORIGIN: 'https://www.aimatrx.com',
      MEMBER_FINGERPRINT: '',
      MEMBER_TEST_ORGANIZATION_NAME: "Matrx's Org",
      UUID: /^[0-9a-f-]{36}$/,
      fingerprint: () => 'opaque',
      privateJson: async () => ({
        action_link: 'https://www.aimatrx.com/auth/confirm?type=magiclink&token_hash=opaque',
        email: identity.email,
      }),
      requireSettingsCredential: (_mode, raw) => JSON.parse(raw),
      authenticatedWebIdentity: async () => identity,
      waitFor: async (label, read, accept) => {
        let value;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          value = await read();
          if (accept(value)) return value;
        }
        assert.ok(accept(value), `${label}_rejected`);
        return value;
      },
      click: async (panel, kind) => {
        if (kind === 'organization' || kind === 'title' || kind === 'button') return;
        assert.equal(kind, 'organization-option');
        await panel.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 97, y: 83 });
        await panel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 97, y: 83 });
      },
      openSection: async () => {},
      approveConsent: async () => {},
      evaluate: async () => ({ x: 97, y: 83 }),
      observeOrganizationOption: async () => ({
        menu_open: true,
        visible_option_count: 1,
        exact_match_count: 1,
        point: { x: 97, y: 83 },
        candidate: { x: 97, y: 83 },
      }),
      accountIdentity,
      panelIdentity: async () => ({
        profileId: identity.userId,
        organizationId,
        organizationName: "Matrx's Org",
      }),
      verifyCurrentSettingsIdentity: async ({ panel }) => {
        await panel.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: 97,
          y: 83,
          privateIdentity: 'do-not-record',
        });
        return { rendered: true };
      },
      observeCanonicalAdminCheck: () => ({
        start: async () => {},
        verify: async () => {
          if (failAdmin) throw new Error('admin observer failed');
          return { checked: true };
        },
        stop: async () => {
          cleanup += 1;
        },
      }),
      supabaseOrigin: async () => '',
      selectOrganization: null,
      signInAdminSettings: async () => identity,
      observeMemberExtensionIdentity,
      runMemberAuthBoundary,
      requireProductionBackendOrigin: async () => PRODUCTION_BACKEND_ORIGIN,
      observeMemberLogicalOrganizationGet: (panel, expected, origin) => {
        assert.equal(expected, organizationId);
        assert.equal(origin, PRODUCTION_BACKEND_ORIGIN);
        proofActions.push('observe');
        const observer = observeMemberLogicalOrganizationGet(panel, expected, origin);
        return {
          async start() {
            proofActions.push('start');
            await observer.start();
          },
          arm() {
            proofActions.push('arm');
            observer.arm();
          },
          async verify() {
            proofActions.push('verify');
            return observer.verify();
          },
          stop() {
            proofActions.push('stop');
            observer.stop();
          },
        };
      },
      refreshMemberLogicalOrganizationGet: async (_panel, observer) => {
        proofActions.push('refresh');
        observer.arm();
        const requestId = 'fresh-compute-read';
        env.emitNetwork('Network.requestWillBeSent', {
          requestId,
          request: {
            method: 'GET',
            url: `${PRODUCTION_BACKEND_ORIGIN}/api/compute-targets/`,
            headers: {
              Authorization: 'Bearer fixture-token',
              'X-Organization-Id': proofOrganizationId,
            },
          },
        });
        env.emitNetwork('Network.responseReceived', { requestId, response: { status: 200 } });
        env.emitNetwork('Network.loadingFinished', { requestId });
      },
    };
    deps.selectOrganization = new Function(
      ...Object.keys(deps),
      `${selectSource}; return selectOrganization;`,
    )(...Object.values(deps));
    const signInSettings = new Function(
      ...Object.keys(deps),
      `${organizationResolutionSource}; ${authBody}; return signInSettings;`,
    )(...Object.values(deps));
    const web = {
      goto: async (url) => {
        web.current = url;
      },
      url: () => web.current,
      close: async () => {},
    };
    const page = { context: () => ({ newPage: async () => web }), bringToFront: async () => {} };
    const report = {};
    const run = runSetup(source, signInSettings, report);
    const args = {
      panel: env.panel,
      page,
      browserSession,
      observePanelVisibility: async () => {},
      observeAuthenticatedPanel: async () => {},
      requireResourceHealth: async () => {},
      resourceAction: async (action) => action(),
    };
    try {
      if (failAdmin)
        await assert.rejects(run(args), (error) => {
          assert.equal(error.message, 'member_auth_boundary_failed');
          assert.equal(error.memberAuthBoundary, 'member_nonadmin_role_observation');
          assert.equal(error.memberAuthFailureCode, 'member_nonadmin_role_observation_failed');
          return true;
        });
      else await run(args);
    } finally {
      assert.equal(env.networkListenerCount(), 0, 'member logical-org observer must clean up');
    }
    return { report, inputs, cleanup, proofActions };
  }

  const selected = await scenario(true);
  assert.deepEqual(selected.proofActions, ['observe', 'start', 'refresh', 'arm', 'verify', 'stop']);
  const kinds = Array.from(selected.report.panel_transition.events, (event) => event.kind);
  assert.deepEqual(kinds.slice(0, 16), [
    'start',
    'auth_admin_before',
    'auth_admin_after',
    'auth_org_before',
    'auth_org_select',
    'pointer_before',
    'pointer_after',
    'pointer_before',
    'pointer_after',
    'auth_org_after',
    'auth_identity_before',
    'pointer_before',
    'pointer_after',
    'auth_identity_after',
    'auth_cleanup_before',
    'auth_cleanup_after',
  ]);
  assert.deepEqual(selected.inputs, ['mousePressed', 'mouseReleased', 'mouseMoved']);
  assert.equal(selected.cleanup, 1);
  assert.equal(JSON.stringify(selected.report.panel_transition).includes('do-not-record'), false);
  assert.equal(JSON.stringify(selected.report.panel_transition).includes('97'), false);
  const requireFirstAuthPointerCoverage = (result) => {
    assert.equal(
      result.report.panel_transition.events.filter((event) => event.kind === 'pointer_before')
        .length,
      3,
      'first auth organization and identity pointer inputs must reach the recorder',
    );
  };
  requireFirstAuthPointerCoverage(selected);

  const skipped = await scenario(false);
  const skipKinds = Array.from(skipped.report.panel_transition.events, (event) => event.kind);
  assert.ok(skipKinds.includes('auth_org_skip'));
  assert.equal(skipKinds.includes('auth_org_select'), false);
  assert.deepEqual(skipped.inputs, ['mouseMoved']);
  assert.equal(skipped.cleanup, 1);
  assert.deepEqual(skipped.proofActions, selected.proofActions);

  await assert.rejects(
    scenario(false, prefix, false, '123e4567-e89b-42d3-a456-426614174002'),
    (error) => {
      assert.equal(error.message, 'member_auth_boundary_failed');
      assert.equal(error.memberAuthBoundary, 'member_logical_organization_proof');
      assert.equal(
        error.memberAuthFailureCode,
        'member_logical_organization_proof_assertion_failed',
      );
      return true;
    },
  );

  const failed = await scenario(false, prefix, true);
  assert.equal(failed.report.panel_transition.status, 'unavailable');
  assert.equal(failed.report.panel_transition.interval, 'unmeasured');
  assert.equal(failed.cleanup, 1);

  const omission = prefix.replace('panel: traceOrganizationPointers(panel, transition),', 'panel,');
  assert.notEqual(omission, prefix, 'first auth panel seam missing');
  const omitted = await scenario(true, omission);
  assert.deepEqual(omitted.inputs, selected.inputs, 'mutation must preserve actual inputs');
  assert.throws(
    () => requireFirstAuthPointerCoverage(omitted),
    /first auth organization and identity pointer inputs must reach the recorder/,
  );
});
