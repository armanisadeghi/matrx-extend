import { randomUUID } from 'node:crypto';
import {
  createNotesFindLedger,
  planNotesFindHome,
  recordNotesFindDeleted,
  recordNotesFindHomeArchived,
  recordNotesFindHomeAssigned,
  recordNotesFindHomeCreated,
  recordNotesFindInsertBeforeValidation,
  requireNotesFindHomeWrite,
  writeNotesFindLedger,
} from './notes-find-fixture.mjs';
import { inspectNotesFindHomePrecondition } from './notes-find-home-precondition.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function scopeDoor(
  panel,
  origin,
  publishableKey,
  organizationId,
  door,
  args,
  schema = 'custom',
) {
  const result = await evaluate(
    panel,
    `(async () => {
    const token = (await chrome.storage.local.get('matrx.auth.accessToken'))['matrx.auth.accessToken'];
    if (typeof token !== 'string' || !token) return { status: 0, data: null };
    const response = await fetch(${JSON.stringify(`${origin}/rest/v1/rpc/`)} + ${JSON.stringify(door)}, {
      method: 'POST',
      headers: {
        apikey: ${JSON.stringify(publishableKey)},
        Authorization: 'Bearer ' + token,
        'X-Organization-Id': ${JSON.stringify(organizationId)},
        'Content-Profile': ${JSON.stringify(schema)},
        'Accept-Profile': ${JSON.stringify(schema)},
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(${JSON.stringify(args)}),
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  })()`,
  );
  if (!result || result.status < 200 || result.status >= 300)
    throw new Error(`notes_find_${door}_failed_${result?.status ?? 0}`);
  return result.data;
}

async function selectedOrgTree(panel, origin, publishableKey, organizationId) {
  const data = await scopeDoor(panel, origin, publishableKey, organizationId, 'context_tree', {
    p_organization_ids: [organizationId],
  });
  if (!Array.isArray(data?.scopes) || !Array.isArray(data?.types))
    throw new Error('notes_find_scope_tree_shape_invalid');
  return data;
}

async function makeOwnedHomes(
  panel,
  origin,
  publishableKey,
  organizationId,
  ledger,
  ledgerPath,
  token,
  report,
) {
  const tree = await selectedOrgTree(panel, origin, publishableKey, organizationId);
  const homes = await scopeDoor(
    panel,
    origin,
    publishableKey,
    organizationId,
    'my_homes',
    {},
    'platform',
  );
  if (!Array.isArray(homes)) throw new Error('notes_find_my_homes_shape_invalid');
  const precondition = inspectNotesFindHomePrecondition(tree, organizationId, homes);
  report.observations.home_precondition = precondition.diagnostic;
  if (precondition.code) throw new Error(precondition.code);
  const typeId = precondition.typeId;
  const names = [`Harbor Dental Intake ${token}`, `Harbor Dental Follow-up ${token}`];
  for (const name of names) {
    planNotesFindHome(ledger, name);
    await writeLedger(ledgerPath, ledger);
    const answer = await scopeDoor(
      panel,
      origin,
      publishableKey,
      organizationId,
      'context_scope_write',
      {
        p_organization_id: organizationId,
        p_scope_id: null,
        p_type_id: typeId,
        p_spec: { name, slug: name.toLowerCase().replaceAll(' ', '-'), description: '' },
      },
    );
    const scopeId = requireNotesFindHomeWrite(answer, organizationId, name);
    recordNotesFindHomeCreated(ledger, name, scopeId);
    await writeLedger(ledgerPath, ledger);
  }
  const readback = await selectedOrgTree(panel, origin, publishableKey, organizationId);
  for (const home of ledger.owned_homes) {
    if (
      !readback.scopes.some(
        (scope) =>
          scope.id === home.scope_id &&
          scope.organization_id === organizationId &&
          scope.name === home.name,
      )
    )
      throw new Error('notes_find_created_home_readback_missing');
  }
  return { general: precondition.general, homes: ledger.owned_homes };
}

function rootExpression() {
  return `(() => {
    const tab = document.querySelector('button[role="tab"][title="Notes"]');
    return document.getElementById(tab?.getAttribute('aria-controls') ?? '');
  })()`;
}

