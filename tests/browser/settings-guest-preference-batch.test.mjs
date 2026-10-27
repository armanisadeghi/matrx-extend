import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import {
  GUEST_PREFERENCES,
  guestChatDefaultExpression,
  guestChatDefaultMatches,
  observeGuestNewChatDefault,
  observeGuestPreference,
  preferenceMatches,
  runGuestPreferenceCase,
  runGuestThemeRenderingProbe,
  withSettingsRestoration,
} from './settings-guest-preference-batch.mjs';
import {
  chatToolsCandidatesExpression,
  chatToolsContextExpression,
} from './settings-panel-driver.mjs';
import { preserveFailureDuringCleanup } from './settings-probe-cleanup.mjs';

// Source-derived, reduced unit input from frozen SDK397 / design-system399.
// The b175 native capture corroborates the mobile Tools header and Device switch;
// this controlled DOM input is NOT a captured live DOM or native acceptance proof.
// ComposerSourcesChip uses PopoverTrigger; ComposerSubmenu uses PopoverAnchor +
// MenuRow, so ONLY Capabilities has aria-controls. Tools/Advanced never do.
// RunPicksSurface menu exposes data-picks-layout/search; full picker owns All chats.
// Mobile TabbedBottomSheet has Back + a direct title span, never desktop role=tab navigation.
function chatModeFixture(checked = 'false', presentation = 'window') {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `<button role="tab" data-matrx-title="Chat"
    data-state="active" aria-controls="chat-pane"></button>
    <div id="chat-pane" role="tabpanel" data-state="active">
      <button title="New chat"></button><button aria-label="Capabilities" aria-controls="capabilities" aria-expanded="false"></button>
    </div><div id="capabilities" hidden><button aria-expanded="false"><span>Tools</span></button></div>
    <div id="tools" data-composer-panel hidden><div data-picks-layout="menu"><input placeholder="Search tools to add"/><button ${presentation === 'inline' ? 'aria-expanded="false"' : ''}><span>${presentation === 'inline' ? 'Advanced' : 'See all'}</span></button></div></div>
    <div id="advanced" hidden ${presentation === 'window' ? 'data-window-panel data-window-id="run-controls-window"' : presentation === 'sheet' ? 'role="dialog" aria-label="Chat options"' : 'data-composer-panel'}>
      ${presentation === 'window' ? '<nav aria-label="Run controls"><button role="tab" title="Tools" aria-selected="true">Tools</button></nav>' : ''}
      ${presentation === 'sheet' ? '<div class="matrx-mobile-sheet"><div><div><button aria-label="Back" aria-hidden="false"></button></div><span>Tools</span><div></div></div><div>' : ''}
      <input placeholder="Search tools"/><label>Ask before acting<span>All chats</span><button role="switch" aria-label="Ask before acting" aria-checked="${checked}"></button></label>
      ${presentation === 'sheet' ? '</div></div>' : ''}
    </div>`;
  for (const node of document.querySelectorAll('*'))
    node.getBoundingClientRect = () => ({ width: 100, height: 30 });
  const evaluate = (script) =>
    runInNewContext(script, {
      document,
      getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    });
  const open = (id) => {
    document.getElementById(id).removeAttribute('hidden');
    const trigger =
      id === 'capabilities'
        ? document.querySelector('[aria-label="Capabilities"]')
        : id === 'tools'
          ? document.querySelector('#capabilities button')
          : document.querySelector('#tools button');
    if (trigger?.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'true');
    if (id === 'advanced' && presentation !== 'inline') {
      // See all closes its composer cascade before opening the host window/sheet.
      for (const parent of ['capabilities', 'tools'])
        document.getElementById(parent).setAttribute('hidden', '');
      document.querySelector('[aria-label="Capabilities"]').setAttribute('aria-expanded', 'false');
    }
  };
  const close = () => {
    for (const id of ['capabilities', 'tools', 'advanced'])
      document.getElementById(id).setAttribute('hidden', '');
    for (const trigger of document.querySelectorAll('button[aria-expanded]'))
      trigger.setAttribute('aria-expanded', 'false');
  };
  return {
    window,
    document,
    evaluate,
    open,
    close,
    read: () => evaluate(guestChatDefaultExpression()),
  };
}

