import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const IDENTITY = [
  'First name',
  'Middle',
  'Last name',
  'Preferred',
  'Suffix',
  'Pronouns',
  'Birthday',
];
const EMPLOYMENT = ['Company', 'Title'];
const PROFILE_COLUMNS = {
  'First name': 'legal_first_name',
  Middle: 'legal_middle_name',
  'Last name': 'legal_last_name',
  Preferred: 'preferred_name',
  Suffix: 'name_suffix',
  Pronouns: 'pronouns',
  Birthday: 'date_of_birth',
  Company: 'company_name',
  Title: 'job_title',
};
const SECTIONS = [
  'Identity',
  'Phones',
  'Emails',
  'Web',
  'Shipping address',
  'Billing address',
  'Employment',
  'Emergency contacts',
];

function sampleExpression(section, labels) {
  return `(() => {
    const name=${JSON.stringify(section)}, labels=${JSON.stringify(labels)};
    const buttons=[...document.querySelectorAll('button[aria-expanded]')].filter(b=>b.textContent.trim()===name);
    if(buttons.length!==1) return {section_count:buttons.length};
    const button=buttons[0], content=document.getElementById(button.getAttribute('aria-controls'));
    const values={};
    for(const label of labels){
      const matches=[...(content?.querySelectorAll('span')??[])].filter(s=>s.textContent.trim()===label);
      const input=matches[0]?.parentElement?.querySelector('input');
      values[label]=matches.length===1 && input ? input.value : null;
    }
    const root=document.querySelector('button[title="Back"]')?.parentElement?.parentElement;
    const save=root?.querySelector('button[aria-label="Save profile"]');
    return {section_count:1, expanded:button.getAttribute('aria-expanded'),
      hidden:content?.getAttribute('aria-hidden'), inert:content?.hasAttribute('inert'),
      values, dirty:(root?.innerText??'').includes('Unsaved changes'),
      save_enabled:!!save && !save.disabled,
      card_name:root?.querySelector('.truncate.text-base.font-semibold')?.textContent.trim()??null};
  })()`;
}

async function sample(panel, section, labels = []) {
  return evaluate(panel, sampleExpression(section, labels));
}

async function clickAt(panel, target) {
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...target,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...target,
    button: 'left',
    clickCount: 1,
  });
}

async function inputPoint(panel, section, label) {
  return waitFor(
    `${section}_${label}_hittable`,
    () =>
      evaluate(
        panel,
        `(() => {
    const button=[...document.querySelectorAll('button[aria-expanded]')].find(b=>b.textContent.trim()===${JSON.stringify(section)});
    const content=button && document.getElementById(button.getAttribute('aria-controls'));
    const labels=[...(content?.querySelectorAll('span')??[])].filter(s=>s.textContent.trim()===${JSON.stringify(label)});
    const el=labels.length===1?labels[0].parentElement?.querySelector('input'):null;
    if(!el || el.closest('[inert]')) return null;
    el.scrollIntoView({block:'center',behavior:'instant'});
    const r=el.getBoundingClientRect(), x=el.type==='date'?r.x+Math.min(12,r.width/4):r.x+r.width/2, y=r.y+r.height/2;
    return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`,
      ),
    (point) => point?.x > 0,
    10000,
  );
}

async function fill(panel, section, label, value) {
  await clickAt(panel, await inputPoint(panel, section, label));
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers: process.platform === 'darwin' ? 4 : 2,
    windowsVirtualKeyCode: 65,
    commands: ['selectAll'],
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers: process.platform === 'darwin' ? 4 : 2,
    windowsVirtualKeyCode: 65,
  });
  if (value && label === 'Birthday') {
    assert.match(value, /^\d{4}-\d{2}-\d{2}$/, 'birthday_iso_date_required');
    // Chromium's native date control has month/day/year segments. Trusted
    // digit key events reach those segments; insertText of an ISO date does not.
    for (const digit of `${value.slice(5, 7)}${value.slice(8, 10)}${value.slice(0, 4)}`) {
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: digit,
        code: `Digit${digit}`,
        windowsVirtualKeyCode: digit.charCodeAt(0),
        text: digit,
      });
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: digit,
        code: `Digit${digit}`,
        windowsVirtualKeyCode: digit.charCodeAt(0),
      });
    }
  } else if (value) await panel.send('Input.insertText', { text: value });
  else
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
  await waitFor(
    `${section}_${label}_edited`,
    () => sample(panel, section, [label]),
    (s) => s?.values?.[label] === value,
    10000,
  );
}

async function clickHeader(panel, label) {
  const point = await waitFor(
    `${label}_hittable`,
    () =>
      evaluate(
        panel,
        `(() => {
    const header=document.querySelector('button[title="Back"]')?.parentElement;
    const buttons=[...(header?.querySelectorAll('button')??[])].filter(b=>b.textContent.trim()===${JSON.stringify(label)});
    if(buttons.length!==1 || buttons[0].disabled)return null;
    const el=buttons[0];el.scrollIntoView({block:'center',behavior:'instant'});
    const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`,
      ),
    (p) => p?.x > 0,
    10000,
  );
  await clickAt(panel, point);
}

