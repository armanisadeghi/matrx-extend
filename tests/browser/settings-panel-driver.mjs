import assert from 'node:assert/strict';

// DOM observation/viewport preparation plus trusted CDP input in the owned panel.
export async function evaluate(panel, expression) {
  const response = await panel.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error('panel_runtime_exception');
  return response.result?.value;
}

export async function waitFor(
  label,
  read,
  accept,
  timeoutMs = 10000,
  diagnostic = (value) => value,
) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    try {
      last = await read();
    } catch (error) {
      // A panel reload briefly destroys its JavaScript execution context.
      last = { transient: String(error?.message ?? error) };
    }
    if (accept(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  } while (Date.now() < deadline);
  throw new Error(`${label}_not_observed:${JSON.stringify(diagnostic(last))}`);
}

// A replacement CDP target can exist before React mounts its tabs. Do not
// dispatch a native pointer until the same visible Settings target is ready.
export async function waitForReplacementSettingsTab(panel, timeoutMs = 10000) {
  let first;
  const last = await waitFor(
    'replacement_settings_tab_ready',
    async () => {
      const sample = await evaluate(
        panel,
        `(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"][title="Settings"]')];
    const visible = tabs.filter((tab) => {
      const style = getComputedStyle(tab), rect = tab.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !tab.closest('[inert]');
    });
    return { matched: tabs.length, visible: visible.length };
  })()`,
      );
      first ??= sample;
      return sample;
    },
    (sample) => sample?.matched === 1 && sample.visible === 1,
    timeoutMs,
  );
  return { first, last };
}

export async function openSection(panel, label) {
  const section = await waitFor(
    `${label}_section_ready`,
    () =>
      evaluate(
        panel,
        `(() => {
    const buttons = [...document.querySelectorAll('button[aria-expanded]')]
      .filter((el) => el.textContent.trim() === ${JSON.stringify(label)});
    return { count: buttons.length, expanded: buttons[0]?.getAttribute('aria-expanded') ?? null };
  })()`,
      ),
    (state) => state?.count === 1 && (state.expanded === 'true' || state.expanded === 'false'),
  );
  const expanded = section.expanded;
  if (expanded === 'false') await click(panel, 'section', label);
  await waitFor(
    `${label}_expanded`,
    () =>
      evaluate(
        panel,
        `(() =>
    [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(label)})
      ?.getAttribute('aria-expanded'))()`,
      ),
    (value) => value === 'true',
  );
}

// Only fixed booleans/counts leave the native page; account names, email,
// organization names, links and storage values never enter a test receipt.
export async function guestSettingsState(panel) {
  return evaluate(
    panel,
    `(async () => {
    const stored = await chrome.storage.local.get([
      'matrx.auth.accessToken', 'matrx.user.profile', 'matrx.org.active',
    ]);
    const tabs = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
      .filter((tab) => tab.title === 'Settings');
    const id = tabs.length === 1 ? tabs[0].getAttribute('aria-controls') : null;
    const root = id ? document.getElementById(id) : null;
    const active = root?.matches('[role="tabpanel"][data-state="active"]') === true;
    const section = (label) => {
      const buttons = [...(root?.querySelectorAll('button[aria-expanded]') ?? [])]
        .filter((button) => button.textContent.trim() === label);
      const content = buttons.length === 1
        ? document.getElementById(buttons[0].getAttribute('aria-controls') ?? '') : null;
      return { count: buttons.length, open: buttons[0]?.getAttribute('aria-expanded') === 'true', content };
    };
    const account = section('Account'), organization = section('Organization');
    const rows = (content) => [...(content?.querySelectorAll('div.flex.items-center.justify-between') ?? [])];
    const row = (content, label) => rows(content).filter((item) =>
      item.firstElementChild?.textContent?.trim() === label);
    const email = row(account.content, 'Email');
    const org = row(organization.content, 'Organization');
    const allOrgText = organization.content?.textContent ?? '';
    const compactText = (value) => value.replace(/\\s+/g, ' ').trim();
    const organizationOnlyGuestRow = org.length === 1 && org[0].children.length === 2 &&
      rows(organization.content).length === 1 &&
      compactText(allOrgText) === compactText(org[0].textContent ?? '');
    return {
      active,
      accessTokenPresent: typeof stored['matrx.auth.accessToken'] === 'string',
      profilePresent: Boolean(stored['matrx.user.profile']?.id),
      organizationChoicePresent: Boolean(stored['matrx.org.active']?.id),
      accountSectionCount: account.count, accountOpen: account.open,
      emailRowCount: email.length, emailUnavailable: email.length === 1 &&
        email[0].lastElementChild?.textContent?.trim() === '—',
      nameRowCount: row(account.content, 'Name').length,
      roleRowCount: row(account.content, 'Role').length,
      footerSignInCount: [...(root?.querySelectorAll('button') ?? [])]
        .filter((button) => button.textContent.trim() === 'Sign in').length,
      footerSignOutCount: [...(root?.querySelectorAll('button') ?? [])]
        .filter((button) => button.textContent.trim() === 'Sign out').length,
      organizationSectionCount: organization.count, organizationOpen: organization.open,
      signInToChooseCount: org.filter((item) =>
        item.lastElementChild?.textContent?.trim() === 'Sign in to choose').length,
      organizationOnlyGuestRow,
      archiveFilterCount: organization.content?.querySelectorAll('[aria-label="Filter organizations by archive status"]').length ?? 0,
      actingAsRowCount: row(organization.content, 'Acting as').length,
      archivedMarkerCount: [...(organization.content?.querySelectorAll('span') ?? [])]
        .filter((span) => span.textContent.trim() === 'Archived · view only').length,
      restorationActionCount: [...(organization.content?.querySelectorAll('a,button') ?? [])]
        .filter((node) => node.textContent.includes('Open Organizations to restore an archived organization')).length,
      archivedCopyPresent: allOrgText.includes('Archived · view only'),
    };
  })()`,
  );
}

