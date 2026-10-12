import assert from 'node:assert/strict';
import { nativeOAuthBearerExpression } from './native-oauth-session.mjs';
import { activeTabPanelExpression, evaluate, waitFor } from './settings-panel-driver.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOwnedDomainPatternRead(request, supabaseOrigin, host) {
  try {
    const url = new URL(request.url);
    return (
      url.origin === supabaseOrigin &&
      url.pathname === '/rest/v1/wbx_pattern' &&
      request.method === 'GET' &&
      url.searchParams.get('domain') === `eq.${host}`
    );
  } catch {
    return false;
  }
}

/** Read only the named, rendered Data card. Never infer a result from the hook store. */
export async function memberAutoCard(panel, patternName) {
  return evaluate(
    panel,
    `(() => {
      const root = ${activeTabPanelExpression('Data')};
      if (!root) return { active: false };
      const name = [...root.querySelectorAll('span')]
        .find((node) => node.textContent?.trim() === ${JSON.stringify(patternName)});
      let card = name;
      while (card && !card.classList?.contains('bg-emerald-500/10')) card = card.parentElement;
      if (!card) return { active: true, present: false };
      const text = card.textContent ?? '';
      const runningBadge = [...card.querySelectorAll('span')]
        .some((node) => node.textContent?.trim() === 'auto');
      const detail = name.parentElement?.nextElementSibling?.textContent?.trim() ?? '';
      const label = [...root.querySelectorAll('div')]
        .find((node) => /^Auto-extracted \\(\\d+ rows\\)$/.test(node.firstElementChild?.textContent?.trim() ?? ''));
      let rows = null;
      try { if (label) rows = JSON.parse(label.querySelector('pre')?.textContent ?? ''); } catch {}
      const action = [...card.querySelectorAll('button')].find((node) =>
        ['Extract', 'Re-run'].includes(node.textContent?.trim()));
      return {
        active: true,
        present: true,
        running: runningBadge,
        success: text.includes('auto · 1 rows'),
        noMatch: text.includes('auto · no match'),
        failed: text.includes('auto failed'),
        explanation: detail.includes('No matching data was found on this page.'),
        errorVisible: text.includes('auto failed') && detail.length > 0 && detail !== 'Matches this URL',
        manualAction: action?.textContent?.trim() ?? null,
        manualActionEnabled: Boolean(action && !action.disabled),
        rows,
      };
    })()`,
  );
}

/** Latch the real rendered running badge so a short state cannot fall between polls. */
export async function observeMemberAutoRunning(panel, patternName, operation = 'read') {
  const key = `Symbol.for('matrx.data-member-auto-running:${JSON.stringify(patternName)}')`;
  if (operation === 'install') {
    return evaluate(
      panel,
      `(() => {
        const key = ${key};
        const existing = window[key];
        existing?.observer?.disconnect();
        const state = { seen: false, lastRunning: false, observer: null };
        const readRunning = () => {
          const root = ${activeTabPanelExpression('Data')};
          if (!root) return false;
          const name = [...root.querySelectorAll('span')]
            .find((node) => node.textContent?.trim() === ${JSON.stringify(patternName)});
          let card = name;
          while (card && !card.classList?.contains('bg-emerald-500/10')) card = card.parentElement;
          return Boolean(card && [...card.querySelectorAll('span')]
            .some((node) => node.textContent?.trim() === 'auto'));
        };
        const inspect = () => {
          const running = readRunning();
          if (running && !state.lastRunning) state.seen = true;
          state.lastRunning = running;
        };
        state.observer = new MutationObserver(inspect);
        state.observer.observe(document.documentElement, {
          subtree: true, childList: true, characterData: true,
        });
        window[key] = state;
        state.lastRunning = readRunning();
        return { installed: true, seen: state.seen };
      })()`,
    );
  }
  if (operation === 'clear') {
    return evaluate(
      panel,
      `(() => {
        const key = ${key};
        const state = window[key];
        state?.observer?.disconnect();
        delete window[key];
        return Boolean(state);
      })()`,
    );
  }
  return evaluate(panel, `(() => ({ seen: window[${key}]?.seen === true }))()`);
}

/** Exact-row, signed-in DB probe for the disposable pattern created by the Data UI. */
export async function ownedPatternRootRequest({
  panel,
  patternId,
  organizationId,
  supabaseOrigin,
  publishableKey,
  method = 'GET',
  root,
}) {
  assert.match(patternId, UUID, 'data_member_auto_pattern_id_missing');
  assert.match(organizationId, UUID, 'data_member_auto_organization_missing');
  assert.equal(supabaseOrigin, 'https://db.matrxserver.com', 'data_member_auto_origin_refused');
  assert.match(
    publishableKey ?? '',
    /^sb_publishable_[A-Za-z0-9_-]+$/,
    'data_member_auto_key_refused',
  );
  const url = new URL('/rest/v1/wbx_pattern', supabaseOrigin);
  url.searchParams.set('id', `eq.${patternId}`);
  url.searchParams.set('organization_id', `eq.${organizationId}`);
  url.searchParams.set('select', 'id,organization_id,list_root_selector');
  const result = await evaluate(
    panel,
    `(async () => {
      const token = ${nativeOAuthBearerExpression};
      if (typeof token !== 'string' || !token) return { status: 0, rows: null };
      const response = await fetch(${JSON.stringify(url.toString())}, {
        method: ${JSON.stringify(method)},
        headers: {
          apikey: ${JSON.stringify(publishableKey)},
          Authorization: 'Bearer ' + token,
          'X-Organization-Id': ${JSON.stringify(organizationId)},
          'Content-Profile': 'extend',
          'Accept-Profile': 'extend',
          Prefer: 'return=representation',
          'Content-Type': 'application/json',
        },
        ${method === 'PATCH' ? `body: JSON.stringify({ list_root_selector: ${JSON.stringify(root)} }),` : ''}
      });
      const rows = await response.json().catch(() => null);
      return { status: response.status, rows: Array.isArray(rows) ? rows : null };
    })()`,
  );
  assert.equal(result?.status, 200, 'data_member_auto_pattern_request_failed');
  assert.equal(result?.rows?.length, 1, 'data_member_auto_pattern_row_count');
  assert.equal(result.rows[0]?.id, patternId, 'data_member_auto_pattern_id_mismatch');
  assert.equal(
    result.rows[0]?.organization_id,
    organizationId,
    'data_member_auto_pattern_organization_mismatch',
  );
  return result.rows[0].list_root_selector;
}