test('current Tools traversal requires the owned Capabilities portal, not outer Tools navigation', async () => {
  const f = chatModeFixture();
  try {
    assert.equal(f.evaluate(chatToolsCandidatesExpression()).length, 0);
    f.open('capabilities');
    assert.equal(f.evaluate(chatToolsCandidatesExpression()).length, 1);
    const requireOwnedTools = (expression) =>
      assert.equal(f.evaluate(expression).length, 1, 'owned current Tools door required');
    const oldDoor = chatToolsCandidatesExpression().replace(
      ".filter((button) => /^(Capabilities)(:|$)/.test(button.getAttribute('aria-label') ?? ''));",
      ".filter((button) => button.getAttribute('title') === 'Chat Options');",
    );
    assert.notEqual(oldDoor, chatToolsCandidatesExpression());
    requireOwnedTools(chatToolsCandidatesExpression());
    assert.throws(() => requireOwnedTools(oldDoor), /owned current Tools door required/);
    assert.throws(() => requireOwnedTools('[]'), /owned current Tools door required/);

    f.document.body.insertAdjacentHTML(
      'beforeend',
      '<button>Tools</button><div role="dialog" aria-label="Unrelated"><button>Tools</button></div>',
    );
    for (const node of f.document.querySelectorAll('*'))
      node.getBoundingClientRect = () => ({ width: 100, height: 30 });
    assert.equal(f.evaluate(chatToolsCandidatesExpression()).length, 1);
    f.document.getElementById('capabilities').setAttribute('hidden', '');
    assert.equal(f.evaluate(chatToolsCandidatesExpression()).length, 0);
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('full picker observes Ask and Act; compact Tools and unrelated Agent actions cannot certify permission mode', async () => {
  for (const presentation of ['window', 'inline', 'sheet']) {
    const f = chatModeFixture('false', presentation);
    try {
      const control = f.document.querySelector('[role="switch"]');
      f.open('capabilities');
      f.open('tools');
      assert.equal(f.read().modeControlCount, 0, 'compact Tools excludes its topSlot');
      f.open('advanced');
      assert.equal(f.read().permissionMode, 'act');
      control.setAttribute('aria-checked', 'true');
      assert.equal(f.read().permissionMode, 'ask');
      control.setAttribute('aria-checked', 'mixed');
      assert.equal(f.read().permissionMode, null);
      control.setAttribute('aria-checked', 'false');
      const duplicate = control.cloneNode(true);
      duplicate.getBoundingClientRect = () => ({ width: 100, height: 30 });
      control.parentElement.appendChild(duplicate);
      assert.equal(f.read().modeControlCount, 2);
      assert.equal(f.read().permissionMode, null);
      duplicate.remove();
      control.setAttribute('hidden', '');
      assert.equal(f.read().modeControlCount, 0);
      control.removeAttribute('hidden');
      f.document.getElementById('advanced').setAttribute('hidden', '');
      f.document.body.insertAdjacentHTML(
        'beforeend',
        '<div><label>Agent actions</label><button role="combobox">Ask first</button></div>',
      );
      assert.equal(f.read().modeControlCount, 0);
      assert.equal(f.read().permissionMode, null);
      f.document.getElementById('chat-pane').setAttribute('data-state', 'inactive');
      assert.equal(f.read().activeChat, false);
    } finally {
      await f.window.happyDOM.abort();
    }
  }
});

test('actual mobile selected Tools header certifies Device Ask/Act without fabricated desktop tabs', async () => {
  const f = chatModeFixture('false', 'sheet');
  try {
    f.open('capabilities');
    f.open('tools');
    f.open('advanced');
    assert.equal(f.document.querySelectorAll('[role="tab"][aria-selected]').length, 0);
    const verify = (expression) => {
      const control = f.document.querySelector('[role="switch"]');
      for (const [checked, expected] of [
        ['false', 'act'],
        ['true', 'ask'],
        ['mixed', null],
      ]) {
        control.setAttribute('aria-checked', checked);
        assert.equal(f.evaluate(expression).permissionMode, expected);
      }
    };
    verify(guestChatDefaultExpression());
    assert.throws(() => verify('({permissionMode: "act"})'), assert.AssertionError);
    assert.throws(() => verify('({permissionMode: null})'), assert.AssertionError);
    f.document.querySelector('[role="switch"]').setAttribute('aria-checked', 'false');
    f.document.querySelector('#advanced input').setAttribute('placeholder', 'Search 37 tools');
    assert.equal(
      f.read().permissionMode,
      'act',
      'mobile full picker permits actual catalog-count search label',
    );
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('mobile context resolver rejects empty and constant-root guts and a missing-header mutant', async () => {
  const f = chatModeFixture('false', 'sheet');
  try {
    f.open('capabilities');
    f.open('tools');
    f.open('advanced');
    const title = f.document.querySelector('.matrx-mobile-sheet > div > span');
    const verify = (expression) => {
      title.textContent = 'Tools';
      assert.equal(f.evaluate(expression).modeRoots.length, 1);
      title.textContent = 'Model';
      assert.equal(f.evaluate(expression).modeRoots.length, 0);
    };
    const actual = chatToolsContextExpression();
    verify(actual);
    assert.throws(() => verify('({modeRoots: []})'), assert.AssertionError);
    assert.throws(
      () => verify('({modeRoots: [document.getElementById("advanced")]})'),
      assert.AssertionError,
    );
    const missingHeader = actual.replace("titles[0].textContent.trim() === 'Tools'", 'true');
    assert.notEqual(missingHeader, actual);
    assert.throws(() => verify(missingHeader), assert.AssertionError);
  } finally {
    await f.window.happyDOM.abort();
  }
});

for (const corruption of [
  'wrong-header',
  'index',
  'hidden-back',
  'hidden-header',
  'duplicate-sheet',
  'missing-picker',
  'unrelated-dialog',
  'hidden-dialog',
  'inert-dialog',
  'device-outside-selected-content',
]) {
  test(`mobile Tools ownership rejects ${corruption} despite a present Device switch`, async () => {
    const f = chatModeFixture('false', 'sheet');
    try {
      f.open('capabilities');
      f.open('tools');
      f.open('advanced');
      const root = f.document.getElementById('advanced');
      const sheet = root.querySelector('.matrx-mobile-sheet');
      const header = sheet.firstElementChild;
      if (corruption === 'wrong-header')
        header.querySelector(':scope > span').textContent = 'Model';
      else if (corruption === 'index')
        header.querySelector(':scope > span').textContent = 'Chat options';
      else if (corruption === 'hidden-back')
        header.querySelector('button').setAttribute('aria-hidden', 'true');
      else if (corruption === 'hidden-header') header.setAttribute('hidden', '');
      else if (corruption === 'duplicate-sheet') {
        const duplicate = sheet.cloneNode(true);
        for (const node of [duplicate, ...duplicate.querySelectorAll('*')])
          node.getBoundingClientRect = () => ({ width: 100, height: 30 });
        root.appendChild(duplicate);
      } else if (corruption === 'missing-picker') root.querySelector('input').remove();
      else if (corruption === 'unrelated-dialog') root.setAttribute('aria-label', 'Unrelated');
      else if (corruption === 'hidden-dialog') root.setAttribute('hidden', '');
      else if (corruption === 'inert-dialog') root.setAttribute('inert', '');
      else if (corruption === 'device-outside-selected-content')
        root.appendChild(root.querySelector('label'));
      assert.equal(f.read().permissionMode, null);
      assert.equal(f.read().modeControlCount, 0);
    } finally {
      await f.window.happyDOM.abort();
    }
  });
}

test('ambiguous compact pickers and full permission surfaces never select an arbitrary portal', async () => {
  const f = chatModeFixture('false', 'inline');
  const revealTree = (node) => {
    for (const child of [node, ...node.querySelectorAll('*')])
      child.getBoundingClientRect = () => ({ width: 100, height: 30 });
  };
  try {
    f.open('capabilities');
    f.open('tools');
    const duplicatePicker = f.document.getElementById('tools').cloneNode(true);
    duplicatePicker.id = 'second-compact';
    revealTree(duplicatePicker);
    f.document.body.appendChild(duplicatePicker);
    assert.equal(
      f.evaluate(`(${chatToolsContextExpression()}).details.length`),
      0,
      'ambiguous compact ownership must refuse the details click',
    );
    duplicatePicker.remove();
    f.open('advanced');
    const duplicateFull = f.document.getElementById('advanced').cloneNode(true);
    duplicateFull.id = 'second-full';
    revealTree(duplicateFull);
    f.document.body.appendChild(duplicateFull);
    assert.equal(
      f.read().permissionMode,
      null,
      'two full mode surfaces must not certify a default',
    );
    duplicateFull.remove();
    f.document.querySelector('#advanced input').setAttribute('placeholder', 'Search 37 tools');
    assert.equal(
      f.read().permissionMode,
      'act',
      'full picker accepts the actual catalog-count placeholder',
    );
    f.document.getElementById('tools').removeAttribute('data-composer-panel');
    assert.equal(
      f.read().permissionMode,
      null,
      'lost actual compact portal boundary must not certify the full picker',
    );
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('mode observation rejects constant and inverted checked-state mutants on different expected outcomes', async () => {
  const f = chatModeFixture();
  try {
    f.open('capabilities');
    f.open('tools');
    f.open('advanced');
    const control = f.document.querySelector('[role="switch"]');
    const verify = (expression) => {
      control.setAttribute('aria-checked', 'false');
      assert.equal(f.evaluate(expression).permissionMode, 'act');
      control.setAttribute('aria-checked', 'true');
      assert.equal(f.evaluate(expression).permissionMode, 'ask');
    };
    verify(guestChatDefaultExpression());
    assert.throws(() => verify(`({ permissionMode: 'act' })`), assert.AssertionError);
    assert.throws(
      () =>
        verify(
          guestChatDefaultExpression().replace(
            "permissionMode: checked === 'true' ? 'ask' : checked === 'false' ? 'act'",
            "permissionMode: checked === 'true' ? 'act' : checked === 'false' ? 'ask'",
          ),
        ),
      assert.AssertionError,
    );
  } finally {
    await f.window.happyDOM.abort();
  }
});

test('fresh Chat default traverses current full picker without writing mode and closes it after failure', async () => {
  for (const [checked, expected, label] of [
    ['false', 'act', 'Act without asking'],
    ['true', 'ask', 'Ask before acting'],
  ]) {
    const f = chatModeFixture(checked);
    const events = [];
    const driver = {
      click: async (_panel, kind, value) => {
        events.push([kind, value]);
        if (kind === 'chat-capabilities') f.open('capabilities');
        else if (kind === 'chat-tools') f.open('tools');
        else if (kind === 'chat-tools-details') f.open('advanced');
        else assert.ok(['Chat', 'New chat'].includes(value), 'mode switch must never be written');
      },
      evaluate: async (_panel, script) => f.evaluate(script),
      pressEscape: async () => {
        events.push(['key', 'Escape']);
        f.close();
      },
      waitFor: async (stage, read, accept) => {
        const value = await read();
        assert.equal(accept(value), true, stage);
        return value;
      },
    };
    try {
      assert.equal(
        (await observeGuestNewChatDefault({}, expected, label, driver)).permissionMode,
        expected,
      );
      assert.deepEqual(
        events.map((x) => x[0]),
        ['title', 'title', 'chat-capabilities', 'chat-tools', 'chat-tools-details', 'key'],
      );
      assert.equal(f.read().optionsOpen, false);
      const fail = new Error('consumer_input_failure');
      await assert.rejects(
        observeGuestNewChatDefault({}, expected, label, {
          ...driver,
          click: async (...args) => {
            await driver.click(...args);
            if (args[1] === 'chat-tools') throw fail;
          },
        }),
        (error) => error === fail,
      );
      assert.equal(f.read().ownedPopupOpen, false);
      await assert.rejects(
        observeGuestNewChatDefault({}, expected, label, {
          ...driver,
          pressEscape: async () => {
            throw new Error('escape_failed');
          },
        }),
        (error) => error.safeCleanupFailed === true && error.cause?.message === 'escape_failed',
      );
      f.close();
    } finally {
      await f.window.happyDOM.abort();
    }
  }
});

async function requireRetainedSurfaceFailure(candidate, field) {
  const f = chatModeFixture();
  let cleanup = false;
  const original = new Error('tools_entry_unavailable');
  const driver = {
    click: async (_panel, kind) => {
      if (kind === 'chat-capabilities') f.open('capabilities');
    },
    evaluate: async (_panel, script) => {
      if (script.includes('toolsEntryCount')) return { toolsEntryCount: 0 };
      const value = f.read();
      return cleanup
        ? {
            ...value,
            modeControlCount: 0,
            optionsOpen: false,
            ownedPopupOpen: false,
            composerPanelCount: 0,
            optionsSheetCount: 0,
            [field]:
              field === 'composerContextObserved' ? false : field.endsWith('Count') ? 1 : true,
          }
        : value;
    },
    pressEscape: async () => {
      cleanup = true;
    },
    waitFor: async (stage, read, accept) => {
      if (stage === 'guest_chat_tools_entry_ready') throw original;
      const value = await read();
      assert.equal(accept(value), true, stage);
      return value;
    },
  };
  try {
    let caught;
    try {
      await candidate({}, 'act', 'Act without asking', driver);
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, original);
    assert.equal(
      caught.safeCleanupFailed,
      true,
      `unclosed ${field} must remain an explicit cleanup failure`,
    );
  } finally {
    await f.window.happyDOM.abort();
  }
}

const CLOSED_SURFACE_CONDITIONS = {
  composerContextObserved: 'value?.composerContextObserved === true',
  modeControlCount: 'value.modeControlCount === 0',
  optionsOpen: 'value.optionsOpen === false',
  ownedPopupOpen: 'value.ownedPopupOpen === false',
  composerPanelCount: 'value.composerPanelCount === 0',
  optionsSheetCount: 'value.optionsSheetCount === 0',
};
function observerFromSource(source) {
  return runInNewContext(`(${source})`, {
    nativeDriver: {},
    preserveFailureDuringCleanup,
    guestChatDefaultExpression,
    guestChatDefaultMatches,
    chatToolsCandidatesExpression,
    chatToolsContextExpression,
  });
}
for (const [field, condition] of Object.entries(CLOSED_SURFACE_CONDITIONS)) {
  test(`no-op Escape rejects retained ${field} and its own missing-condition mutant`, async () => {
    await requireRetainedSurfaceFailure(observeGuestNewChatDefault, field);
    const actual = observeGuestNewChatDefault.toString();
    const closureStart = actual.indexOf("'guest_chat_options_closed'");
    assert.ok(closureStart > 0);
    const closure = actual.slice(closureStart);
    const replacedClosure = closure.replace(condition, 'true');
    assert.notEqual(replacedClosure, closure, 'mutant must remove the intended closure condition');
    const withoutCondition = actual.slice(0, closureStart) + replacedClosure;
    await assert.rejects(
      requireRetainedSurfaceFailure(observerFromSource(withoutCondition), field),
      /unclosed/,
    );
  });
}
async function requireLostContextFailure(candidate, lost) {
  const f = chatModeFixture();
  const original = new Error('tools_entry_unavailable');
  const driver = {
    click: async (_panel, kind) => {
      if (kind === 'chat-capabilities') f.open('capabilities');
    },
    evaluate: async (_panel, script) =>
      script.includes('toolsEntryCount') ? { toolsEntryCount: 0 } : f.evaluate(script),
    pressEscape: async () => {
      // A retained host window is real DOM input; losing its composer boundary
      // must never turn the hidden-by-ownership zero counts into closure proof.
      f.open('advanced');
      const pane = f.document.getElementById('chat-pane');
      if (lost === 'missing-chat') pane.remove();
      else if (lost === 'inactive-chat') pane.setAttribute('data-state', 'inactive');
      else if (lost === 'missing-capabilities')
        pane.querySelector('[aria-label="Capabilities"]').remove();
      else if (lost === 'duplicate-capabilities') {
        const duplicate = pane.querySelector('[aria-label="Capabilities"]').cloneNode(true);
        duplicate.getBoundingClientRect = () => ({ width: 100, height: 30 });
        pane.appendChild(duplicate);
      } else if (lost === 'missing-new-chat') pane.querySelector('[title="New chat"]').remove();
      else if (lost === 'duplicate-new-chat')
        pane.appendChild(pane.querySelector('[title="New chat"]').cloneNode(true));
    },
    waitFor: async (stage, read, accept) => {
      if (stage === 'guest_chat_tools_entry_ready') throw original;
      const value = await read();
      assert.equal(accept(value), true, stage);
      return value;
    },
  };
  try {
    let caught;
    try {
      await candidate({}, 'act', 'Act without asking', driver);
    } catch (error) {
      caught = error;
    }
    assert.equal(
      f.document.getElementById('advanced').hasAttribute('hidden'),
      false,
      'window remains rendered',
    );
    assert.equal(
      f.read().composerContextObserved,
      false,
      'boundary validity derives from actual Chat/New chat/Capabilities',
    );
    assert.equal(caught, original);
    assert.equal(caught.safeCleanupFailed, true, `unclosed ${lost} must not certify absence`);
  } finally {
    await f.window.happyDOM.abort();
  }
}
for (const lost of [
  'missing-chat',
  'inactive-chat',
  'missing-capabilities',
  'duplicate-capabilities',
  'missing-new-chat',
  'duplicate-new-chat',
]) {
  test(`retained window remains unverified after ${lost}`, async () => {
    await requireLostContextFailure(observeGuestNewChatDefault, lost);
    if (!lost.endsWith('new-chat')) {
      const source = observeGuestNewChatDefault.toString();
      const at = source.indexOf("'guest_chat_options_closed'");
      const mutant =
        source.slice(0, at) +
        source.slice(at).replace('value?.composerContextObserved === true', 'true');
      assert.notEqual(mutant, source);
      await assert.rejects(requireLostContextFailure(observerFromSource(mutant), lost), /unclosed/);
    }
  });
}

test('cleanup postcondition rejects skipping the whole wait or returning an arranged result', async () => {
  const actual = observeGuestNewChatDefault.toString();
  const skipped = actual.replace(
    /await driver\.waitFor\(\s*'guest_chat_options_closed',[\s\S]*?\n\s*\);/,
    '',
  );
  assert.notEqual(skipped, actual);
  await assert.rejects(
    requireRetainedSurfaceFailure(observerFromSource(skipped), 'optionsOpen'),
    /unclosed/,
  );
  await assert.rejects(
    requireRetainedSurfaceFailure(async () => ({ permissionMode: 'act' }), 'optionsOpen'),
    assert.AssertionError,
  );
});

test('real preference callback restores Settings and its section after consumer failure, retaining the original error', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('            async ({ value, label }) => {');
  const end =
    source.indexOf('            },\n            undefined,', start) + '            }'.length;
  assert.ok(start > 0 && end > start);
  const callbackSource = source.slice(start, end);
  const verify = async (candidate) => {
    for (const consumerFails of [false, true]) {
      const events = [];
      const original = new Error('original_consumer_failure');
      const c = { steps: [] };
      const callback = runInNewContext(`(${callbackSource})`, {
        panel: {},
        preference: { caseId: 'T10', section: 'Chat' },
        c,
        observeGuestNewChatDefault: async () => {
          events.push('consume');
          if (consumerFails) throw original;
          return { modeLabel: 'Act without asking', permissionMode: 'act' };
        },
        criterion: () => events.push('criterion'),
        withSettingsRestoration: candidate,
        settings: async () => events.push('Settings'),
        openSection: async (_panel, section) => events.push(section),
      });
      if (consumerFails)
        await assert.rejects(
          callback({ value: 'act', label: 'Act without asking' }),
          (error) => error === original,
        );
      else await callback({ value: 'act', label: 'Act without asking' });
      assert.deepEqual(events.slice(-2), ['Settings', 'Chat']);
    }
  };
  await verify(withSettingsRestoration);
  await assert.rejects(
    verify(async () => undefined),
    assert.AssertionError,
  );
  await assert.rejects(
    verify(async (consume) => consume()),
    assert.AssertionError,
  );
  const original = new Error('original');
  await assert.rejects(
    withSettingsRestoration(
      async () => {
        throw original;
      },
      async () => {
        throw new Error('cleanup');
      },
    ),
    (error) => error === original && error.safeCleanupFailed === true,
  );
  await assert.rejects(
    withSettingsRestoration(
      async () => 'observation',
      async () => {
        throw new Error('cleanup_only');
      },
    ),
    (error) => error.safeCleanupFailed === true && error.cause?.message === 'cleanup_only',
  );
});

test('actual case serialization preserves explicit cleanup failure without raw causes, rejecting flag-loss mutants', async () => {
  const source = await readFile(
    new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const criterionSource = source.match(/^const criterion = .*;$/m)?.[0];
  const start = source.indexOf('async function runCase(c, fn) {');
  const end = source.indexOf('\nlet observedPort;', start);
  assert.ok(criterionSource && start > 0 && end > start);
  const caseSource = source.slice(start, end);
  const runner = (body) =>
    runInNewContext(`(() => { ${criterionSource}\n${body}\nreturn runCase; })()`);
  const verify = async (body) => {
    const runCase = runner(body);
    for (const frozen of [false, true]) {
      const primary = new Error('guest_chat_tools_entry_ready_not_observed');
      if (frozen) Object.freeze(primary);
      const c = { criteria: [], steps: [] };
      await runCase(c, () =>
        preserveFailureDuringCleanup(
          async () => {
            throw primary;
          },
          async () => {
            throw new Error('private-cleanup-payload');
          },
        ),
      );
      const written = JSON.parse(JSON.stringify(c));
      assert.equal(
        written.cleanupAlsoFailed,
        true,
        'cleanup failure flag must be preserved in the case report',
      );
      assert.equal(written.error, frozen ? 'settings_probe_cleanup_failed' : primary.message);
      assert.equal(written.status, 'fail');
      assert.deepEqual(written.criteria, [
        { name: 'runner completed the case', status: 'fail', evidence: written.error },
      ]);
      assert.equal(JSON.stringify(written).includes('private-cleanup-payload'), false);
      assert.equal(Object.hasOwn(written, 'cause'), false);
    }
    for (const marker of [undefined, false, 'true']) {
      const ordinary = Object.assign(new Error('ordinary_observation_failure'), {
        safeCleanupFailed: marker,
        privatePayload: 'private-ordinary-payload',
      });
      const c = { criteria: [], steps: [] };
      await runCase(c, async () => {
        throw ordinary;
      });
      const written = JSON.parse(JSON.stringify(c));
      assert.equal(
        Object.hasOwn(written, 'cleanupAlsoFailed'),
        false,
        'only explicit true marks cleanup failure',
      );
      assert.equal(written.status, 'fail');
      assert.equal(written.error, 'ordinary_observation_failure');
      assert.equal(JSON.stringify(written).includes('private-ordinary-payload'), false);
    }
  };
  await verify(caseSource);
  await assert.rejects(
    verify('async function runCase() { return undefined; }'),
    /cleanup failure flag must be preserved/,
  );
  await assert.rejects(
    verify(
      `async function runCase() { return { error: 'guest_chat_tools_entry_ready_not_observed', cleanupAlsoFailed: true, status: 'fail', criteria: [{ name: 'runner completed the case', status: 'fail', evidence: 'guest_chat_tools_entry_ready_not_observed' }] }; }`,
    ),
    /cleanup failure flag must be preserved/,
  );
  const missingFlag = caseSource.replace(
    '    if (error?.safeCleanupFailed === true) c.cleanupAlsoFailed = true;\n',
    '',
  );
  assert.notEqual(missingFlag, caseSource);
  await assert.rejects(verify(missingFlag), /cleanup failure flag must be preserved/);
  const truthyFlag = caseSource.replace(
    'error?.safeCleanupFailed === true',
    'error?.safeCleanupFailed',
  );
  assert.notEqual(truthyFlag, caseSource);
  await assert.rejects(verify(truthyFlag), /only explicit true/);
});

function themeProbeFixture({
  failOptionOnce,
  unpersistedBaseline = false,
  storagePresent = true,
  accurateAppearance = false,
} = {}) {
  const preference = GUEST_PREFERENCES.find((candidate) => candidate.caseId === 'T04');
  const settingsStorage = storagePresent
    ? { 'matrx.settings.v1': JSON.stringify({ state: { sentinel: 'keep-me' } }) }
    : {};
  let current = themeObservation(
    unpersistedBaseline ? 'system' : 'light',
    !unpersistedBaseline,
    storagePresent,
    accurateAppearance,
  );
  let failed = false;
  const optionClicks = [];
  const driver = {
    openSection: async (_panel, section) => assert.equal(section, 'Appearance'),
    click: async (_panel, kind, label) => {
      if (kind !== 'option') return;
      optionClicks.push(label);
      if (!failed && label === failOptionOnce) {
        failed = true;
        throw new Error('simulated_theme_option_failure');
      }
      const value = { Dark: 'dark', Light: 'light', System: 'system' }[label];
      const serialized = settingsStorage['matrx.settings.v1'];
      const saved = typeof serialized === 'string' ? JSON.parse(serialized) : { state: {} };
      saved.state.theme = value;
      settingsStorage['matrx.settings.v1'] = JSON.stringify(saved);
      current = themeObservation(value, true, true, accurateAppearance);
    },
    evaluate: async (_panel, script) => {
      if (script.includes('const originalStoragePresent =')) {
        await runInNewContext(script, {
          chrome: {
            storage: {
              local: {
                get: async (key) => ({ [key]: settingsStorage[key] }),
                set: async (values) => Object.assign(settingsStorage, values),
                remove: async (keys) => {
                  for (const key of Array.isArray(keys) ? keys : [keys])
                    delete settingsStorage[key];
                },
              },
            },
          },
        });
        const serialized = settingsStorage['matrx.settings.v1'];
        const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : null;
        const storedPresent = Object.hasOwn(parsed?.state ?? {}, 'theme');
        current = themeObservation(
          current.value,
          storedPresent,
          typeof serialized === 'string',
          accurateAppearance,
        );
        return true;
      }
      return current;
    },
    waitFor: async (_label, read, accept) => {
      const observed = await read();
      if (!accept(observed)) throw new Error('theme_probe_wait_not_observed');
      return observed;
    },
    reload: async () => {
      const raw = settingsStorage['matrx.settings.v1'];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
      const storedPresent = Object.hasOwn(parsed?.state ?? {}, 'theme');
      const value = storedPresent ? parsed.state.theme : current.value;
      current = themeObservation(value, storedPresent, typeof raw === 'string', accurateAppearance);
    },
  };
  return {
    preference,
    driver,
    optionClicks,
    read: () => current,
    readStoredSettings: () => {
      const raw = settingsStorage['matrx.settings.v1'];
      return typeof raw === 'string' ? JSON.parse(raw) : undefined;
    },
  };
}

function themeObservation(
  value,
  storedPresent = true,
  storagePresent = true,
  accurateAppearance = false,
) {
  const dark = value === 'dark';
  return {
    activeSettings: true,
    count: 1,
    selected: { dark: 'Dark', light: 'Light', system: 'System' }[value],
    value,
    stored: storedPresent ? value : null,
    storedPresent,
    storagePresent,
    darkClass: dark,
    systemDark: false,
    renderedBackgroundMatches: accurateAppearance || !dark,
    renderedBackgrounds: {
      token: dark ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)',
      body:
        dark && !accurateAppearance
          ? 'rgb(250, 250, 250)'
          : dark
            ? 'rgb(24, 24, 27)'
            : 'rgb(255, 255, 255)',
      root: 'rgba(0, 0, 0, 0)',
      activePanel: 'rgba(0, 0, 0, 0)',
    },
  };
}

test('guest Settings preference evidence requires matching visible and persisted values', () => {
  for (const preference of GUEST_PREFERENCES) {
    for (const [value, label] of preference.choices) {
      const valid = {
        activeSettings: true,
        count: 1,
        selected: label,
        stored: value,
        systemDark: false,
        darkClass: value === 'dark',
        renderedBackgroundMatches: true,
      };
      assert.equal(preferenceMatches(valid, preference, value, label), true);
      assert.equal(
        preferenceMatches({ ...valid, stored: 'wrong' }, preference, value, label),
        false,
      );
      assert.equal(
        preferenceMatches({ ...valid, selected: 'wrong' }, preference, value, label),
        false,
      );
      assert.equal(
        preferenceMatches({ ...valid, activeSettings: false }, preference, value, label),
        false,
      );
      assert.equal(preferenceMatches({ ...valid, count: 2 }, preference, value, label), false);
      if (preference.key === 'theme')
        assert.equal(
          preferenceMatches({ ...valid, darkClass: !valid.darkClass }, preference, value, label),
          false,
        );
      if (preference.key === 'theme')
        assert.equal(
          preferenceMatches(
            { ...valid, renderedBackgroundMatches: false },
            preference,
            value,
            label,
          ),
          false,
          'theme preference must reach the rendered page background',
        );
    }
  }
});

test('theme appearance probe resolves the product HSL channel token as a CSS color', async () => {
  const preference = GUEST_PREFERENCES.find((candidate) => candidate.key === 'theme');
  let script;
  await observeGuestPreference({}, preference, {
    evaluate: async (_panel, expression) => {
      script = expression;
      return null;
    },
  });

  const backgroundColor = script.match(/probe\.style\.backgroundColor = '([^']+)'/)?.[1];
  assert.equal(backgroundColor, 'hsl(var(--background))');
});

test('isolated guest theme probe captures appearance mismatch and restores without reloading extension', async () => {
  const f = themeProbeFixture();
  const observations = [];
  await runGuestThemeRenderingProbe(
    {},
    f.preference,
    (...entry) => observations.push(entry),
    f.driver,
  );

  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'System', 'Light']);
  assert.equal(f.read().stored, 'light');
  assert.equal(f.read().selected, 'Light');
  assert.equal(
    observations.find(([name]) => name === 'Dark theme and computed appearance observed')[2],
    false,
  );
  assert.equal(
    observations.find(([name]) => name === 'Original theme selection and storage restored')[2],
    true,
  );
  assert.deepEqual(
    observations.find(([name]) => name === 'Dark theme and computed appearance observed')[1]
      .renderedBackgrounds,
    {
      token: 'rgb(24, 24, 27)',
      body: 'rgb(250, 250, 250)',
      root: 'rgba(0, 0, 0, 0)',
      activePanel: 'rgba(0, 0, 0, 0)',
    },
  );
});

test('isolated guest theme probe restores its baseline after a theme option driver error', async () => {
  const f = themeProbeFixture({ failOptionOnce: 'Light' });
  const observations = [];
  await assert.rejects(
    runGuestThemeRenderingProbe({}, f.preference, (...entry) => observations.push(entry), f.driver),
    /simulated_theme_option_failure/,
  );

  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'Light']);
  assert.equal(f.read().stored, 'light');
  assert.equal(f.read().selected, 'Light');
  assert.equal(
    observations.find(([name]) => name === 'Original theme selection and storage restored')[2],
    true,
  );
});

test('isolated guest theme probe restores a visible implicit baseline with no stored theme', async () => {
  const f = themeProbeFixture({ unpersistedBaseline: true, storagePresent: false });
  const observations = [];
  await runGuestThemeRenderingProbe(
    {},
    f.preference,
    (...entry) => observations.push(entry),
    f.driver,
  );

  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'System']);
  assert.equal(f.read().selected, 'System');
  assert.equal(f.read().stored, null);
  assert.equal(f.read().storedPresent, false);
  assert.equal(f.read().storagePresent, false);
  assert.equal(f.readStoredSettings(), undefined);
  assert.equal(
    observations.find(([name]) => name === 'Original theme selection and storage restored')[2],
    true,
  );
});

test('isolated guest theme probe preserves other stored settings when theme was never persisted', async () => {
  const f = themeProbeFixture({ unpersistedBaseline: true, storagePresent: true });
  const observations = [];
  await runGuestThemeRenderingProbe(
    {},
    f.preference,
    (...entry) => observations.push(entry),
    f.driver,
  );

  assert.equal(f.read().stored, null);
  assert.equal(f.read().storedPresent, false);
  assert.equal(f.read().storagePresent, true);
  assert.equal(f.readStoredSettings().state.sentinel, 'keep-me');
  assert.equal(Object.hasOwn(f.readStoredSettings().state, 'theme'), false);
  assert.equal(
    observations.find(([name]) => name === 'Original theme selection and storage restored')[2],
    true,
  );
});

test('T04 restores the case-entry theme and rendered appearance after panel reload', async () => {
  const f = themeProbeFixture({ accurateAppearance: true });
  const observations = [];
  let reloads = 0;
  await runGuestPreferenceCase(
    {},
    async () => {
      reloads += 1;
      await f.driver.reload();
    },
    f.preference,
    (...entry) => observations.push(entry),
    async () => {},
    f.driver,
  );

  assert.equal(reloads, 4, 'three choice reloads plus the original-baseline reload');
  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'System', 'Light']);
  assert.equal(f.read().selected, 'Light');
  assert.equal(f.read().stored, 'light');
  assert.equal(f.read().renderedBackgroundMatches, true);
  assert.equal(
    observations.find(
      ([name]) => name === 'Original theme baseline restored after panel reload',
    )[2],
    true,
  );
});

