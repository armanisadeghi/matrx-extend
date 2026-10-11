import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { isOwnedDomainPatternRead, memberAutoCard } from './data-member-auto-extract-driver.mjs';

function panelFor(markup) {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" data-state="active" title="Data" aria-controls="data-pane"></button>
    <div id="data-pane" role="tabpanel" data-state="active">${markup}</div>`;
  return {
    send: async (_method, { expression }) => {
      return { result: { value: JSON.parse(JSON.stringify(window.eval(expression))) } };
    },
    close: () => window.close(),
  };
}

function card(badge, detail, rows = '') {
  return `<div class="bg-emerald-500/10"><div><span>Owned T08 pattern</span>
    <span>${badge}</span></div><div>${detail}</div><button>Extract</button></div>${rows}`;
}

test('member T08 reads real Data card states and JSON rows, rejecting corrupt row content', async () => {
  const autoRows = `<div class="space-y-2"><div><div>Auto-extracted (1 rows)</div></div>
    <pre>[{"field_1":"Cedar chair","field_2":"$429"}]</pre></div>`;
  const success = panelFor(card('auto · 1 rows', 'Auto-extracted on page load', autoRows));
  try {
    assert.deepEqual(await memberAutoCard(success, 'Owned T08 pattern'), {
      active: true,
      present: true,
      running: false,
      success: true,
      noMatch: false,
      failed: false,
      explanation: false,
      errorVisible: false,
      manualAction: 'Extract',
      manualActionEnabled: true,
      rows: [{ field_1: 'Cedar chair', field_2: '$429' }],
    });
  } finally {
    success.close();
  }
  const corrupt = panelFor(
    card('auto · 1 rows', 'Auto-extracted on page load', autoRows.replace('$429', '$189')),
  );
  try {
    const state = await memberAutoCard(corrupt, 'Owned T08 pattern');
    assert.notDeepEqual(state.rows, [{ field_1: 'Cedar chair', field_2: '$429' }]);
  } finally {
    corrupt.close();
  }
});

test('member T08 separates no-match and failure from success and disabled manual action', async () => {
  const empty = panelFor(card('auto · no match', 'No matching data was found on this page.'));
  const failed = panelFor(
    card('auto failed', "SyntaxError: '[' is not a valid selector").replace(
      '<button>',
      '<button disabled>',
    ),
  );
  try {
    const noMatch = await memberAutoCard(empty, 'Owned T08 pattern');
    assert.equal(noMatch.noMatch, true);
    assert.equal(noMatch.explanation, true);
    assert.equal(noMatch.success, false);
    const error = await memberAutoCard(failed, 'Owned T08 pattern');
    assert.equal(error.failed, true);
    assert.equal(error.errorVisible, true);
    assert.equal(error.manualActionEnabled, false);
  } finally {
    empty.close();
    failed.close();
  }
});

test('member T08 stays an opt-in scope on the existing hosted member-data route', async () => {
  const [workflow, driver] = await Promise.all([
    readFile(
      new URL('../../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
      'utf8',
    ),
    readFile(new URL('./data-member-native-acceptance.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(workflow, /member_data_scope:[\s\S]*?default: lifecycle[\s\S]*?auto-extract/);
  const exercise = workflow
    .split('- name: Exercise the selected Chrome side-panel case')[1]
    ?.split('        run: |')[0];
  assert.match(exercise, /MATRX_MEMBER_DATA_SCOPE: \$\{\{ inputs\.member_data_scope \}\}/);
  assert.match(driver, /AUTO_SCOPE \? 'EXT-F-2005-T08' : 'EXT-F-2005-T03'/);
  assert.match(driver, /if \(AUTO_SCOPE\) \{[\s\S]*?await runMemberAutoExtract/);
  assert.match(driver, /finally \{[\s\S]*?cleanupOwnedDataPattern/);
});

test('auto network proof counts only domain-scoped pattern reads, excluding owned-row cleanup reads', () => {
  const origin = 'https://db.matrxserver.com';
  const host = '127.0.0.1:48152';
  const request = (path, method = 'GET') => ({ url: `${origin}${path}`, method });
  assert.equal(
    isOwnedDomainPatternRead(
      request('/rest/v1/wbx_pattern?select=*&domain=eq.127.0.0.1%3A48152'),
      origin,
      host,
    ),
    true,
  );
  assert.equal(
    isOwnedDomainPatternRead(
      request('/rest/v1/wbx_pattern?id=eq.owned-id&organization_id=eq.org-id'),
      origin,
      host,
    ),
    false,
  );
  assert.equal(
    isOwnedDomainPatternRead(
      request('/rest/v1/wbx_pattern?domain=eq.127.0.0.1%3A48152', 'PATCH'),
      origin,
      host,
    ),
    false,
  );
});