function t02State(panel) {
  return evaluate(
    panel,
    `(() => {
      const root = ${rootExpression()};
      const tab = document.querySelector('button[role="tab"][title="Notes"]');
      const search = root?.querySelector('input[placeholder="Search notes…"]');
      const home = [...(root?.querySelectorAll('button[aria-expanded]') ?? [])]
        .filter((button) => button.closest('div.relative') && button.textContent.trim());
      const editorTitle = root?.querySelector('input[placeholder="Untitled"]') ?? null;
      const body = root?.querySelector('textarea[placeholder^="Start writing"]') ?? null;
      const homeNames = [...(root?.querySelectorAll('button[aria-expanded="true"] + div ul button') ?? [])]
        .map((button) => button.textContent.trim());
      const list = [...(root?.querySelectorAll('li button') ?? [])].map((button) => ({
        title: button.querySelector('div.truncate')?.textContent?.trim() ??
          button.querySelector('div.min-w-0 > div')?.textContent?.trim() ?? null,
        text: button.textContent.trim(),
      }));
      return {
        active: tab?.getAttribute('data-state') === 'active' && root?.getAttribute('data-state') === 'active',
        create: [...(root?.querySelectorAll('button') ?? [])].some((button) => button.textContent.trim() === 'New note' && !button.disabled),
        editor: Boolean(editorTitle && body),
        title: editorTitle?.value ?? null,
        body: body?.value ?? null,
        saved: root?.textContent.includes('Saved') ?? false,
        saving: root?.textContent.includes('Saving') ?? false,
        search: search?.value ?? null,
        homeLabel: home.length === 1 ? home[0].textContent.trim() : null,
        homeExpanded: home.length === 1 && home[0].getAttribute('aria-expanded') === 'true',
        homeOptions: homeNames,
        rows: list,
      };
    })()`,
  );
}

function beginScopeTreeCapture(panel, origin) {
  const pending = new Map();
  const complete = [];
  let malformed = false;
  const offRequest = panel.on('Network.requestWillBeSent', (event) => {
    try {
      const url = new URL(event.request.url);
      if (url.origin === origin && url.pathname === '/rest/v1/rpc/context_tree')
        pending.set(event.requestId, { status: null });
    } catch {
      malformed = true;
    }
  });
  const offResponse = panel.on('Network.responseReceived', (event) => {
    const request = pending.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  const offFinished = panel.on('Network.loadingFinished', (event) => {
    const request = pending.get(event.requestId);
    if (!request) return;
    void panel
      .send('Network.getResponseBody', { requestId: event.requestId })
      .then((body) => {
        try {
          if (request.status !== 200) return;
          const data = JSON.parse(
            body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body,
          );
          const scopes = Array.isArray(data?.scopes) ? data.scopes : [];
          const types = Array.isArray(data?.types) ? data.types : [];
          if (
            scopes.some(
              (scope) => !UUID.test(scope.id ?? '') || !UUID.test(scope.organization_id ?? ''),
            )
          )
            throw new Error('scope_tree_row_invalid');
          complete.push({ scopes, types });
        } catch {
          malformed = true;
        }
      })
      .catch(() => {
        malformed = true;
      })
      .finally(() => pending.delete(event.requestId));
  });
  return {
    state: () => ({ trees: [...complete], pending: pending.size, malformed }),
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
    },
  };
}

function beginHomeMoveCapture(panel, origin) {
  const requests = new Map();
  const responses = [];
  const offRequest = panel.on('Network.requestWillBeSent', (event) => {
    try {
      const url = new URL(event.request.url);
      if (
        url.origin !== origin ||
        url.pathname !== '/rest/v1/rpc/set_home' ||
        event.request.method !== 'POST'
      )
        return;
      const body = JSON.parse(event.request.postData ?? '{}');
      if (
        body.p_entity_type !== 'note' ||
        !UUID.test(body.p_entity_id ?? '') ||
        !UUID.test(body.p_scope_id ?? '')
      )
        return;
      requests.set(event.requestId, {
        noteId: body.p_entity_id,
        homeScopeId: body.p_scope_id,
        status: null,
      });
    } catch {
      /* This observer retains only well-formed owned-note/home identifiers. */
    }
  });
  const offResponse = panel.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  const offFinished = panel.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    responses.push({ ...request });
    requests.delete(event.requestId);
  });
  return {
    responses: () => [...responses],
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
    },
  };
}