test('T04 restores an originally implicit System value and absent theme key after panel reload', async () => {
  const f = themeProbeFixture({
    unpersistedBaseline: true,
    storagePresent: true,
    accurateAppearance: true,
  });
  const observations = [];
  let reloads = 0;
  await runGuestPreferenceCase(
    {},
    async () => {
      reloads += 1;
      await f.driver.reload();
    },
    f.preference,
    (...entry) => observations.push(entry),
    async () => {},
    f.driver,
  );

  assert.equal(reloads, 4, 'three choice reloads plus the original-baseline reload');
  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'System']);
  assert.equal(f.read().selected, 'System');
  assert.equal(f.read().stored, null);
  assert.equal(f.read().storedPresent, false);
  assert.equal(f.read().storagePresent, true);
  assert.equal(f.readStoredSettings().state.sentinel, 'keep-me');
  assert.equal(
    observations.find(
      ([name]) => name === 'Original theme baseline restored after panel reload',
    )[2],
    true,
  );
});

test('T04 restores the case-entry theme after a choice failure and preserves that failure', async () => {
  const f = themeProbeFixture({ failOptionOnce: 'Light', accurateAppearance: true });
  const observations = [];
  let reloads = 0;
  await assert.rejects(
    runGuestPreferenceCase(
      {},
      async () => {
        reloads += 1;
        await f.driver.reload();
      },
      f.preference,
      (...entry) => observations.push(entry),
      async () => {},
      f.driver,
    ),
    /simulated_theme_option_failure/,
  );

  assert.equal(reloads, 2, 'one completed choice reload plus baseline restoration reload');
  assert.deepEqual(f.optionClicks, ['Dark', 'Light', 'Light']);
  assert.equal(f.read().selected, 'Light');
  assert.equal(f.read().stored, 'light');
  assert.equal(f.read().renderedBackgroundMatches, true);
  assert.equal(
    observations.find(
      ([name]) => name === 'Original theme baseline restored after panel reload',
    )[2],
    true,
  );
});

