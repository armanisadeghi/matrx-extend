import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { runNotesFindAcceptance } from './notes-find-native-case.mjs';

const organizationId = '4b190b81-7ea2-40e1-8d6d-87fa4b520dfc';
const otherOrg = '6a70d8c9-d151-4ae0-8417-cc21bc20b928';
const scopeId = 'b47fc412-46fb-43e5-a496-8ff73d85cc80';
const typeId = '52c40999-6f82-4c96-bfa7-f7b462316d77';
const origin = 'https://browser-contract.invalid';

// SUT: actual Notes acceptance driver + emitted RPC script + real precondition classifier.
// Only CDP, browser storage and fetch are replaced; no live browser or service is contacted.
async function observePrecondition(tree, canonicalHomes) {
  const calls = [];
  const directory = await mkdtemp(join(tmpdir(), 'notes-home-contract-'));
  const ledgerPath = join(directory, 'ledger.json');
  const panel = {
    on() {
      return () => {};
    },
    async send(method, args) {
      assert.equal(method, 'Runtime.evaluate', 'precondition must stop before UI input');
      const value = await runInNewContext(args.expression, {
        chrome: {
          storage: {
            local: { get: async () => ({ 'matrx.auth.accessToken': 'local-contract-token' }) },
          },
        },
        async fetch(url, options) {
          const headers = { ...options.headers };
          const body = JSON.parse(options.body);
          calls.push({ url, method: options.method, headers, body });
          const door = url.slice(url.lastIndexOf('/') + 1);
          assert.ok(
            ['context_tree', 'my_homes'].includes(door),
            'no write RPC before accepted precondition',
          );
          const data = door === 'context_tree' ? tree : canonicalHomes;
          return { status: 200, json: async () => data };
        },
      });
      return { result: { value } };
    },
  };
  try {
    const report = await runNotesFindAcceptance({
      panel,
      transport: {},
      origin,
      publishableKey: 'contract-public-key',
      selectedOrganizationId: organizationId,
      selectedOrganizationName: 'Harbor Dental',
      role: 'member',
      sourceSha: 'a'.repeat(40),
      treeSha256: 'b'.repeat(64),
      ledgerPath,
    });
    assert.deepEqual(
      calls.map(({ url, method, headers, body }) => ({
        url,
        method,
        schema: headers['Content-Profile'],
        accept: headers['Accept-Profile'],
        organization: headers['X-Organization-Id'],
        authorization: headers.Authorization,
        apikey: headers.apikey,
        body,
      })),
      [
        {
          url: `${origin}/rest/v1/rpc/context_tree`,
          method: 'POST',
          schema: 'custom',
          accept: 'custom',
          organization: organizationId,
          authorization: 'Bearer local-contract-token',
          apikey: 'contract-public-key',
          body: { p_organization_ids: [organizationId] },
        },
        {
          url: `${origin}/rest/v1/rpc/my_homes`,
          method: 'POST',
          schema: 'platform',
          accept: 'platform',
          organization: organizationId,
          authorization: 'Bearer local-contract-token',
          apikey: 'contract-public-key',
          body: {},
        },
      ],
    );
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    assert.deepEqual(
      ledger.owned_homes,
      [],
      'no fixture home may be planned before precondition acceptance',
    );
    assert.deepEqual(ledger.fixtures, [], 'no note may be created before precondition acceptance');
    assert.equal(report.verdict, 'unverified');
    return report;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function home(id, org = organizationId) {
  return { scope_id: id, organization_id: org, is_general: true };
}

test('driver fetches platform canonical homes and refuses selected-org lazy General before any write', async () => {
  const report = await observePrecondition({ scopes: [], types: [] }, [
    home(scopeId, otherOrg),
    home(null),
  ]);
  assert.equal(report.failure_code, 'notes_find_general_home_uninitialized');
  assert.equal(report.observations.home_precondition.canonical_general_uninitialized, true);
});

test('driver distinguishes initialized canonical identity unavailable in the selected-org tree', async () => {
  const report = await observePrecondition({ scopes: [], types: [] }, [
    home(null, otherOrg),
    home(scopeId),
  ]);
  assert.equal(report.failure_code, 'notes_find_general_home_tree_unavailable');
  assert.equal(report.observations.home_precondition.canonical_general_id_valid, true);
});

test('driver passes renamed canonical identity to classifier before refusing its unavailable type', async () => {
  const report = await observePrecondition(
    {
      scopes: [
        {
          id: scopeId,
          organization_id: organizationId,
          name: 'Harbor Dental',
          scope_type_id: typeId,
        },
      ],
      types: [],
    },
    [home(scopeId)],
  );
  assert.equal(report.failure_code, 'notes_find_general_home_type_unavailable');
  assert.equal(report.observations.home_precondition.canonical_general_in_tree, true);
  assert.equal(report.observations.home_precondition.literal_general_count, 0);
});