function writeLedger(path, ledger) {
  return writeNotesFindLedger(path, ledger);
}

async function fillControl(panel, selector, value) {
  const target = await waitFor(
    'notes_find_input_hittable',
    () =>
      evaluate(
        panel,
        `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.disabled) return null;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      return rect.width > 0 && rect.height > 0 && el.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    })()`,
      ),
    Boolean,
    10_000,
  );
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
  const selected = await evaluate(
    panel,
    `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return Boolean(el && document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length);
  })()`,
  );
  if (!selected) throw new Error('notes_find_input_selection_not_observed');
  await panel.send('Input.insertText', { text: value });
}

async function openHomePicker(panel, label) {
  const state = await t02State(panel);
  if (!state.homeLabel) throw new Error('notes_find_home_trigger_ambiguous');
  if (!state.homeExpanded) await click(panel, 'button-text', state.homeLabel);
  const opened = await t02State(panel);
  if (!opened.homeExpanded) throw new Error('notes_find_home_picker_did_not_open');
  await waitFor(
    'notes_find_home_options',
    () => t02State(panel),
    (value) => value.homeExpanded && value.homeOptions.includes(label),
    10_000,
  );
}

async function chooseHome(panel, label) {
  await openHomePicker(panel, label);
  await clickBySelector(panel, 'div.relative ul button', label, 'notes_find_home_option');
  await waitFor(
    'notes_find_home_selected',
    () => t02State(panel),
    (value) => value.homeLabel === label,
    15_000,
  );
}

/** EXT-D-0201 only: a canonical General may exist before its scope is initialized. */
export async function runNotesLazyGeneralPicker({
  panel,
  transport,
  origin,
  publishableKey,
  selectedOrganizationId,
}) {
  if (!UUID.test(selectedOrganizationId ?? ''))
    throw new Error('notes_lazy_general_selected_organization_invalid');
  let writeRequests = 0;
  const off = panel.on('Network.requestWillBeSent', (event) => {
    try {
      const url = new URL(event.request.url);
      if (url.origin !== origin || !url.pathname.startsWith('/rest/v1/')) return;
      const readRpc =
        event.request.method === 'POST' &&
        ['/rest/v1/rpc/context_tree', '/rest/v1/rpc/my_homes'].includes(url.pathname);
      if (!readRpc && event.request.method !== 'GET') writeRequests += 1;
    } catch {
      writeRequests += 1;
    }
  });
  const report = {
    case_id: 'EXT-D-0201-picker',
    verdict: 'unverified',
    observations: {},
  };
  try {
    const snapshot = async () => {
      const tree = await selectedOrgTree(panel, origin, publishableKey, selectedOrganizationId);
      const homes = await scopeDoor(
        panel,
        origin,
        publishableKey,
        selectedOrganizationId,
        'my_homes',
        {},
        'platform',
      );
      if (!Array.isArray(homes)) throw new Error('notes_lazy_general_homes_invalid');
      const canonical = homes.filter(
        (home) => home.organization_id === selectedOrganizationId && home.is_general === true,
      );
      if (canonical.length !== 1 || canonical[0].scope_id !== null)
        throw new Error('notes_lazy_general_precondition_missing');
      const home = canonical[0];
      const selectedScopes = tree.scopes.filter(
        (scope) => scope.organization_id === selectedOrganizationId,
      );
      if (
        typeof home.name !== 'string' ||
        !home.name.trim() ||
        typeof home.organization_name !== 'string' ||
        !home.organization_name.trim() ||
        selectedScopes.length !== 0
      )
        throw new Error('notes_lazy_general_precondition_invalid');
      return {
        name: home.name,
        organizationName: home.organization_name,
        selectedOrgScopeCount: selectedScopes.length,
      };
    };
    const before = await snapshot();
    report.observations.before = {
      canonical_general_nullable: true,
      general_scope_absent: true,
      selected_organization_confirmed: true,
    };
    await click(panel, 'title', 'Notes');
    await waitFor(
      'notes_lazy_general_loaded',
      () => t02State(panel),
      (state) => state.active && state.create && state.homeLabel === 'All homes',
      30_000,
    );
    const label = `${before.name} · ${before.organizationName}`;
    await openHomePicker(panel, label);
    const open = await t02State(panel);
    if (open.homeOptions.filter((option) => option === label).length !== 1)
      throw new Error('notes_lazy_general_picker_option_missing');
    await chooseHome(panel, label);
    const selected = await t02State(panel);
    if (!selected.active || selected.homeLabel !== label || selected.homeExpanded)
      throw new Error('notes_lazy_general_selection_unstable');
    const after = await snapshot();
    if (
      after.name !== before.name ||
      after.organizationName !== before.organizationName ||
      after.selectedOrgScopeCount !== 0 ||
      writeRequests !== 0 ||
      (transport?.state().blockedWrites ?? 0) !== 0 ||
      transport?.state().interceptionFailed
    )
      throw new Error('notes_lazy_general_unexpected_write_or_initialization');
    report.observations.picker = {
      synthetic_general_visible: true,
      selected_as_filter: true,
      selection_stable: true,
    };
    report.observations.after = {
      canonical_general_nullable: true,
      general_scope_absent: true,
      unexpected_write_requests: writeRequests,
    };
    report.verdict = 'pass';
  } catch (error) {
    const safeCodes = new Set([
      'notes_lazy_general_selected_organization_invalid',
      'notes_lazy_general_homes_invalid',
      'notes_lazy_general_precondition_missing',
      'notes_lazy_general_precondition_invalid',
      'notes_lazy_general_picker_option_missing',
      'notes_lazy_general_selection_unstable',
      'notes_lazy_general_unexpected_write_or_initialization',
      'notes_find_scope_tree_shape_invalid',
      'notes_find_home_trigger_ambiguous',
      'notes_find_home_picker_did_not_open',
    ]);
    report.failure_code = safeCodes.has(error?.message)
      ? error.message
      : 'notes_lazy_general_unverified';
  } finally {
    off();
  }
  return report;
}