test('guest new chat exposes both selected default modes through their real mode controls', () => {
  for (const [mode, modeLabel, icon] of [
    ['act', 'Act without asking', 'act'],
    ['ask', 'Ask before acting', 'ask'],
  ]) {
    const observed = {
      activeChat: true,
      newChatCount: 1,
      modeControlCount: 1,
      modeLabel,
      permissionMode: icon,
    };
    assert.equal(guestChatDefaultMatches(observed, mode, modeLabel), true);
    assert.equal(
      guestChatDefaultMatches(
        { ...observed, permissionMode: icon === 'act' ? 'ask' : 'act' },
        mode,
        modeLabel,
      ),
      false,
      `switch mode must match ${mode}`,
    );
    assert.equal(
      guestChatDefaultMatches(
        { ...observed, modeLabel: mode === 'act' ? 'Ask before acting' : 'Act without asking' },
        mode,
        modeLabel,
      ),
      false,
      `mode label must match ${mode}`,
    );
  }
  assert.equal(guestChatDefaultMatches({ activeChat: false }, 'ask', 'Ask before acting'), false);
  assert.equal(
    guestChatDefaultMatches({ activeChat: true, newChatCount: 0 }, 'ask', 'Ask before acting'),
    false,
  );
});

test('T10 guest Ask is refused, visibly reverted, and remains Act after panel reload', async () => {
  const preference = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  const state = {
    activeSettings: true,
    count: 1,
    selected: 'Act without asking',
    stored: null,
    storedPresent: false,
    storagePresent: false,
    saveRefusal: false,
  };
  const clicks = [];
  const driver = {
    openSection: async () => {},
    click: async (_panel, kind, label) => {
      if (kind !== 'option') return;
      clicks.push(label);
      state.saveRefusal = true;
    },
    evaluate: async (_panel, script) => {
      return { ...state };
    },
    waitFor: async (label, read, accept) => {
      const value = await read();
      if (!accept(value)) throw new Error(`${label}_not_observed`);
      return value;
    },
  };
  await runGuestPreferenceCase(
    null,
    async () => {},
    preference,
    () => {},
    async () => {},
    driver,
  );
  assert.deepEqual(clicks, ['Ask before acting']);
  assert.equal(state.saveRefusal, true);
  assert.deepEqual(
    [state.selected, state.stored, state.storedPresent, state.storagePresent],
    ['Act without asking', null, false, false],
  );
});

