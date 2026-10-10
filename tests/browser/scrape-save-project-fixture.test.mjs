import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { cleanupProjectFixture, projectFixtureRequest } from './scrape-save-project-fixture.mjs';
const fixture = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  ownerId: '33333333-3333-4333-8333-333333333333',
  name: 'owned run project',
};
test('fixture write carries selected organization and leaves actor stamping to database', () => {
  const request = projectFixtureRequest(fixture, 'POST');
  assert.equal(request.body.organization_id, fixture.organizationId);
  assert.equal(request.body.id, fixture.id);
  assert.equal(Object.hasOwn(request.body, 'created_by'), false);
});
test('cleanup binds exact id, organization, actor and run name and verifies absence', async () => {
  const requests = [];
  const result = await cleanupProjectFixture(fixture, async (request) => {
    requests.push(request);
    if (request.method === 'PATCH') return { status: 204 };
    return {
      status: 200,
      rows:
        requests.length === 1
          ? [
              {
                id: fixture.id,
                organization_id: fixture.organizationId,
                created_by: fixture.ownerId,
                name: fixture.name,
              },
            ]
          : [],
    };
  });
  assert.equal(result.verified, true);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.filters.id, `eq.${fixture.id}`);
    if (request.method === 'PATCH') {
      assert.equal(request.filters.created_by, `eq.${fixture.ownerId}`);
      assert.equal(request.filters.organization_id, `eq.${fixture.organizationId}`);
      assert.equal(request.filters.name, `eq.${fixture.name}`);
    } else {
      assert.equal(Object.hasOwn(request.filters, 'created_by'), false);
      assert.equal(Object.hasOwn(request.filters, 'organization_id'), false);
      assert.equal(Object.hasOwn(request.filters, 'name'), false);
    }
  }
});
test('cleanup rejects foreign owner and residual row without broadening delete', async () => {
  let mutations = 0;
  await assert.rejects(
    cleanupProjectFixture(fixture, async (request) => {
      if (request.method !== 'GET') mutations++;
      return {
        status: 200,
        rows: [
          {
            id: fixture.id,
            organization_id: fixture.organizationId,
            created_by: 'foreign',
            name: fixture.name,
          },
        ],
      };
    }),
  );
  assert.equal(mutations, 0);
});
test('native picker waits for its owned fixture rather than any existing project', async () => {
  const source = await readFile(
    new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(
    source.indexOf("projectFixtureRequest(projectFixture, 'POST')") <
      source.indexOf("report.stage = 'project_association_choice'"),
  );
  assert.match(source, /state\.labels\?\.filter/);
  assert.match(source, /const projectName = projectFixture\.name/);
  assert.match(source, /cleanupProjectFixture\(projectFixture/);
});

test('actual native readiness predicate rejects unrelated candidates and accepts owned project', async () => {
  const source = process.env.SCRAPE_FIXTURE_DRIVER_SOURCE
    ? await readFile(process.env.SCRAPE_FIXTURE_DRIVER_SOURCE, 'utf8')
    : await readFile(new URL('./scrape-save-native-acceptance.mjs', import.meta.url), 'utf8');
  const picker = source.slice(source.indexOf("report.stage = 'project_association_choice'"));
  const match = picker.match(/\(state\) =>\s*state\?\.input_count === 1[\s\S]*?(?=,\n)/);
  assert.ok(match);
  const ready = new Function('projectFixture', `return ${match[0].replace(/,$/, '')}`)(fixture);
  assert.equal(ready({ input_count: 1, labels: [] }), false);
  assert.equal(ready({ input_count: 1, labels: ['unrelated project'] }), false);
  assert.equal(ready({ input_count: 1, labels: [fixture.name] }), true);
  assert.equal(ready({ input_count: 1, labels: [fixture.name, fixture.name] }), false);
});

test('cleanup refuses success when the exact owned project remains after deletion', async () => {
  await assert.rejects(
    cleanupProjectFixture(fixture, async (request) => {
      if (request.method === 'PATCH') return { status: 204 };
      return {
        status: 200,
        rows: [
          {
            id: fixture.id,
            organization_id: fixture.organizationId,
            created_by: fixture.ownerId,
            name: fixture.name,
          },
        ],
      };
    }),
    /scrape_save_project_cleanup_residue/,
  );
});

test('cleanup verifies absence when fixture creation never persisted', async () => {
  let mutations = 0;
  const result = await cleanupProjectFixture(fixture, async (request) => {
    if (request.method !== 'GET') mutations++;
    return { status: 200, rows: [] };
  });
  assert.equal(result.verified, true);
  assert.equal(mutations, 0);
});

function filteredRows(rows, filters) {
  return rows.filter((row) =>
    Object.entries(filters).every(
      ([key, value]) =>
        key === 'select' ||
        (value === 'is.null' ? row[key] == null : String(row[key]) === value.slice(3)),
    ),
  );
}

test('realistic server filtering cannot hide a mismatched fixture from cleanup validation', async () => {
  for (const key of ['created_by', 'name', 'organization_id']) {
    const rows = [
      {
        id: fixture.id,
        organization_id: fixture.organizationId,
        created_by: fixture.ownerId,
        name: fixture.name,
        deleted_at: null,
        [key]: 'different',
      },
    ];
    let writes = 0;
    await assert.rejects(
      cleanupProjectFixture(fixture, async (request) => {
        if (request.method !== 'GET') writes++;
        return { status: 200, rows: filteredRows(rows, request.filters) };
      }),
      undefined,
      `mismatched ${key} must be observed and refused`,
    );
    assert.equal(writes, 0);
  }
});