export function guestSettingsChecks(state, organizationRequests) {
  const signedOut =
    state?.active === true &&
    state.accessTokenPresent === false &&
    state.profilePresent === false &&
    state.organizationChoicePresent === false &&
    state.accountSectionCount === 1 &&
    state.emailRowCount === 1 &&
    state.emailUnavailable === true &&
    state.footerSignInCount === 1 &&
    state.footerSignOutCount === 0;
  return {
    signedOut,
    account:
      signedOut &&
      state.accountOpen === true &&
      state.nameRowCount === 0 &&
      state.roleRowCount === 0,
    organization:
      signedOut &&
      state.organizationSectionCount === 1 &&
      state.organizationOpen === true &&
      state.signInToChooseCount === 1 &&
      state.organizationOnlyGuestRow === true &&
      state.archiveFilterCount === 0 &&
      state.actingAsRowCount === 0 &&
      organizationRequests === 0,
    archivedManagement:
      signedOut &&
      state.organizationSectionCount === 1 &&
      state.organizationOpen === true &&
      state.signInToChooseCount === 1 &&
      state.organizationOnlyGuestRow === true &&
      state.archivedMarkerCount === 0 &&
      state.restorationActionCount === 0 &&
      state.archivedCopyPresent === false,
  };
}

// Transport only this allowlisted summary into sensitive acceptance receipts.
// Never derive a category from raw browser/transport exception messages.
function pointerFailure(code, location) {
  const message =
    code === 'pointer_target_not_unique'
      ? 'unique visible pointer target'
      : code === 'pointer_stable_hit_not_observed'
        ? 'stable hit target for pointer'
        : code === 'pointer_followup_evaluation_failed' || code === 'pointer_page_sample_failed'
          ? 'pointer_sample_failed for pointer'
          : code;
  const error = new Error(message);
  const pointer = location?.pointerDiagnostic;
  const dataTabDiagnostic = location?.dataTabTargetDiagnostic;
  const safeCount = (value) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : null;
  error.driverFailure = {
    code,
    sampleStage: location?.sampleFailureStage ?? null,
    matchedTargetCount: Number.isInteger(location?.matchedCount) ? location.matchedCount : null,
    visibleMatchCount: Number.isInteger(location?.count) ? location.count : null,
    uniqueVisibleTarget: location?.count === 1,
    toolsPanelActive:
      typeof location?.toolsPanelActive === 'boolean' ? location.toolsPanelActive : null,
    toolsViewState: location?.toolsViewState ?? null,
    toolsCatalogRowCount: Number.isInteger(location?.toolsCatalogRowCount)
      ? location.toolsCatalogRowCount
      : null,
    toolsCatalogSearchEmpty: location?.toolsCatalogSearchEmpty ?? null,
    toolsCatalogFiltersDefault: location?.toolsCatalogFiltersDefault ?? null,
    dataPanelDiagnostic: location?.dataPanelDiagnostic ?? null,
    dataTabTargetDiagnostic:
      dataTabDiagnostic && typeof dataTabDiagnostic === 'object'
        ? {
            matching_tab_count: safeCount(dataTabDiagnostic.matching_tab_count),
            visible_tab_count: safeCount(dataTabDiagnostic.visible_tab_count),
            active_tab_count: safeCount(dataTabDiagnostic.active_tab_count),
            active_data_pane_count: safeCount(dataTabDiagnostic.active_data_pane_count),
          }
        : null,
    hitTarget: location?.hitTarget === true,
    animating: location?.animating === true,
    stableSamples: location?.stableSamples ?? 0,
    positionStable: location?.positionStable === true,
    targetHasArea: pointer ? pointer.target_rect.width > 0 && pointer.target_rect.height > 0 : null,
    clippedTargetHasArea: pointer
      ? pointer.clipped_rect.width > 0 && pointer.clipped_rect.height > 0
      : null,
    selectedPointAvailable: pointer?.selected_point_available ?? null,
    centerHitCategory: pointer?.center_hit_category ?? null,
    targetDisabled: pointer?.target_disabled ?? null,
    pointerEventsNone: pointer?.target_pointer_events_none ?? null,
    clippingAncestorCount: pointer?.clipping_ancestor_count ?? null,
    testedPointCount: pointer?.tested_point_count ?? null,
    interiorHitKinds: pointer?.interior_hit_kinds ?? null,
    targetRectangle: pointer?.target_rect ?? null,
    centerOccluder: pointer?.center_occluder ?? null,
    firstInteriorOccluder: pointer?.first_interior_occluder ?? null,
  };
  return error;
}