async function sectionState(panel, name) {
  return sample(panel, name);
}

async function toggle(panel, name, expected) {
  const before = await sectionState(panel, name);
  assert.equal(before.section_count, 1, `${name}_section_missing`);
  await click(panel, 'section', name);
  const after = await waitFor(
    `${name}_toggle_${expected}`,
    () => sectionState(panel, name),
    (s) =>
      s?.expanded === String(expected) && s.hidden === String(!expected) && s.inert === !expected,
    10000,
  );
  assert.notEqual(after.expanded, before.expanded, `${name}_toggle_no_change`);
}

async function ensureOpen(panel, section) {
  const current = await sectionState(panel, section);
  assert.equal(current.section_count, 1, `${section}_section_missing`);
  if (current.expanded === 'false') await toggle(panel, section, true);
}

function equalFields(observed, expected, label) {
  for (const [field, value] of Object.entries(expected))
    assert.equal(observed.values?.[field], value, `${label}_${field}_mismatch`);
}

function persistedFields(values) {
  return Object.fromEntries(
    Object.entries(values).map(([label, value]) => [PROFILE_COLUMNS[label], value || null]),
  );
}

export async function runProfileFieldCase({
  panel,
  email,
  mode,
  dimension,
  section,
  ownedJournal,
  openProfile,
  back,
  save,
  deferRestoration = false,
}) {
  assert.ok(ownedJournal, 'profile_field_write_requires_owned_row_journal');
  const labels = section === 'Identity' ? IDENTITY : EMPLOYMENT;
  const id =
    section === 'Identity'
      ? mode === 'member'
        ? 'EXT-F-1004-T05'
        : 'EXT-F-1004-T06'
      : mode === 'member'
        ? 'EXT-F-1004-T17'
        : 'EXT-F-1004-T18';
  await ensureOpen(panel, section);
  const original = (await sample(panel, section, labels)).values;
  for (const label of labels)
    assert.equal(typeof original[label], 'string', `${section}_${label}_missing`);
  const token = randomUUID().slice(0, 8);
  const desired =
    section === 'Identity'
      ? {
          'First name': `Marin${token}`,
          Middle: `Ellis${token}`,
          'Last name': `Vale${token}`,
          Preferred: `Maren${token}`,
          Suffix: `III${token}`,
          Pronouns: `they/${token}`,
          Birthday: '2001-04-12',
        }
      : { Company: `Harbor Studio ${token}`, Title: `Design Lead ${token}` };
  for (const [label, value] of Object.entries(desired))
    assert.notEqual(value, original[label], `${section}_${label}_not_distinct`);
  const preferredBefore = (await sample(panel, 'Identity', ['Preferred'])).values?.Preferred;
  let firstError;
  let phase = 'fill';
  let field = null;
  try {
    for (const [label, value] of Object.entries(desired)) {
      field = label;
      await fill(panel, section, label, value);
    }
    phase = 'draft_assert';
    field = null;
    const draft = await sample(panel, section, labels);
    equalFields(draft, desired, `${section}_draft`);
    assert.equal(draft.save_enabled, true, `${section}_save_disabled`);
    phase = 'journal_before_action';
    await ownedJournal.save(
      section === 'Identity' ? desired.Preferred : preferredBefore,
      async () => {
        phase = 'save_click';
        await save(panel);
        phase = 'save_settled';
        await waitFor(
          `${section}_save_settled`,
          () => sample(panel, section, labels),
          (s) =>
            s?.save_enabled === false &&
            s.dirty === false &&
            Object.entries(desired).every(([k, v]) => s.values?.[k] === v),
          30000,
        );
        phase = 'journal_after_action';
      },
      persistedFields(desired),
    );
    phase = 'reopen';
    await back(panel);
    await openProfile(panel, email);
    await ensureOpen(panel, section);
    const reopened = await sample(panel, section, labels);
    equalFields(reopened, desired, `${section}_reopened`);
    if (section === 'Identity')
      assert.equal(
        reopened.card_name,
        `${desired['First name']} ${desired['Last name']}`,
        'identity_card_name_mismatch',
      );
  } catch (error) {
    firstError = error;
    let fieldMatched = null;
    if (phase === 'fill' && field) {
      try {
        fieldMatched = (await sample(panel, section, [field])).values?.[field] === desired[field];
      } catch {
        // Keep the original failure when the panel cannot be sampled.
      }
    }
    error.profileFieldFailure = {
      phase,
      field,
      fieldMatched,
    };
  }
  async function restore(activePanel) {
    await ensureOpen(activePanel, section);
    const current = await sample(activePanel, section, labels);
    for (const [label, value] of Object.entries(original))
      if (current.values?.[label] !== value) await fill(activePanel, section, label, value);
    const restoreDraft = await sample(activePanel, section, labels);
    if (restoreDraft.save_enabled) {
      await ownedJournal.save(
        preferredBefore,
        async () => {
          await save(activePanel);
          await waitFor(
            `${section}_restore_settled`,
            () => sample(activePanel, section, labels),
            (s) =>
              s?.save_enabled === false &&
              s.dirty === false &&
              Object.entries(original).every(([k, v]) => s.values?.[k] === v),
            30000,
          );
        },
        persistedFields(original),
      );
    }
    await back(activePanel);
    await openProfile(activePanel, email);
    await ensureOpen(activePanel, section);
    equalFields(await sample(activePanel, section, labels), original, `${section}_restored`);
    await ownedJournal.reconcile();
  }
  let restoreError;
  if (firstError || !deferRestoration) {
    try {
      await restore(panel);
    } catch (error) {
      restoreError = error;
    }
  }
  throwFieldCaseFailure(firstError, restoreError);
  const receipt = {
    id,
    mode,
    dimension,
    branch: 'default',
    status: deferRestoration ? 'provisional_until_reload_and_restoration' : 'passed',
    observed: {
      fields_checked: labels,
      save_reopen_verified: true,
      restoration_verified: !deferRestoration,
      reload_persistence_verified: false,
      identity_card_checked: section === 'Identity',
    },
  };
  if (!deferRestoration) return { receipt };
  return {
    receipt,
    async verifyReload(activePanel) {
      await ensureOpen(activePanel, section);
      const reloaded = await sample(activePanel, section, labels);
      equalFields(reloaded, desired, `${section}_extension_reload`);
      if (section === 'Identity')
        assert.equal(
          reloaded.card_name,
          `${desired['First name']} ${desired['Last name']}`,
          'identity_card_extension_reload_mismatch',
        );
      receipt.observed.reload_persistence_verified = true;
    },
    async restore(activePanel) {
      await restore(activePanel);
      receipt.observed.restoration_verified = true;
      if (receipt.observed.reload_persistence_verified) receipt.status = 'passed';
    },
  };
}