import { captureGuestPreferenceBaselines } from './settings-full-extension-rechecks.mjs';
import { runGuestChoicesAcrossExtensionRestarts } from './settings-guest-extension-rechecks.mjs';
import {
  preferenceBaseline,
  preferenceBaselineMatches,
  restoreGuestPreferenceBaseline,
} from './settings-guest-preference-batch.mjs';

test('T10 baseline is captured after T04 restores its original absent settings container', async () => {
  const theme = GUEST_PREFERENCES.find((item) => item.caseId === 'T04');
  const mode = GUEST_PREFERENCES.find((item) => item.caseId === 'T10');
  const state = {
    T04: {
      activeSettings: true,
      count: 1,
      selected: 'System',
      stored: 'system',
      storedPresent: true,
      storagePresent: true,
    },
    T10: {
      activeSettings: true,
      count: 1,
      selected: 'Act without asking',
      stored: null,
      storedPresent: false,
      storagePresent: false,
    },
  };
  const originalTheme = preferenceBaseline(
    {
      ...state.T04,
      stored: null,
      storedPresent: false,
      storagePresent: false,
      darkClass: false,
      systemDark: false,
      renderedBackgroundMatches: true,
    },
    theme,
  );
  const baselines = await captureGuestPreferenceBaselines({
    panel: {},
    preferences: [theme, mode],
    settings: async () => {},
    openSection: async () => {},
    observePreference: async (_panel, preference) => ({ ...state[preference.caseId] }),
    preferenceBaseline,
    caseEntryBaselines: { T04: originalTheme },
    restorePreferenceBaseline: async () => {
      state.T04 = { ...state.T04, stored: null, storedPresent: false, storagePresent: false };
      state.T10 = { ...state.T10, stored: null, storedPresent: false, storagePresent: false };
    },
  });
  assert.equal(baselines.T10.value, 'act');
  assert.equal(baselines.T10.storedPresent, false);
  assert.equal(baselines.T10.storagePresent, false);
  assert.equal(preferenceBaselineMatches(state.T10, mode, baselines.T10), true);
  assert.equal(
    preferenceBaselineMatches(
      {
        ...state.T10,
        stored: 'ask',
        selected: 'Ask before acting',
        storedPresent: true,
        storagePresent: true,
      },
      mode,
      baselines.T10,
    ),
    false,
  );
});

