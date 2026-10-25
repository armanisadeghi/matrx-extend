import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { guestAdminControlsAbsent, recordGuestAdminAbsence } from './settings-guest-absence.mjs';

const guestSettings = {
  active: true,
  guest: true,
  sections: ['Account', 'Organization', 'Appearance', 'Chat', 'About'],
  advancedText: false,
  adminControls: [],
  permissionControlCount: 0,
};

test('T22/T63 absence requires a rendered active guest Settings observation', () => {
  assert.equal(guestAdminControlsAbsent(guestSettings), true);
  assert.equal(guestAdminControlsAbsent(null), false, 'missing observation');
  assert.equal(guestAdminControlsAbsent({}), false, 'loading observation');
  assert.equal(
    guestAdminControlsAbsent({ ...guestSettings, active: false, sections: [] }),
    false,
    'inactive empty panel from the hosted T22 warm sample',
  );
  assert.equal(
    guestAdminControlsAbsent({ ...guestSettings, sections: [] }),
    false,
    'active shell before Settings sections mount',
  );
  assert.equal(
    guestAdminControlsAbsent({ ...guestSettings, guest: false }),
    false,
    'signed-in Settings is the wrong mode',
  );
  assert.equal(
    guestAdminControlsAbsent({ ...guestSettings, sections: ['Account', 'Appearance'] }),
    false,
    'incomplete Settings render',
  );
});

test('T22/T63 rejects each forbidden admin control on a ready guest Settings screen', () => {
  for (const changed of [
    { sections: [...guestSettings.sections, 'Advanced agent capabilities'] },
    { advancedText: true },
    { adminControls: ['Audit key'] },
    { adminControls: ['Permission gate'] },
    { permissionControlCount: 1 },
  ]) {
    assert.equal(guestAdminControlsAbsent({ ...guestSettings, ...changed }), false);
  }
});

function panelDocument({
  active = true,
  guest = true,
  sections = guestSettings.sections,
  text = '',
  permissionControlCount = 0,
} = {}) {
  const buttons = [{ textContent: guest ? 'Sign in' : 'Sign out' }];
  const pane = {
    innerText: text,
    matches: (selector) => selector === '[role="tabpanel"][data-state="active"]',
    querySelectorAll: (selector) => {
      if (selector === 'button') return buttons;
      if (selector === 'button[aria-expanded]')
        return sections.map((name) => ({ textContent: name }));
      if (selector === '[aria-label="DevTools Protocol permission"]')
        return Array.from({ length: permissionControlCount }, () => ({}));
      throw new Error(`unexpected selector: ${selector}`);
    },
  };
  return {
    querySelectorAll: (selector) => {
      assert.equal(selector, 'button[role="tab"][data-state="active"]');
      return active
        ? [
            {
              title: 'Settings',
              getAttribute: (name) =>
                name === 'title' ? 'Settings' : name === 'aria-controls' ? 'settings-pane' : null,
            },
          ]
        : [];
    },
    getElementById: (id) => (id === 'settings-pane' ? pane : null),
  };
}

async function recordFromDom(dom, signedOut = true) {
  const caseRecord = { steps: [], criteria: [] };
  const read = async (_panel, expression) => runInNewContext(expression, { document: dom });
  const passed = await recordGuestAdminAbsence({
    panel: {},
    caseRecord,
    phase: 'warm',
    signedOut,
    read,
    action: 'Inspect guest Settings admin controls',
    criterionName: 'warm admin controls absent',
    criterion: (record, name, status, evidence) => record.criteria.push({ name, status, evidence }),
  });
  return { passed, caseRecord };
}

test('T22/T63 actual DOM observation and criterion refuse empty, loading and wrong-mode panels', async () => {
  const ready = await recordFromDom(panelDocument());
  assert.equal(ready.passed, true);
  assert.equal(ready.caseRecord.criteria[0].status, 'pass');
  assert.equal(ready.caseRecord.criteria[0].evidence.active, true);
  assert.equal(ready.caseRecord.criteria[0].evidence.guest, true);

  for (const scenario of [
    panelDocument({ active: false, sections: [] }),
    panelDocument({ sections: [] }),
    panelDocument({ guest: false }),
    panelDocument({ text: 'Audit key' }),
    panelDocument({ sections: [...guestSettings.sections, 'Advanced agent capabilities'] }),
    panelDocument({ permissionControlCount: 1 }),
  ]) {
    const observed = await recordFromDom(scenario);
    assert.equal(observed.passed, false);
    assert.equal(observed.caseRecord.criteria[0].status, 'fail');
  }
  assert.equal(
    (await recordFromDom(panelDocument(), false)).passed,
    false,
    'T63 retains its independent signed-out prerequisite',
  );
});

test('T22 and T63 runner sites both use the tested observation and criterion seam', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const t22Start = source.indexOf("await runCase(byId('T22')");
  const t22End = source.indexOf('for (const [suffix, run]', t22Start);
  const t63Start = source.indexOf('async function recordGuestAdvancedDenial(');
  const t63End = source.indexOf('\nasync function runCase(', t63Start);
  assert.ok(t22Start >= 0 && t22End > t22Start);
  assert.ok(t63Start >= 0 && t63End > t63Start);
  const t22 = source.slice(t22Start, t22End);
  const t63 = source.slice(t63Start, t63End);
  assert.match(t22, /await recordGuestAdminAbsence\(/);
  assert.match(t63, /await recordGuestAdminAbsence\(/);
});
