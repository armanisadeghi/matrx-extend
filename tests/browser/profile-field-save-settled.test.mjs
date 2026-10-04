import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createOwnedWriteJournal } from './profile-owned-write-journal.mjs';

// SUT is each actual field-case Save callback, through the strict journal.
// Captured causal state: disabled Save + dirty draft + all desired fields match.
// Only browser transport/time is substituted. The owned journal is real.
const source = await readFile(
  new URL('./profile-identity-employment-cases.mjs', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
for (const restoration of [false, true]) {
  test(`${restoration ? 'restore' : 'save'} waits for clean persisted fields before journal read`, async () => {
    const start = source.indexOf(
      restoration
        ? 'async () => {\n          await save(activePanel);'
        : "async () => {\n        phase = 'save_click';",
    );
    const end = source.indexOf(
      restoration ? '\n        persistedFields(original),' : '\n      persistedFields(desired),',
      start,
    );
    assert.ok(start >= 0 && end > start);
    const callback = source.slice(start, end).trim().replace(/,$/, '');
    const desired = { Preferred: 'Maren', Company: 'Harbor Studio' };
    const owned = {
      userId: 'owner',
      organizationId: 'organization',
      marker: 'original',
      createdAt: '2026-10-03T22:52:00Z',
    };
    let row = {
      user_id: owned.userId,
      organization_id: owned.organizationId,
      preferred_name: owned.marker,
      created_at: owned.createdAt,
      version: 1,
    };
    let saved = false;
    let settled = false;
    let prematureRead = false;
    let pendingSamples = 0;
    const journal = createOwnedWriteJournal({
      owned,
      baseUrl: 'https://db.invalid',
      persist: async () => {},
      read: async () => {
        if (saved && !settled) prematureRead = true;
        return row;
      },
    });
    const action = await new AsyncFunction(
      'save',
      'waitFor',
      'sample',
      'desired',
      'original',
      `let phase; const panel={}, activePanel={}, section='Identity', labels=Object.keys(desired); return (${callback});`,
    )(
      async () => {
        saved = true;
      },
      async (_label, read, accept) => {
        pendingSamples++;
        if (accept(await read())) return;
        settled = true;
        row = { ...row, preferred_name: desired.Preferred, version: 2 };
        assert.equal(accept(await read()), true, 'clean saved fields must complete');
      },
      async () => ({ section_count: 1, save_enabled: false, dirty: !settled, values: desired }),
      desired,
      desired,
    );
    let failure;
    try {
      await journal.save(desired.Preferred, action);
    } catch (error) {
      failure = error;
    }
    assert.equal(
      prematureRead,
      false,
      'disabled pending Save must not trigger predecessor journal read',
    );
    assert.equal(failure, undefined);
    assert.equal(pendingSamples, 1);
    assert.equal((await journal.reconcile()).version, 2);
  });
}