export async function runMemberAutoExtract({
  panel,
  page,
  resourceAction,
  patternName,
  patternId,
  organizationId,
  supabaseOrigin,
  publishableKey,
}) {
  const result = {
    running: 'unverified',
    success: 'unverified',
    no_match: 'unverified',
    error: 'unverified',
    manual_action: 'unverified',
    pattern_reads: [],
    original_root_read_verified: false,
    invalid_root_write_verified: false,
    original_root_restored: false,
  };
  const ownedRequest = (method, root) =>
    ownedPatternRootRequest({
      panel,
      patternId,
      organizationId,
      supabaseOrigin,
      publishableKey,
      method,
      root,
    });
  let originalRoot;
  let rootWriteStarted = false;
  let runningObserverInstalled = false;
  const requests = new Map();
  const host = new URL(page.url()).host;
  await panel.send('Network.enable');
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      if (isOwnedDomainPatternRead(request, supabaseOrigin, host)) {
        const authorization = Object.entries(request.headers ?? {}).find(
          ([key]) => key.toLowerCase() === 'authorization',
        )?.[1];
        requests.set(requestId, {
          signedIn: typeof authorization === 'string' && authorization.startsWith('Bearer '),
          status: null,
        });
      }
    } catch {}
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const entry = requests.get(requestId);
    if (entry) entry.status = response.status;
  });
  try {
    const origin = new URL(page.url()).origin;
    const open = async (variant) => {
      await resourceAction(() => page.goto(`${origin}/products?auto=${variant}`));
      assert.equal(new URL(page.url()).searchParams.get('auto'), variant);
    };
    await observeMemberAutoRunning(panel, patternName, 'install');
    runningObserverInstalled = true;
    await open('success');
    const success = await waitFor(
      'data_member_auto_success',
      () => memberAutoCard(panel, patternName),
      (state) => state?.success === true && Array.isArray(state.rows),
      12_000,
      (state) => ({ active: state?.active, present: state?.present, success: state?.success }),
    );
    assert.deepEqual(
      success.rows,
      [{ field_1: 'Cedar chair', field_2: '$429' }],
      'data_member_auto_success_rows_mismatch',
    );
    result.success = 'pass';
    if ((await observeMemberAutoRunning(panel, patternName)).seen) result.running = 'pass';

    await open('empty');
    assert.equal(
      await page.locator('.product-card').count(),
      0,
      'data_member_auto_empty_fixture_failed',
    );
    const empty = await waitFor(
      'data_member_auto_no_match',
      () => memberAutoCard(panel, patternName),
      (state) => state?.noMatch === true && state.explanation === true,
      12_000,
      (state) => ({ active: state?.active, present: state?.present, noMatch: state?.noMatch }),
    );
    assert.equal(empty.rows, null, 'data_member_auto_no_match_rows_visible');
    result.no_match = 'pass';

    originalRoot = await ownedRequest('GET');
    assert.equal(originalRoot, null, 'data_member_auto_original_root_unexpected');
    result.original_root_read_verified = true;
    rootWriteStarted = true;
    assert.equal(
      await ownedRequest('PATCH', '['),
      '[',
      'data_member_auto_invalid_root_write_failed',
    );
    assert.equal(await ownedRequest('GET'), '[', 'data_member_auto_invalid_root_readback_failed');
    result.invalid_root_write_verified = true;
    await open('error');
    assert.equal(
      await page.locator('.product-card').count(),
      3,
      'data_member_auto_error_fixture_failed',
    );
    const failed = await waitFor(
      'data_member_auto_error',
      () => memberAutoCard(panel, patternName),
      (state) => state?.failed === true && state.errorVisible === true,
      12_000,
      (state) => ({ active: state?.active, present: state?.present, failed: state?.failed }),
    );
    assert.equal(failed.manualAction, 'Extract', 'data_member_auto_manual_action_missing');
    assert.equal(failed.manualActionEnabled, true, 'data_member_auto_manual_action_disabled');
    result.error = 'pass';
    result.manual_action = 'pass';
    result.pattern_reads = [...requests.values()].map(({ signedIn, status }) => ({
      signed_in: signedIn,
      status,
    }));
    assert.ok(
      result.pattern_reads.length >= 3 &&
        result.pattern_reads.every((read) => read.signed_in && read.status === 200),
      'data_member_auto_pattern_read_unverified',
    );
    return result;
  } finally {
    if (rootWriteStarted) {
      assert.equal(
        await ownedRequest('PATCH', originalRoot),
        originalRoot,
        'data_member_auto_root_restore_write_failed',
      );
      assert.equal(
        await ownedRequest('GET'),
        originalRoot,
        'data_member_auto_root_restore_readback_failed',
      );
      result.original_root_restored = true;
    }
    offRequest();
    offResponse();
    if (runningObserverInstalled)
      await observeMemberAutoRunning(panel, patternName, 'clear').catch(() => {});
    await panel.send('Network.disable').catch(() => {});
  }
}