// Resolve only the panel owned by one active tab, including when sibling views
// remain mounted. Shared by observations and trusted pointer target resolution.
export function activeTabPanelExpression(title) {
  return `(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
      .filter((tab) => tab.title === ${JSON.stringify(title)});
    const id = tabs.length === 1 ? tabs[0].getAttribute('aria-controls') : null;
    const pane = id ? document.getElementById(id) : null;
    return pane?.matches('[role="tabpanel"][data-state="active"]') ? pane : null;
  })()`;
}

// Failure receipts need enough context to distinguish a missing or relabelled
// control from a pointer-hit problem without transporting arbitrary UI text.
export function dataPanelDiagnosticExpression() {
  return `(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"][data-state="active"]')]
      .filter((tab) => tab.title === 'Data');
    const id = tabs.length === 1 ? tabs[0].getAttribute('aria-controls') : null;
    const pane = id ? document.getElementById(id) : null;
    const active = pane?.matches('[role="tabpanel"][data-state="active"]') === true;
    const knownLabels = new Set([
      'Pick fields on this page', 'Picking on page…', 'Sign in to save',
      'Save pattern', 'Run pattern', 'Run', 'Clear selection',
    ]);
    const buttons = [...(pane?.querySelectorAll('button') ?? [])];
    return {
      active_tab_count: tabs.length,
      pane_id: pane?.id ?? null,
      pane_active: active,
      button_count: buttons.length,
      buttons: buttons.map((button) => ({
        label: knownLabels.has(button.textContent.trim()) ? button.textContent.trim() : 'other',
        disabled: button.disabled,
        visible: (() => {
          const style = getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
            style.display !== 'none' && !button.closest('[inert]');
        })(),
      })),
      picker_prompt_present: (pane?.textContent ?? '').includes('Pick fields on this page'),
      guest_explanation_present: (pane?.textContent ?? '').includes('Field selection works as a guest.'),
    };
  })()`;
}

export async function dataPanelDiagnostic(panel) {
  return evaluate(panel, dataPanelDiagnosticExpression());
}

export function dataPickerControlReady(state) {
  return (
    state?.pane_active === true &&
    state.buttons?.some(
      (button) => button.label === 'Pick fields on this page' && button.visible === true,
    ) === true
  );
}

// EXT-D-0177: the outer Tools tab becomes active before its lazy Catalog can mount.
// This observation contains only a fixed state label and cannot dispatch input.
export async function toolsCatalogState(panel) {
  return evaluate(
    panel,
    `(() => {
      const pane = ${activeTabPanelExpression('Tools')};
      if (!pane) return 'inactive';
      const tab = [...pane.querySelectorAll('[role="tab"]')]
        .find((el) => el.textContent.trim() === 'Catalog');
      if (!tab) return pane.querySelector('.animate-spin') ? 'loading' : 'unknown';
      if (tab.getAttribute('data-state') !== 'active') return 'other_tab';
      return pane.querySelector('input[placeholder="Search by name or description…"]')
        ? 'catalog' : 'loading';
    })()`,
  );
}