async function clickBySelector(panel, selector, expectedText, label) {
  const point = await evaluate(
    panel,
    `(() => {
    const scope = ${selector.startsWith('[role="option"]') ? 'document' : `document.getElementById(document.querySelector('button[role="tab"][title="Notes"]')?.getAttribute('aria-controls') ?? '')`};
    const candidates = [...(scope?.querySelectorAll(${JSON.stringify(selector)}) ?? [])]
      .filter((element) => element.textContent.trim() === ${JSON.stringify(expectedText)})
      .filter((element) => {
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
    if (candidates.length !== 1) return { count: candidates.length, target: null };
    const element = candidates[0];
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return { count: 1, target: element.contains(document.elementFromPoint(x, y)) ? { x, y } : null };
  })()`,
  );
  if (point?.count !== 1 || !point.target) throw new Error(`${label}_not_unique_or_hittable`);
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point.target,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point.target,
    button: 'left',
    clickCount: 1,
  });
}

async function deleteFixture(panel, transport, fixture, report) {
  let state = await t02State(panel);
  let ownedEditorOpen = false;
  let ownedEditorTitleMatched = false;
  if (state.editor) {
    const selectedId = transport.state().detailIds.at(-1);
    ownedEditorOpen = selectedId === fixture.note_id;
    ownedEditorTitleMatched = state.title === fixture.title;
    if (!ownedEditorOpen) {
      await click(panel, 'button-text', 'Back');
      state = await waitFor(
        'notes_find_cleanup_back_to_list',
        () => t02State(panel),
        (value) => value.active && !value.editor,
        15_000,
      );
    }
  }
  let opened = null;
  let beforeRows = null;
  if (!ownedEditorOpen) {
    beforeRows = await waitFor(
      'notes_find_cleanup_list',
      () => t02State(panel),
      (value) => value.active && !value.editor,
      15_000,
    );
    if (beforeRows.search) {
      await fillControl(panel, 'input[placeholder="Search notes…"]', '');
      beforeRows = await waitFor(
        'notes_find_cleanup_search_cleared',
        () => t02State(panel),
        (value) => value.search === '',
        10_000,
      );
    }
    if (beforeRows.homeLabel !== 'All homes') {
      await chooseHome(panel, 'All homes');
      beforeRows = await waitFor(
        'notes_find_cleanup_all_homes',
        () => t02State(panel),
        (value) => value.homeLabel === 'All homes',
        10_000,
      );
    }
    if (!beforeRows.rows.some((row) => row.title === fixture.title)) return false;
    await clickBySelector(panel, 'li button', fixture.title, 'notes_find_cleanup_row');
    opened = await waitFor(
      'notes_find_cleanup_editor',
      () => t02State(panel),
      (value) => value.editor && value.title === fixture.title,
      20_000,
    );
  }
  const detailIds = transport.state().detailIds;
  const noteId = fixture.note_id ?? detailIds.at(-1);
  if (!UUID.test(noteId ?? '') || (fixture.note_id && detailIds.at(-1) !== fixture.note_id))
    throw new Error('notes_find_cleanup_detail_id_mismatch');
  transport.setOwnedNoteId(noteId);
  const responseCount = transport.state().responses.length;
  await click(panel, 'title', 'Delete note');
  await click(panel, 'button-text', 'Delete');
  const deletion = await waitFor(
    'notes_find_cleanup_real_delete',
    () => transport.state().responses,
    (responses) =>
      responses.length > responseCount &&
      responses
        .slice(responseCount)
        .some(
          (response) =>
            response.ownedDelete &&
            !response.injected &&
            response.status >= 200 &&
            response.status < 300,
        ),
    30_000,
  );
  await waitFor(
    'notes_find_cleanup_row_removed',
    () => t02State(panel),
    (value) =>
      value.active && !value.editor && !value.rows.some((row) => row.title === fixture.title),
    30_000,
  );
  report.cleanup.push({
    note_id: noteId,
    live_delete: true,
    editor_title_confirmed: opened?.title === fixture.title || ownedEditorTitleMatched,
    response_status:
      deletion.slice(responseCount).find((response) => response.ownedDelete)?.status ?? null,
  });
  return noteId;
}