export function throwFieldCaseFailure(firstError, restoreError) {
  if (firstError && restoreError) {
    firstError.profileRestorationError = restoreError;
    firstError.profileRestorationFailure = {
      code: 'profile_case_restoration_failed',
      stage: 'restore_profile_ui',
    };
  }
  if (firstError) throw firstError;
  if (restoreError) throw restoreError;
}

export async function runProfileExpandersCase({ panel, mode, dimension }) {
  const id = mode === 'member' ? 'EXT-F-1004-T21' : 'EXT-F-1004-T22';
  let phase = 'ensure_open';
  let section = 'Identity';
  let original;
  let originalReady = false;
  const draft = `Marin ${randomUUID().slice(0, 8)}`;
  let firstError;
  try {
    await ensureOpen(panel, 'Identity');
    phase = 'sample_original';
    original = (await sample(panel, 'Identity', ['Preferred'])).values.Preferred;
    originalReady = true;
    assert.notEqual(draft, original);
    phase = 'fill';
    await fill(panel, 'Identity', 'Preferred', draft);
    for (const name of SECTIONS) {
      section = name;
      phase = 'sample_section';
      const current = await sectionState(panel, name);
      assert.equal(current.section_count, 1, `${name}_section_missing`);
      if (current.expanded === 'false') {
        phase = 'expand';
        await toggle(panel, name, true);
      }
      phase = 'collapse';
      await toggle(panel, name, false);
      phase = 'reexpand';
      await toggle(panel, name, true);
    }
    phase = 'draft_assert';
    section = null;
    const after = await sample(panel, 'Identity', ['Preferred']);
    assert.equal(after.values.Preferred, draft, 'expander_draft_lost');
    assert.equal(after.dirty, true, 'expander_unsaved_indicator_missing');
    assert.equal(after.save_enabled, true, 'expander_save_disabled');
  } catch (error) {
    error.profileExpanderFailure = { phase, section };
    firstError = error;
  }
  let restoreError;
  if (originalReady) {
    try {
      phase = 'discard';
      section = 'Identity';
      await clickHeader(panel, 'Discard');
      phase = 'discard_assert';
      const discarded = await waitFor(
        'expander_discard_restored',
        () => sample(panel, 'Identity', ['Preferred']),
        (s) => s?.values?.Preferred === original && !s.save_enabled,
        10000,
      );
      assert.equal(discarded.values.Preferred, original);
    } catch (error) {
      error.profileExpanderFailure = { phase, section };
      restoreError = error;
    }
  }
  if (firstError && restoreError) {
    firstError.profileRestorationError = restoreError;
    firstError.profileRestorationFailure = {
      code: 'profile_case_restoration_failed',
      stage: 'discard_local_draft',
    };
  }
  if (firstError) throw firstError;
  if (restoreError) throw restoreError;
  return {
    id,
    mode,
    dimension,
    branch: 'default',
    status: 'passed',
    observed: { sections_checked: SECTIONS, draft_survived: true, discard_restored: true },
  };
}