export async function click(panel, kind, label, onPhase = undefined) {
  const pointerSample = () =>
    evaluate(
      panel,
      `(() => {
    const kind = ${JSON.stringify(kind)}, label = ${JSON.stringify(label)};
    let sampleFailureStage = 'target_resolution';
    try {
    const visible = (el) => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !el.closest('[inert]');
    };
    let candidates;
    let toolsPanelActive = null;
    let toolsViewState = null, toolsCatalogRowCount = null;
    let toolsCatalogSearchEmpty = null, toolsCatalogFiltersDefault = null;
    let dataPanelDiagnostic = null;
    let dataTabTargetDiagnostic = null;
    // The shared title tooltip temporarily preserves a hovered title in data-matrx-title.
    if (kind === 'title') {
      candidates = [...document.querySelectorAll('button[title], button[data-matrx-title]')]
        .filter((el) => (el.getAttribute('title') ?? el.getAttribute('data-matrx-title')) === label);
      if (label === 'Data') {
        const dataTabs = [...document.querySelectorAll('button[role="tab"][title="Data"], button[role="tab"][data-matrx-title="Data"]')];
        const visibleDataTabs = dataTabs.filter(visible);
        const activeDataTabs = visibleDataTabs.filter((tab) =>
          tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true');
        dataTabTargetDiagnostic = {
          matching_tab_count: dataTabs.length,
          visible_tab_count: visibleDataTabs.length,
          active_tab_count: activeDataTabs.length,
          active_data_pane_count: activeDataTabs.filter((tab) => {
            const pane = document.getElementById(tab.getAttribute('aria-controls') ?? '');
            return pane?.matches('[role="tabpanel"][data-state="active"]') === true;
          }).length,
        };
      }
    }
    else if (kind === 'active-chat-send') {
      const chatPanel = ${activeTabPanelExpression('Chat')};
      candidates = [...(chatPanel?.querySelectorAll('button[title="Send"], button:not([title])[data-matrx-title="Send"]') ?? [])]
        .filter((el) => label === 'Send');
    }
    else if (kind === 'context-values') {
      const chatTab = [...document.querySelectorAll('button[role="tab"][title="Chat"]')]
        .find((el) => el.getAttribute('aria-selected') === 'true');
      const chatPanel = chatTab ? document.getElementById(chatTab.getAttribute('aria-controls') ?? '') : null;
      candidates = [...(chatPanel?.querySelectorAll('button[aria-label]') ?? [])]
        .filter((el) => /^[0-9]+ included$/.test(el.getAttribute('aria-label') ?? ''));
    }
    else if (kind === 'settings-button') candidates = [...(${activeTabPanelExpression('Settings')}?.querySelectorAll('button') ?? [])]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'settings-ask-again') candidates = [...(${activeTabPanelExpression('Settings')}?.querySelectorAll('li') ?? [])]
      .filter((row) => row.querySelector('span')?.textContent.trim() === label)
      .flatMap((row) => [...row.querySelectorAll('button')])
      .filter((button) => button.textContent.trim() === 'Ask again');
    else if (kind === 'screenshot-open') {
      const tab=document.querySelector('button[role="tab"][title="Screenshots"][data-state="active"]');
      const pane=tab?document.getElementById(tab.getAttribute('aria-controls')):null;
      const cards=[...(pane?.querySelectorAll('div.group')??[])]
        .filter(card=>card.querySelectorAll('button[title="Open in Files"]').length===2);
      const buttons=cards.length===1?[...cards[0].querySelectorAll('button[title="Open in Files"]')]:[];
      candidates=buttons.length===2 && (label==='thumbnail'||label==='icon')
        ? [buttons[label==='thumbnail'?0:1]] : [];
    }
    else if (kind === 'button-text') candidates = [...document.querySelectorAll('button')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'data-picker-button') {
      const pane = ${activeTabPanelExpression('Data')};
      candidates = [...(pane?.querySelectorAll('button') ?? [])]
        .filter((el) => el.textContent.trim() === label);
      dataPanelDiagnostic = ${dataPanelDiagnosticExpression()};
    }
    else if (kind === 'data-save-button') {
      const pane = ${activeTabPanelExpression('Data')};
      candidates = [...(pane?.querySelectorAll('button') ?? [])]
        .filter((el) => el.textContent.trim() === label && label === 'Save pattern');
    }
    else if (kind === 'data-pattern-name') {
      const pane = ${activeTabPanelExpression('Data')};
      candidates = label === 'Pattern name…'
        ? [...(pane?.querySelectorAll('input[placeholder="Pattern name…"]') ?? [])]
        : [];
    }
    else if (kind === 'tool-row') {
      const pane = ${activeTabPanelExpression('Tools')};
      toolsPanelActive = Boolean(pane);
      if (pane) {
        const tab = [...pane.querySelectorAll('[role="tab"]')]
          .find((el) => el.textContent.trim() === 'Catalog');
        const search = pane.querySelector('input[placeholder="Search by name or description…"]');
        toolsViewState = !tab ? (pane.querySelector('.animate-spin') ? 'loading' : 'unknown')
          : tab.getAttribute('data-state') === 'active' ? (search ? 'catalog' : 'loading') : 'other_tab';
        if (search) {
          toolsCatalogRowCount = pane.querySelectorAll('button span.font-mono').length;
          toolsCatalogSearchEmpty = search.value.trim() === '';
          const filters = [...pane.querySelectorAll('button[role="combobox"]')]
            .map((el) => el.textContent.trim());
          toolsCatalogFiltersDefault = filters.length === 3 &&
            filters[0].startsWith('All (') && filters[1].startsWith('Agent surface (') &&
            filters[2].startsWith('All categories (');
        }
      }
      candidates = [...(pane?.querySelectorAll('button') ?? [])]
        .filter((el) => el.querySelector('span.font-mono')?.textContent.trim() === label);
    }
    else if (kind === 'save-pattern-name') candidates = [...document.querySelectorAll('[data-radix-popper-content-wrapper]')]
      .filter((wrapper) => [...wrapper.querySelectorAll('button')]
        .some((button) => button.textContent.trim() === 'Save'))
      .flatMap((wrapper) => [...wrapper.querySelectorAll('input')])
      .filter((input) => label === 'Save pattern');
    else if (kind === 'scrape-result-tab') {
      const pane = ${activeTabPanelExpression('Scrape')};
      candidates = [...(pane?.querySelectorAll('[role="tablist"] [role="tab"]') ?? [])]
        .filter((el) => el.firstChild?.textContent?.trim() === label);
    }
    else if (kind === 'copy-menu-option' || kind === 'scrape-copy-option') candidates = [...document.querySelectorAll('[data-radix-popper-content-wrapper] button')]
      .filter((el) => el.querySelector('span.truncate')?.textContent.trim() === label);
    else if (kind.startsWith('scrape-media-')) {
      const pane = ${activeTabPanelExpression('Scrape')};
      const tab = pane?.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      const content = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
      if (kind === 'scrape-media-remove') candidates = [...(content?.querySelectorAll('a') ?? [])]
        .filter((a) => a.href === label)
        .flatMap((a) => [...(a.parentElement?.querySelectorAll('button[title^="Remove "]') ?? [])]);
      else if (kind === 'scrape-media-copy') candidates = [...(content?.querySelectorAll('a') ?? [])]
        .filter((a) => a.href === label)
        .flatMap((a) => [...(a.parentElement?.querySelectorAll('button[title^="Copy "], button:not([title])[data-matrx-title^="Copy "]') ?? [])]);
      else if (kind === 'scrape-media-open') candidates = [...(content?.querySelectorAll('a') ?? [])]
        .filter((a) => a.href === label);
      else if (kind === 'scrape-media-add-row') candidates = [...(content?.querySelectorAll('button') ?? [])]
        .filter((el) => el.textContent.trim() === label);
      else if (kind === 'scrape-media-form-action') candidates = [...(content?.querySelectorAll('button') ?? [])]
        .filter((el) => el.textContent.trim() === label);
      else if (kind === 'scrape-media-form-field') candidates = [...(content?.querySelectorAll('input') ?? [])]
        .filter((el) => el.placeholder ===
          (label === 'src' || label === 'href' ? 'https://…' :
            label === 'text' ? 'anchor text (optional)' : 'alt text (optional)'));
      else candidates = [];
    }
    else if (kind === 'scrape-dismiss') {
      const pane = ${activeTabPanelExpression('Scrape')};
      candidates = [...(pane?.querySelectorAll('button[aria-label="Dismiss"]') ?? [])]
        .filter((el) => label === 'Dismiss');
    }
    else if (kind === 'section') candidates = [...document.querySelectorAll('button[aria-expanded]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'theme' || kind === 'settings-select') candidates = [...(${activeTabPanelExpression('Settings')}?.querySelectorAll('span') ?? [])]
      .filter((el) => el.textContent.trim() === (kind === 'theme' ? 'Theme' : label))
      .flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    else if (kind === 'organization') candidates = [...document.querySelectorAll('span')]
      .filter((el) => el.textContent.trim() === 'Acting as')
      .flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    else if (kind === 'organization-option') candidates = [...document.querySelectorAll('span')]
      .filter((el) => el.textContent.trim() === 'Acting as')
      .flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')])
      .filter((trigger) => trigger.getAttribute('aria-expanded') === 'true')
      .flatMap((trigger) => {
        const id = trigger.getAttribute('aria-controls');
        const menu = id ? document.getElementById(id) : null;
        return menu?.getAttribute('role') === 'listbox' && menu.getAttribute('data-state') === 'open'
          ? [...menu.querySelectorAll('[role="option"]')] : [];
      })
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'capture-no-workspace-dismiss') candidates = [...document.querySelectorAll('[role="alert"]')]
      .filter((el) => el.querySelector('.font-medium')?.textContent.trim() === 'Capture list unavailable'
        && el.querySelector('p')?.textContent.includes('no workspace is selected, so the request was never sent'))
      .flatMap((el) => [...el.querySelectorAll('button[aria-label="Dismiss"]')]);
    else if (kind === 'port') candidates = [...document.querySelectorAll('input[placeholder="auto"]')];
    else if (kind === 'switch') candidates = [...document.querySelectorAll('[role="switch"][aria-label]')]
      .filter((el) => el.getAttribute('aria-label') === label);
    else if (kind === 'option') candidates = [...document.querySelectorAll('[role="option"]')]
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'organization-picker-choice') candidates = [...document.querySelectorAll('[role="dialog"]')]
      .filter((el) => el.textContent.includes('Which organization are you working in?'))
      .flatMap((el) => [...el.querySelectorAll('button[role="option"]')])
      .filter((el) => [...el.querySelectorAll('span.truncate')]
        .some((name) => name.textContent.trim() === label));
    else if (kind === 'vault-shared-tab') {
      // Scope the changing count label to the active Vault panel. The caller
      // still uses this driver's visible, hit-tested, trusted pointer path.
      const vaultTriggers = [...document.querySelectorAll('button[role="tab"][title="Vault"][data-state="active"]')];
      const vaultTrigger = vaultTriggers.length === 1 ? vaultTriggers[0] : null;
      const panelId = vaultTrigger?.getAttribute('aria-controls') ?? '';
      const vaultPanel = panelId ? document.getElementById(panelId) : null;
      const activeVaultPanel = vaultPanel?.matches('[role="tabpanel"][data-state="active"]') ? vaultPanel : null;
      candidates = label === 'Shared'
        ? [...(activeVaultPanel?.querySelectorAll('button[role="tab"]') ?? [])].filter((el) => {
            const text = el.textContent.trim();
            return text.startsWith('Shared (') && text.endsWith(')') &&
              /^[0-9]+$/.test(text.slice(8, -1));
          })
        : [];
    }
    else if (kind === 'dialog') candidates = [...document.querySelectorAll('[role="alertdialog"]')]
      .filter((el) => el.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim() === 'Clear local data?')
      .flatMap((el) => [...el.querySelectorAll('button')])
      .filter((el) => el.textContent.trim() === label);
    else if (kind === 'scrape-recapture-dialog') candidates = [...document.querySelectorAll('[role="alertdialog"]')]
      .filter((el) => el.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim() === 'Discard unsaved edits?')
      .flatMap((el) => [...el.querySelectorAll('button')])
      .filter((el) => el.textContent.trim() === label);
    else candidates = [...document.querySelectorAll('button')]
      .filter((el) => el.textContent.trim() === label);
    sampleFailureStage = 'visibility_filter';
    const matchedCount = candidates.length;
    candidates = candidates.filter(visible);
    if (candidates.length !== 1) return { count: candidates.length, matchedCount, sampleFailureStage,
      toolsPanelActive, toolsViewState, toolsCatalogRowCount,
      toolsCatalogSearchEmpty, toolsCatalogFiltersDefault, dataPanelDiagnostic, dataTabTargetDiagnostic };
    const target = candidates[0];
    // Viewport preparation is not the acceptance action. Reposition on every
    // sample because an expanding section can invalidate a one-shot scroll.
    // Never click unless the real target subsequently passes hit-testing.
    sampleFailureStage = 'scroll_preparation';
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    sampleFailureStage = 'clipping_geometry';
    const rect = target.getBoundingClientRect();
    // A viewport-visible center can still lie outside a nested overflow clip.
    // Intersect every clipping ancestor, then use only points that the browser
    // says actually hit this target. Never dismiss an overlay or invoke click().
    const bounds = { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
      right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
    let clippingAncestors = 0;
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      const clips = (overflow) => /^(auto|scroll|hidden|clip)$/.test(overflow);
      if (clips(style.overflowX)) {
        bounds.left = Math.max(bounds.left, box.left + ancestor.clientLeft);
        bounds.right = Math.min(bounds.right, box.left + ancestor.clientLeft + ancestor.clientWidth);
      }
      if (clips(style.overflowY)) {
        clippingAncestors++;
        bounds.top = Math.max(bounds.top, box.top + ancestor.clientTop);
        bounds.bottom = Math.min(bounds.bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
      }
    }
    sampleFailureStage = 'hit_testing';
    const originalCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const centerHit = document.elementFromPoint(originalCenter.x, originalCenter.y);
    const hitsTarget = (hit) => Boolean(hit && (hit === target || target.contains(hit)));
    const points = [];
    if (bounds.right > bounds.left && bounds.bottom > bounds.top) {
      for (const fy of [0.5, 0.25, 0.75]) for (const fx of [0.5, 0.25, 0.75]) {
        points.push({ x: bounds.left + (bounds.right - bounds.left) * fx,
          y: bounds.top + (bounds.bottom - bounds.top) * fy });
      }
    }
    const selected = points.find((point) => hitsTarget(document.elementFromPoint(point.x, point.y)));
    const { x, y } = selected ?? originalCenter;
    const hitTarget = Boolean(selected) && !target.disabled;
    const hitCategory = (hit) => {
      if (!hit) return 'none';
      if (hitsTarget(hit)) return 'target';
      if (hit.closest('[role="alertdialog"], [role="dialog"]')) return 'dialog';
      if (hit.closest('[role="listbox"]')) return 'listbox';
      if (hit.closest('[data-slot="alert-dialog-overlay"], [data-slot="dialog-overlay"]')) return 'modal_overlay';
      if (hit.contains(target)) return 'target_ancestor';
      if (hit.closest('header, [role="tablist"]')) return 'header_or_tabs';
      return 'other_element';
    };
    // Fixed, content-free semantics at the exact pointer boundary. An
    // "other_element" result alone cannot distinguish a notice, scrolling
    // sibling, or outside overlay; no DOM text, attributes, classes, URLs, or
    // field values may cross from this credential-bearing page.
    const occluder = (hit) => {
      if (!hit || hitsTarget(hit)) return null;
      const tag = hit.tagName?.toLowerCase();
      const role = hit.getAttribute?.('role');
      const style = getComputedStyle(hit);
      const box = hit.getBoundingClientRect();
      const vaultPanel = target.closest('[role="tabpanel"]');
      const panelAncestors = [];
      for (let node = hit; node; node = node.parentElement) {
        if (node.getAttribute?.('role') === 'tabpanel') panelAncestors.push(node);
      }
      const panelTitles = [
        ['chat', 'Chat'], ['pilot', 'Pilot (admin only — sandboxed tab group)'],
        ['lists', 'Plan & tasks'], ['tasks', 'Tasks'], ['agenda', 'Agenda'],
        ['scrape', 'Scrape'], ['saved_captures', 'Saved captures'],
        ['data', 'Data'], ['seo', 'SEO'], ['highlight', 'Highlights'],
        ['guidance', 'Guidance'], ['notes', 'Notes'], ['files', 'Files'],
        ['screenshots', 'Screenshots'], ['vault', 'Vault'], ['tools', 'Tools'],
        ['settings', 'Settings'], ['showcase', 'Showcase (admin only)'],
        ['broker', 'Token broker (admin only)'], ['debug', 'Debug (admin only)'],
      ];
      const owner = panelTitles.find(([, title]) => {
        const trigger = [...document.querySelectorAll('button[role="tab"][title]')]
          .find((button) => button.title === title);
        return trigger && panelAncestors.includes(document.getElementById(trigger.getAttribute('aria-controls') ?? ''));
      })?.[0] ?? (panelAncestors.length ? 'unmapped_tabpanel' : 'none');
      const owningPanel = panelAncestors[0] ?? null;
      // Compare only fixed source copy inside the page. No paragraph text is
      // returned to Node, including when it contains account or Vault data.
      const paragraph = hit.closest('p');
      const alert = hit.closest('[role="alert"]');
      const alertTitle = alert?.querySelector('.font-medium')?.textContent?.trim();
      const alertMessage = alert?.querySelector('p')?.textContent ?? '';
      const knownNotice = alertTitle === 'Capture list unavailable' &&
        alertMessage.includes('no workspace is selected, so the request was never sent')
          ? 'capture_no_workspace'
          : alertMessage.includes('no workspace is selected, so the request was never sent')
            ? 'other_no_workspace'
            : alertMessage.includes('the database refused the request because your account is not allowed')
              ? 'database_refused'
              : alertMessage.includes('the data table this feature needs is not available')
                ? 'database_missing_relation'
                : alertMessage.includes('your sign-in has expired')
                  ? 'database_not_authenticated'
                  : alertMessage.includes('the database could not be reached')
                    ? 'database_unreachable'
                    : alert ? 'other_alert' : 'none';
      const knownParagraph = paragraph?.textContent?.trim() ===
        'Everything AI Matrx does for you happens inside one organization, and this browser has not been told which one to use. Pick it once — you can switch any time in Settings.'
          ? 'organization_picker_description'
          : paragraph?.textContent?.trim() === 'No logins saved yet.'
            ? 'vault_mine_empty'
            : paragraph?.textContent?.trim() === 'Nobody has shared a login with you.'
              ? 'vault_shared_empty'
              : paragraph?.textContent?.trim() === 'No logins match that search.'
                ? 'vault_search_empty' : 'other_or_none';
      const knownSlot = (element) => {
        const slot = element.getAttribute?.('data-slot');
        return ['dialog-content', 'dialog-description', 'dialog-overlay',
          'alert-dialog-content', 'alert-dialog-description', 'alert-dialog-overlay',
          'popover-content', 'tooltip-content'].includes(slot) ? slot : 'other_or_none';
      };
      const ancestorChain = [];
      for (let node = hit, depth = 0; node && depth < 10; node = node.parentElement, depth++) {
        const nodeTag = node.tagName?.toLowerCase();
        const nodeRole = node.getAttribute?.('role');
        const nodeState = node.getAttribute?.('data-state');
        const nodeStyle = getComputedStyle(node);
        ancestorChain.push({
          tag: ['button', 'div', 'span', 'svg', 'path', 'input', 'header', 'main',
            'section', 'p', 'li', 'body', 'html'].includes(nodeTag) ? nodeTag : 'other',
          role: ['dialog', 'alertdialog', 'alert', 'tab', 'tablist', 'tabpanel',
            'button', 'listbox', 'option'].includes(nodeRole) ? nodeRole : 'other_or_none',
          slot: knownSlot(node),
          state: ['active', 'inactive', 'open', 'closed'].includes(nodeState)
            ? nodeState : 'other_or_none',
          position: ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(nodeStyle.position)
            ? nodeStyle.position : 'other',
          displayNone: nodeStyle.display === 'none',
          pointerEventsNone: nodeStyle.pointerEvents === 'none',
          isAppRoot: node === document.getElementById('app'),
          isVaultPanel: node === vaultPanel,
        });
      }
      return {
        tag: ['button', 'div', 'span', 'svg', 'path', 'input', 'header', 'main',
          'section', 'p', 'li'].includes(tag) ? tag : 'other',
        role: ['dialog', 'alertdialog', 'alert', 'tab', 'tablist', 'button',
          'listbox', 'option'].includes(role) ? role : 'other_or_none',
        relation: hit.contains(target) ? 'target_ancestor'
          : target.closest('[role="tablist"]') &&
              hit.closest('[role="tablist"]') === target.closest('[role="tablist"]')
            ? 'same_tablist'
            : vaultPanel?.contains(hit) ? 'same_vault_panel' : 'outside_vault_panel',
        position: ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(style.position)
          ? style.position : 'other',
        pointer_events: style.pointerEvents === 'none' ? 'none' : 'enabled',
        owning_panel: owner,
        owning_panel_state: owningPanel?.getAttribute('data-state') === 'active' ? 'active'
          : owningPanel?.getAttribute('data-state') === 'inactive' ? 'inactive' : 'none_or_other',
        tabpanel_ancestor_count: panelAncestors.length,
        known_paragraph: knownParagraph,
        known_notice: knownNotice,
        in_app_root: document.getElementById('app')?.contains(hit) === true,
        in_dialog: Boolean(hit.closest('[role="dialog"], [role="alertdialog"]')),
        in_alert: Boolean(hit.closest('[role="alert"]')),
        in_known_modal_overlay: Boolean(hit.closest('[data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"]')),
        ancestor_chain: ancestorChain,
        rectangle: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    };
    const interiorHits = points.map((point) => document.elementFromPoint(point.x, point.y));
    const interiorHitKinds = interiorHits.map(hitCategory);
    // Fixed categories and geometry only: never element text, attributes,
    // class names, form values, URL, or screenshot contents.
    const pointerDiagnostic = {
      target_rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      clipped_rect: { x: bounds.left, y: bounds.top,
        width: Math.max(0, bounds.right - bounds.left), height: Math.max(0, bounds.bottom - bounds.top) },
      viewport: { width: innerWidth, height: innerHeight },
      clipping_ancestor_count: clippingAncestors,
      tested_point_count: points.length,
      center_hit_category: hitCategory(centerHit),
      interior_hit_kinds: interiorHitKinds,
      center_occluder: occluder(centerHit),
      first_interior_occluder: occluder(interiorHits.find((hit) => hit && !hitsTarget(hit))),
      selected_point_available: Boolean(selected),
      selected_point: selected ?? null,
      target_disabled: Boolean(target.disabled),
      target_pointer_events_none: getComputedStyle(target).pointerEvents === 'none',
    };
    sampleFailureStage = 'animation_observation';
    let animating = false;
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.getAnimations({ subtree: false }).some((animation) => animation.playState === 'running')) {
        animating = true;
        break;
      }
    }
    return { count: 1, matchedCount, toolsPanelActive, x, y, hitTarget, animating,
      viewport: { width: innerWidth, height: innerHeight },
      pointerDiagnostic, dataTabTargetDiagnostic };
    } catch {
      return { sampleFailed: true, sampleFailureStage };
    }
  })()`,
    );
  let location;
  try {
    location = await pointerSample();
  } catch {
    throw pointerFailure('pointer_initial_evaluation_failed', location);
  }
  if (location?.sampleFailed) throw pointerFailure('pointer_page_sample_failed', location);
  if (location?.count !== 1) throw pointerFailure('pointer_target_not_unique', location);
  // Poll outside the page: a paused requestAnimationFrame must not strand
  // Runtime.evaluate(awaitPromise) or hide the last pointer diagnostic.
  const deadline = Date.now() + 3000;
  let previous;
  let stableSamples = 0;
  do {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    try {
      location = await pointerSample();
    } catch {
      throw pointerFailure('pointer_followup_evaluation_failed', location);
    }
    if (location?.sampleFailed) throw pointerFailure('pointer_page_sample_failed', location);
    const positionStable =
      location?.count === 1 &&
      previous !== undefined &&
      Math.abs(previous.x - location.x) < 0.25 &&
      Math.abs(previous.y - location.y) < 0.25;
    stableSamples =
      location?.count === 1 && location.hitTarget && !location.animating && positionStable
        ? stableSamples + 1
        : 0;
    location = { ...location, stableSamples, positionStable };
    if (stableSamples >= 2) break;
    previous = location?.count === 1 ? { x: location.x, y: location.y } : undefined;
  } while (Date.now() < deadline);
  if (stableSamples < 2) {
    const error = pointerFailure('pointer_stable_hit_not_observed', location);
    error.pointerDiagnostic = location?.pointerDiagnostic ?? { sample_unavailable: true };
    throw error;
  }
  onPhase?.('target_selected');
  try {
    onPhase?.('press_attempted');
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: location.x,
      y: location.y,
      button: 'left',
      clickCount: 1,
    });
    onPhase?.('press_returned');
  } catch {
    throw pointerFailure('pointer_press_dispatch_failed', location);
  }
  try {
    onPhase?.('release_attempted');
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: location.x,
      y: location.y,
      button: 'left',
      clickCount: 1,
    });
    onPhase?.('release_returned');
  } catch {
    throw pointerFailure('pointer_release_dispatch_failed', location);
  }
  if (kind === 'port') {
    const focused = await evaluate(
      panel,
      `(() => {
      const input = document.querySelector('input[placeholder="auto"]');
      return input !== null && document.activeElement === input;
    })()`,
    );
    assert.equal(
      focused,
      true,
      `real mouse click focused port input: ${JSON.stringify({ location, focused })}`,
    );
  }
  return location.pointerDiagnostic;
}