function uniqueScopes(trees) {
  return [
    ...new Map(trees.flatMap((value) => value.scopes).map((scope) => [scope.id, scope])).values(),
  ];
}

function displayHomeName(scopeName, allScopes, organizationName) {
  const matching = allScopes.filter(
    (scope) => scope.name.toLocaleLowerCase() === scopeName.toLocaleLowerCase(),
  );
  if (matching.length === 1) return scopeName;
  if (!organizationName) throw new Error('notes_find_organization_name_required_for_home_label');
  return `${scopeName} · ${organizationName}`;
}

/**
 * Bounded EXT-F-2006-T02 case. It creates and deletes three real notes through
 * the Notes UI and uses only genuine Supabase responses for fixture identity.
 * The fixture ledger is deliberately retained at 0600 for post-run recovery.
 */
export async function runNotesFindAcceptance({
  panel,
  transport,
  origin,
  publishableKey,
  selectedOrganizationId,
  selectedOrganizationName,
  role,
  sourceSha,
  treeSha256,
  ledgerPath,
}) {
  if (!UUID.test(selectedOrganizationId ?? '') || !selectedOrganizationName)
    throw new Error('notes_find_selected_organization_missing');
  const token = randomUUID().slice(0, 8);
  const homeTree = beginScopeTreeCapture(panel, origin);
  const moves = beginHomeMoveCapture(panel, origin);
  const report = {
    case_id: 'EXT-F-2006-T02',
    verdict: 'unverified',
    observations: {},
    cleanup: [],
    ledger_path: ledgerPath,
  };
  const ledger = createNotesFindLedger({
    runId: `notes-t02-${Date.now()}`,
    organizationId: selectedOrganizationId,
    role,
    sourceSha,
    treeSha256,
  });
  let ledgerStarted = false;
  let testError;
  try {
    ledgerStarted = true;
    await writeLedger(ledgerPath, ledger);
    const owned = await makeOwnedHomes(
      panel,
      origin,
      publishableKey,
      selectedOrganizationId,
      ledger,
      ledgerPath,
      token,
      report,
    );
    await click(panel, 'title', 'Notes');
    await waitFor(
      'notes_find_list_ready',
      () => t02State(panel),
      (state) => state.active && state.create,
      45_000,
    );
    const treeResult = await waitFor(
      'notes_find_live_scope_tree',
      homeTree.state,
      (state) => state.trees.length > 0 || state.malformed,
      20_000,
    );
    if (treeResult.malformed || treeResult.trees.length === 0)
      throw new Error('notes_find_home_tree_not_observed');
    const allVisibleScopes = uniqueScopes(treeResult.trees);
    const activeOrgScopes = allVisibleScopes.filter(
      (scope) => scope.organization_id === selectedOrganizationId,
    );
    const generals = activeOrgScopes.filter((scope) => scope.id === owned.general.id);
    const customs = owned.homes.map((home) =>
      activeOrgScopes.find((scope) => scope.id === home.scope_id && scope.name === home.name),
    );
    if (
      generals.length !== 1 ||
      generals[0].id !== owned.general.id ||
      customs.some((scope) => !scope)
    )
      throw new Error('notes_find_three_home_fixture_unavailable');
    const names = [generals[0].name, ...customs.map((scope) => scope.name)];
    if (new Set(names.map((value) => value.toLocaleLowerCase())).size !== 3)
      throw new Error('notes_find_home_names_not_unique');
    const homeLabels = names.map((name) =>
      displayHomeName(name, allVisibleScopes, selectedOrganizationName),
    );
    await openHomePicker(panel, (await t02State(panel)).homeLabel);
    const visibleHomes = (await t02State(panel)).homeOptions;
    if (homeLabels.some((label) => !visibleHomes.includes(label)))
      throw new Error('notes_find_home_picker_tree_mismatch');
    await clickBySelector(
      panel,
      'div.relative ul button',
      'All homes',
      'notes_find_all_homes_option',
    );

    const fixtures = [];
    const fixtureTitles = [
      `Harbor Dental intake insurance eligibility ${token}`,
      `Harbor Dental intake paperwork review ${token}`,
      `Harbor Dental intake pre-visit coordination ${token}`,
    ];
    for (let index = 0; index < fixtureTitles.length; index++) {
      const title = fixtureTitles[index];
      const previousIds = transport.state().createdNoteIds.length;
      await click(panel, 'button-text', 'New note');
      await waitFor(
        'notes_find_created_editor',
        () => t02State(panel),
        (state) => state.editor,
        20_000,
      );
      const created = await waitFor(
        'notes_find_created_supabase_id',
        transport.state,
        (state) => state.createdNoteIds.length > previousIds && !state.interceptionFailed,
        20_000,
      );
      const noteId = created.createdNoteIds[previousIds];
      if (!UUID.test(noteId ?? '')) throw new Error('notes_find_create_response_id_missing');
      await recordNotesFindInsertBeforeValidation({
        ledger,
        noteId,
        title,
        ledgerPath,
        validate: () => {
          fixtures.push({ note_id: noteId, title, home_scope_id: null, home_label: null });
        },
      });
      const fixture = fixtures.at(-1);
      transport.setOwnedNoteId(noteId);
      const currentDetailIds = transport.state().detailIds;
      if (!currentDetailIds.includes(noteId))
        throw new Error('notes_find_create_detail_not_opened');
      await fillControl(panel, 'input[placeholder="Untitled"]', title);
      await waitFor(
        'notes_find_title_saved',
        () => t02State(panel),
        (state) => state.title === title && state.saved && !state.saving,
        45_000,
      );
      const createdHome = await waitFor(
        'notes_find_create_home_readback',
        () => t02State(panel),
        (state) => state.editor && state.homeLabel === homeLabels[0],
        20_000,
      );
      const generalHomeId = activeOrgScopes.find((scope) => scope.name === names[0])?.id;
      if (!UUID.test(generalHomeId ?? '')) throw new Error('notes_find_general_home_id_missing');
      recordNotesFindHomeAssigned(ledger, noteId, generalHomeId);
      fixture.home_scope_id = generalHomeId;
      fixture.home_label = homeLabels[0];
      await writeLedger(ledgerPath, ledger);
      if (index > 0) {
        await chooseHome(panel, homeLabels[index]);
        const requestedHomeId = activeOrgScopes.find((scope) => scope.name === names[index])?.id;
        const moved = await waitFor(
          'notes_find_home_write',
          moves.responses,
          (responses) =>
            responses.some(
              (item) =>
                item.noteId === noteId &&
                item.homeScopeId === requestedHomeId &&
                item.status >= 200 &&
                item.status < 300,
            ),
          30_000,
        );
        recordNotesFindHomeAssigned(ledger, noteId, requestedHomeId);
        fixture.home_scope_id = requestedHomeId;
        fixture.home_label = homeLabels[index];
        await writeLedger(ledgerPath, ledger);
        report.observations[`home_move_${index}`] = {
          real_rpc_response: moved.some(
            (item) =>
              item.noteId === noteId &&
              item.homeScopeId === requestedHomeId &&
              item.status >= 200 &&
              item.status < 300,
          ),
        };
      }
      const homeReadback = await waitFor(
        'notes_find_home_readback',
        () => t02State(panel),
        (state) => state.editor && state.homeLabel === homeLabels[index],
        30_000,
      );
      report.observations[`fixture_${index + 1}`] = {
        created_by_real_ui: true,
        live_note_id_observed: true,
        home_label_readback: homeReadback.homeLabel,
        home_move_http_status:
          index === 0
            ? null
            : (moves.responses().find((item) => item.noteId === noteId)?.status ?? null),
        created_in_general: index === 0 && createdHome.homeLabel === homeLabels[0],
      };
      if (index < 2) {
        await click(panel, 'button-text', 'Back');
        await waitFor(
          'notes_find_back_to_list',
          () => t02State(panel),
          (state) => state.active && !state.editor,
          15_000,
        );
      }
    }

    await click(panel, 'button-text', 'Back');
    await waitFor(
      'notes_find_list_after_fixtures',
      () => t02State(panel),
      (state) => state.active && !state.editor,
      20_000,
    );
    const allHomeState = await t02State(panel);
    if (!allHomeState.homeLabel) throw new Error('notes_find_filter_label_missing');
    if (allHomeState.homeLabel !== 'All homes') await chooseHome(panel, 'All homes');
    const allRows = await waitFor(
      'notes_find_all_homes_rows',
      () => t02State(panel),
      (state) =>
        state.rows.filter((row) => fixtures.some((item) => item.title === row.title)).length === 3,
      30_000,
    );
    const input = 'input[placeholder="Search notes…"]';
    await fillControl(panel, input, token);
    const searched = await waitFor(
      'notes_find_unique_title_search',
      () => t02State(panel),
      (state) => {
        const found = state.rows.filter((row) => fixtures.some((item) => item.title === row.title));
        return state.search === token && found.length === 3;
      },
      20_000,
    );
    if (!searched.rows.every((row) => row.title.includes(token)))
      throw new Error('notes_find_search_returned_unowned_title');
    report.observations.search_by_unique_title = { matches: 3, only_run_titles: true };
    await fillControl(panel, input, '');
    await waitFor(
      'notes_find_search_cleared',
      () => t02State(panel),
      (state) => state.search === '',
      10_000,
    );
    report.observations.all_homes_filter = {
      selected: (await t02State(panel)).homeLabel === 'All homes',
      owned_fixture_count: allRows.rows.filter((row) =>
        fixtures.some((item) => item.title === row.title),
      ).length,
    };

    for (let index = 1; index < 3; index++) {
      const fixture = fixtures[index];
      await chooseHome(panel, fixture.home_label);
      const filtered = await waitFor(
        `notes_find_named_home_${index}`,
        () => t02State(panel),
        (state) => {
          const found = state.rows.filter((row) =>
            fixtures.some((item) => item.title === row.title),
          );
          return (
            state.homeLabel === fixture.home_label &&
            found.length === 1 &&
            found[0].title === fixture.title
          );
        },
        30_000,
      );
      report.observations[`named_home_filter_${index}`] = {
        one_owned_note: filtered.rows.some((row) => row.title === fixture.title),
      };
      if (index === 1) {
        const selectorLabel = await evaluate(
          panel,
          `(() => {
          const root = ${rootExpression()};
          return [...(root?.querySelectorAll('button[role="combobox"]') ?? [])]
            .find((button) => button.textContent.trim() === '1 note')?.textContent.trim() ?? null;
        })()`,
        );
        if (!selectorLabel) throw new Error('notes_find_note_selector_unavailable');
        await clickBySelector(
          panel,
          'button[role="combobox"]',
          selectorLabel,
          'notes_find_note_selector',
        );
        await clickBySelector(
          panel,
          '[role="option"]',
          fixture.title,
          'notes_find_selector_option',
        );
        await waitFor(
          'notes_find_selector_note_open',
          () => t02State(panel),
          (state) => state.editor && state.title === fixture.title,
          20_000,
        );
        report.observations.note_selector_open = true;
        await click(panel, 'button-text', 'Back');
        await waitFor(
          'notes_find_selector_return',
          () => t02State(panel),
          (state) => state.active && !state.editor,
          15_000,
        );
      } else {
        await click(panel, 'button-text', fixture.title);
        await waitFor(
          'notes_find_row_note_open',
          () => t02State(panel),
          (state) => state.editor && state.title === fixture.title,
          20_000,
        );
        report.observations.note_row_open = true;
        await click(panel, 'button-text', 'Back');
        await waitFor(
          'notes_find_row_return',
          () => t02State(panel),
          (state) => state.active && !state.editor,
          15_000,
        );
      }
      await chooseHome(panel, 'All homes');
    }
    report.observations.general_default_fixture = true;
    report.observations.no_unassigned_home_filter =
      'not-applicable: every note has one required home; General represents no specific home.';
    report.observations.body_search = 'not claimed; current test uses title-only query.';
  } catch (error) {
    testError = error;
  } finally {
    try {
      if (ledgerStarted) {
        for (const fixture of [...ledger.fixtures].reverse()) {
          try {
            const deleteResult = await deleteFixture(panel, transport, fixture, report);
            if (!deleteResult) {
              report.cleanup.push({ note_id: fixture.note_id, live_delete: false });
              continue;
            }
            recordNotesFindDeleted(ledger, fixture.note_id);
            await writeLedger(ledgerPath, ledger);
          } catch {
            report.cleanup.push({ note_id: fixture.note_id, live_delete: false });
          }
        }
      }
      if (ledger.fixtures.some((item) => item.status === 'created')) {
        report.cleanup_pending = ledger.fixtures
          .filter((item) => item.status === 'created')
          .map((item) => item.note_id);
      }
      if (ledger.owned_homes.length) {
        const recoveryTree = await selectedOrgTree(
          panel,
          origin,
          publishableKey,
          selectedOrganizationId,
        ).catch(() => ({ scopes: [] }));
        for (const home of [...ledger.owned_homes].reverse()) {
          if (home.status === 'archived_confirmed') continue;
          const found = recoveryTree.scopes.filter(
            (scope) => scope.organization_id === selectedOrganizationId && scope.name === home.name,
          );
          if (home.status === 'planned' && found.length === 1) {
            recordNotesFindHomeCreated(ledger, home.name, found[0].id);
            await writeLedger(ledgerPath, ledger);
          }
          if (
            home.status !== 'created' ||
            !UUID.test(home.scope_id ?? '') ||
            ledger.fixtures.some((item) => item.status === 'created')
          )
            continue;
          try {
            await scopeDoor(
              panel,
              origin,
              publishableKey,
              selectedOrganizationId,
              'context_scope_archive',
              {
                p_scope_id: home.scope_id,
              },
            );
            const archivedTree = await selectedOrgTree(
              panel,
              origin,
              publishableKey,
              selectedOrganizationId,
            );
            if (!archivedTree.scopes.some((scope) => scope.id === home.scope_id)) {
              recordNotesFindHomeArchived(ledger, home.scope_id);
              await writeLedger(ledgerPath, ledger);
            }
          } catch {
            /* The private ledger retains the exact owned scope for recovery. */
          }
        }
      }
      report.home_cleanup_pending = ledger.owned_homes
        .filter((item) => item.status !== 'archived_confirmed')
        .map((item) => ({ name: item.name, scope_id: item.scope_id }));
      report.cleanup_complete =
        ledger.status === 'deleted_confirmed' && report.home_cleanup_pending.length === 0;
      if (ledgerStarted) await writeLedger(ledgerPath, ledger);
    } catch {
      report.cleanup_complete = false;
      report.cleanup_pending = ledger.fixtures
        .filter((item) => item.status === 'created')
        .map((item) => item.note_id);
    }
    homeTree.stop();
    moves.stop();
  }

  report.verdict = !testError && report.cleanup_complete ? 'pass' : 'unverified';
  if (testError) report.failure_code = testError.message?.split(':')[0] ?? 'notes_find_case_failed';
  if (!report.cleanup_complete) report.failure_code ??= 'notes_find_cleanup_incomplete';
  return report;
}