// The harness owns baseline capture/restoration/comparison; only browser I/O is a fixture.
for (const storagePresent of [false, true]) {
  for (const corruptReload of [false, true]) {
    test(`T04 carries absent-key case entry across late writes and full reload (container=${storagePresent}, corrupt=${corruptReload})`, async () => {
      const f = themeProbeFixture({
        unpersistedBaseline: true,
        storagePresent,
        accurateAppearance: true,
      });
      const entry = await runGuestPreferenceCase(
        {},
        () => f.driver.reload(),
        f.preference,
        () => {},
        async () => {},
        f.driver,
      );
      // A later Settings control can persist all defaults, including implicit System.
      await f.driver.click({}, 'option', 'System');
      const events = [];
      const baselines = await captureGuestPreferenceBaselines({
        panel: {},
        preferences: [f.preference],
        settings: async () => {},
        openSection: f.driver.openSection,
        observePreference: (panel, preference) =>
          observeGuestPreference(panel, preference, f.driver),
        preferenceBaseline,
        caseEntryBaselines: { T04: entry },
        restorePreferenceBaseline: (panel, preference, baseline) =>
          restoreGuestPreferenceBaseline(panel, preference, baseline, () => {}, f.driver),
      });
      assert.equal(baselines.T04.storedPresent, false);
      assert.equal(baselines.T04.storagePresent, storagePresent);
      assert.equal(f.read().storedPresent, false);
      let generation = 0;
      let panel = { targetId: 'initial' };
      const run = () =>
        runGuestChoicesAcrossExtensionRestarts({
          panel,
          section: 'Appearance',
          controlLabel: 'Theme',
          choices: f.preference.choices,
          baseline: baselines.T04,
          settings: async () => {},
          openSection: f.driver.openSection,
          read: (target) => observeGuestPreference(target, f.preference, f.driver),
          matches: (state, value, label) => preferenceMatches(state, f.preference, value, label),
          matchesBaseline: (state) => preferenceBaselineMatches(state, f.preference, baselines.T04),
          restoreBaseline: (target) =>
            restoreGuestPreferenceBaseline(target, f.preference, baselines.T04, () => {}, f.driver),
          driver: f.driver,
          record: (name, status, observation) => events.push({ name, status, observation }),
          reloadExtension: async () => {
            const absentBefore = f.read().storedPresent === false;
            await f.driver.reload();
            if (corruptReload && absentBefore) await f.driver.click({}, 'option', 'System');
            panel = { targetId: `replacement-${++generation}` };
            return {
              panel,
              management_reload_clicked: true,
              old_targets_retired: true,
              worker_replaced: true,
              panel_replaced: true,
              retirement_evidence: { timeline: { final_predicate: true } },
            };
          },
        });
      if (corruptReload) {
        await assert.rejects(run(), /full_extension_preference_or_restore_failed/);
        assert.equal(
          events.some(({ name }) => name === 'original preference restored after extension reload'),
          false,
        );
      } else {
        await run();
        assert.equal(generation, 3);
        const final = events.find(
          ({ name }) => name === 'original preference restored after extension reload',
        );
        assert.equal(final.status, 'pass');
        assert.equal(final.observation.selected, 'System');
        assert.equal(final.observation.stored, null);
        assert.equal(final.observation.storedPresent, false);
        assert.equal(final.observation.storagePresent, storagePresent);
        if (storagePresent) assert.equal(f.readStoredSettings().state.sentinel, 'keep-me');
      }
    });
  }
}
