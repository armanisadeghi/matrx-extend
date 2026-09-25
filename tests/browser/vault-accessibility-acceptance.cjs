'use strict';

/*
 * Real-CDP accessibility acceptance for the already-open Vault side panel.
 * The runner supplies the authenticated panel, an existing enabled fixture
 * page, and its submit counter. This helper creates no product state and uses
 * only CDP input for keyboard interaction.
 */

const GENERATOR = '[aria-label="Password generator"]';

function axRole(node) {
  return typeof node?.role?.value === 'string' ? node.role.value : '';
}

function axName(node) {
  return typeof node?.name?.value === 'string' ? node.name.value : '';
}

function hasAXName(nodes, role, name) {
  return nodes.some(
    (node) => node?.ignored !== true && axRole(node) === role && axName(node) === name,
  );
}

function axFocused(node) {
  return (
    node?.ignored !== true &&
    Array.isArray(node?.properties) &&
    node.properties.some(
      (property) => property?.name === 'focused' && property?.value?.value === true,
    )
  );
}

async function dispatchNativeKey(cdp, { key, code, windowsVirtualKeyCode, text }) {
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  if (text !== undefined) {
    params.text = text;
    params.unmodifiedText = text;
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

async function axTree(realPanel) {
  const result = await realPanel.send('Accessibility.getFullAXTree');
  if (!Array.isArray(result?.nodes)) throw new Error('vault_accessibility_ax_tree_missing');
  return result.nodes;
}

async function waitForFixtureAX(fixtureCdp, wait, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await fixtureCdp.send('Accessibility.getFullAXTree');
    const nodes = result?.nodes;
    if (Array.isArray(nodes) && predicate(nodes)) return nodes;
    await wait(100);
  }
  throw new Error('vault_accessibility_fixture_ax_condition_timeout');
}

function chooserButtons(nodes) {
  const dialogs = nodes.filter(
    (node) =>
      node?.ignored !== true &&
      axRole(node) === 'dialog' &&
      axName(node) === 'Saved logins from Matrx Vault',
  );
  if (dialogs.length !== 1) return [];
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const pending = [...(dialogs[0].childIds || [])];
  const visited = new Set();
  const buttons = [];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (node.ignored !== true && axRole(node) === 'button') buttons.push(node);
    pending.push(...(node.childIds || []));
  }
  return buttons;
}

async function ensureGeneratorOpen(realPanel) {
  const opener = `Array.from(document.querySelector(${JSON.stringify(GENERATOR)})?.querySelectorAll('button') ?? [])
    .find((button) => button.textContent?.trim() === 'Password generator')`;
  const open = await realPanel.evaluate(`(${opener})?.getAttribute('aria-expanded') === 'true'`);
  if (!open) {
    await realPanel.click(opener);
    await realPanel.waitFor(`(${opener})?.getAttribute('aria-expanded') === 'true'`, true, 10000);
  }
}

async function runInlineChooserEscape({
  context,
  fixturePage,
  targetName,
  getSubmitCount,
  assert,
  wait,
  focusCredential,
  focusUnrelated,
  checkpoint,
}) {
  assert(
    fixturePage && typeof fixturePage.locator === 'function',
    'vault_accessibility_fixture_page_missing',
  );
  assert(typeof getSubmitCount === 'function', 'vault_accessibility_submit_counter_missing');
  assert(
    typeof focusCredential === 'function' && typeof focusUnrelated === 'function',
    'vault_accessibility_focus_credential_missing',
  );
  const baselineSubmits = getSubmitCount();
  assert(
    Number.isInteger(baselineSubmits) && baselineSubmits >= 0,
    'vault_accessibility_submit_counter_invalid',
  );
  const fixtureCdp = await context.newCDPSession(fixturePage);
  try {
    await focusUnrelated();
    await focusCredential();
    checkpoint('vault_accessibility_inline_focus');
    await fixturePage.waitForFunction(
      () => document.hasFocus() && document.activeElement?.id === 'password',
    );
    checkpoint('vault_accessibility_inline_offer');
    await fixturePage
      .locator('#matrx-inline-login-suggestion')
      .waitFor({ state: 'attached', timeout: 15000 });
    checkpoint('vault_accessibility_inline_ax');
    await dispatchNativeKey(fixtureCdp, {
      key: 'ArrowDown',
      code: 'ArrowDown',
      windowsVirtualKeyCode: 40,
    });
    let chooserNodes = await waitForFixtureAX(fixtureCdp, wait, (nodes) => {
      const buttons = chooserButtons(nodes);
      return (
        buttons.filter((node) => axName(node) === targetName).length === 1 &&
        buttons.filter(axFocused).length === 1
      );
    });
    // Arrow Down opens the list at its first account, not necessarily the
    // requested fixture. Navigate real keyboard choices to the exact target.
    const choiceBound = chooserButtons(chooserNodes).length;
    for (
      let step = 0;
      step < choiceBound &&
      !chooserButtons(chooserNodes).some((node) => axName(node) === targetName && axFocused(node));
      step += 1
    ) {
      const previousFocus = chooserButtons(chooserNodes).find(axFocused)?.nodeId;
      await dispatchNativeKey(fixtureCdp, {
        key: 'ArrowDown',
        code: 'ArrowDown',
        windowsVirtualKeyCode: 40,
      });
      chooserNodes = await waitForFixtureAX(
        fixtureCdp,
        wait,
        (nodes) =>
          chooserButtons(nodes).filter(axFocused).length === 1 &&
          chooserButtons(nodes).some((node) => axFocused(node) && node.nodeId !== previousFocus),
      );
    }
    assert(
      chooserButtons(chooserNodes).filter((node) => axName(node) === targetName).length === 1 &&
        chooserButtons(chooserNodes).filter(axFocused).length === 1 &&
        chooserButtons(chooserNodes).some((node) => axName(node) === targetName && axFocused(node)),
      'vault_accessibility_chooser_target_ax_name_or_focus_missing',
    );
    await dispatchNativeKey(fixtureCdp, {
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    checkpoint('vault_accessibility_inline_escape_return');
    await fixturePage.waitForFunction(
      () =>
        !document.querySelector('#matrx-inline-login-suggestion') &&
        document.hasFocus() &&
        document.activeElement?.id === 'password',
    );
    assert(getSubmitCount() === baselineSubmits, 'vault_accessibility_escape_submitted_fixture');
    return { exactTargetActionableAX: true, escapeReturnedFocusWithoutSubmit: true };
  } finally {
    await fixtureCdp.detach().catch(() => {});
  }
}

exports.runVaultAccessibilityChecks = async ({
  realPanel,
  context,
  worker,
  fixturePage,
  targetName,
  assert,
  wait,
  checkpoint = () => {},
  proof,
  verifyRealVaultPanel,
  getSubmitCount,
  focusCredential,
  focusUnrelated,
}) => {
  assert(
    realPanel &&
      typeof realPanel.send === 'function' &&
      typeof realPanel.evaluate === 'function' &&
      typeof realPanel.waitFor === 'function' &&
      typeof realPanel.click === 'function',
    'vault_accessibility_panel_contract_missing',
  );
  assert(
    context && typeof context.newCDPSession === 'function',
    'vault_accessibility_context_missing',
  );
  assert(
    typeof targetName === 'string' && targetName.length > 0,
    'vault_accessibility_target_name_missing',
  );
  assert(
    typeof assert === 'function' &&
      typeof wait === 'function' &&
      typeof verifyRealVaultPanel === 'function',
    'vault_accessibility_controls_missing',
  );
  assert(proof && typeof proof === 'object', 'vault_accessibility_proof_missing');

  const evidence = (proof.accessibility = {
    vaultTabAXName: false,
    vaultTabpanelAXName: false,
    generatorAXRegionAndButtons: false,
    compactViewportNoHorizontalOverflow: false,
    compactViewportActionsVisible: false,
    inlineChooserDialogAndTargetAX: false,
    inlineChooserEscapeReturnsFocusWithoutSubmit: false,
    viewportRestored: false,
    actualBrowserZoom200: false,
    zoomedChooserKeyboardAndEscape: false,
    browserZoomRestored: false,
  });
  let primaryFailure = null;
  let emulationSet = false;
  let viewportBefore = null;
  let zoomBefore = null;
  try {
    checkpoint('vault_accessibility_panel_ready');
    await verifyRealVaultPanel();
    await ensureGeneratorOpen(realPanel);
    const semanticTree = await axTree(realPanel);
    assert(hasAXName(semanticTree, 'tab', 'Vault'), 'vault_accessibility_vault_tab_name_missing');
    evidence.vaultTabAXName = true;
    assert(
      hasAXName(semanticTree, 'tabpanel', 'Vault'),
      'vault_accessibility_vault_tabpanel_name_missing',
    );
    evidence.vaultTabpanelAXName = true;
    const generatorNames = ['Password generator', 'Password', 'Passphrase', 'Generate'];
    assert(
      hasAXName(semanticTree, 'region', 'Password generator') &&
        generatorNames.every((name) => hasAXName(semanticTree, 'button', name)),
      'vault_accessibility_generator_ax_name_missing',
    );
    evidence.generatorAXRegionAndButtons = true;

    checkpoint('vault_accessibility_compact_viewport');
    viewportBefore = await realPanel.evaluate(
      '({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })',
    );
    assert(
      Number.isInteger(viewportBefore?.width) &&
        Number.isInteger(viewportBefore?.height) &&
        typeof viewportBefore?.dpr === 'number',
      'vault_accessibility_original_viewport_missing',
    );
    await realPanel.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    emulationSet = true;
    await realPanel.waitFor('innerWidth === 320', true, 10000);
    const compact = await realPanel.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(GENERATOR)});
      const exact = (label) => Array.from(root?.querySelectorAll('button') ?? [])
        .filter((button) => button.textContent?.trim() === label);
      const round = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
      const actionGeometry = Object.fromEntries([
        ['password', 'Password'],
        ['passphrase', 'Passphrase'],
        ['generate', 'Generate'],
      ].map(([key, label]) => {
        const matches = exact(label);
        const exists = matches.length > 0;
        const unique = matches.length === 1;
        if (!unique) return [key, {
          exists,
          unique,
          positiveRect: false,
          viewport: { left: false, right: false, top: false, bottom: false, contained: false },
          computed: { visibilityNotHidden: false, displayNotNone: false },
          rect: null,
          scroll: null,
        }];
        const button = matches[0];
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        let scrollContainer = button.parentElement;
        while (
          scrollContainer &&
          scrollContainer.scrollHeight <= scrollContainer.clientHeight &&
          scrollContainer.scrollWidth <= scrollContainer.clientWidth
        ) scrollContainer = scrollContainer.parentElement;
        const scrollable = scrollContainer ?? document.scrollingElement;
        const viewport = {
          left: rect.left >= 0,
          right: rect.right <= innerWidth,
          top: rect.top >= 0,
          bottom: rect.bottom <= innerHeight,
        };
        return [key, {
          exists,
          unique,
          positiveRect: rect.width > 0 && rect.height > 0,
          viewport: { ...viewport, contained: Object.values(viewport).every(Boolean) },
          computed: {
            visibilityNotHidden: style.visibility !== 'hidden',
            displayNotNone: style.display !== 'none',
          },
          rect: {
            left: round(rect.left), right: round(rect.right), top: round(rect.top),
            bottom: round(rect.bottom), width: round(rect.width), height: round(rect.height),
          },
          scroll: {
            windowX: round(scrollX), windowY: round(scrollY),
            documentTop: round(document.scrollingElement?.scrollTop),
            containerTop: round(scrollable?.scrollTop),
            containerClientHeight: round(scrollable?.clientHeight),
            containerScrollHeight: round(scrollable?.scrollHeight),
          },
        }];
      }));
      const visible = Object.values(actionGeometry).every((action) =>
        action.unique && action.positiveRect && action.viewport.contained &&
          action.computed.visibilityNotHidden && action.computed.displayNotNone,
      );
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth,
        actionsVisible: visible,
        actionGeometry,
      };
    })()`);
    assert(
      compact?.noHorizontalOverflow === true,
      'vault_accessibility_compact_horizontal_overflow',
    );
    evidence.compactViewportNoHorizontalOverflow = true;
    if (compact?.actionsVisible !== true)
      proof.accessibilityCompactActionGeometry = compact?.actionGeometry ?? null;
    assert(compact?.actionsVisible === true, 'vault_accessibility_compact_actions_clipped');
    evidence.compactViewportActionsVisible = true;

    checkpoint('vault_accessibility_inline_chooser_escape');
    const chooser = await runInlineChooserEscape({
      context,
      fixturePage,
      targetName,
      getSubmitCount,
      assert,
      wait,
      focusCredential,
      focusUnrelated,
      checkpoint,
    });
    evidence.inlineChooserDialogAndTargetAX = chooser.exactTargetActionableAX;
    evidence.inlineChooserEscapeReturnsFocusWithoutSubmit =
      chooser.escapeReturnedFocusWithoutSubmit;

    checkpoint('vault_accessibility_actual_browser_zoom');
    assert(
      worker && typeof worker.evaluate === 'function',
      'vault_accessibility_zoom_worker_missing',
    );
    zoomBefore = await worker.evaluate(async (url) => {
      const tabs = (await chrome.tabs.query({})).filter((tab) => tab.url === url);
      if (tabs.length !== 1 || !Number.isInteger(tabs[0].id))
        throw new Error('zoom_fixture_not_unique');
      const id = tabs[0].id;
      return {
        id,
        url,
        factor: await chrome.tabs.getZoom(id),
        settings: await chrome.tabs.getZoomSettings(id),
      };
    }, fixturePage.url());
    await worker.evaluate(async ({ id, url }) => {
      if ((await chrome.tabs.get(id)).url !== url) throw new Error('zoom_fixture_changed');
      await chrome.tabs.setZoomSettings(id, { mode: 'automatic', scope: 'per-tab' });
      await chrome.tabs.setZoom(id, 2);
    }, zoomBefore);
    const actualZoom = await worker.evaluate((id) => chrome.tabs.getZoom(id), zoomBefore.id);
    assert(actualZoom === 2, 'vault_accessibility_actual_zoom_not_200');
    evidence.actualBrowserZoom200 = true;
    const zoomedChooser = await runInlineChooserEscape({
      context,
      fixturePage,
      targetName,
      getSubmitCount,
      assert,
      wait,
      focusCredential,
      focusUnrelated,
      checkpoint,
    });
    evidence.zoomedChooserKeyboardAndEscape =
      zoomedChooser.exactTargetActionableAX && zoomedChooser.escapeReturnedFocusWithoutSubmit;
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (zoomBefore) {
      try {
        const restored = await worker.evaluate(async ({ id, url, factor, settings }) => {
          if ((await chrome.tabs.get(id)).url !== url)
            throw new Error('zoom_restore_fixture_changed');
          await chrome.tabs.setZoom(id, factor);
          await chrome.tabs.setZoomSettings(id, { mode: settings.mode, scope: settings.scope });
          const after = await chrome.tabs.getZoomSettings(id);
          return (
            (await chrome.tabs.getZoom(id)) === factor &&
            after.mode === settings.mode &&
            after.scope === settings.scope
          );
        }, zoomBefore);
        assert(restored === true, 'vault_accessibility_browser_zoom_not_restored');
        evidence.browserZoomRestored = true;
      } catch (error) {
        if (!primaryFailure) primaryFailure = error;
      }
    }
    if (emulationSet) {
      try {
        await realPanel.send('Emulation.clearDeviceMetricsOverride');
        const restored = `innerWidth === ${JSON.stringify(viewportBefore.width)} && innerHeight === ${JSON.stringify(viewportBefore.height)} && devicePixelRatio === ${JSON.stringify(viewportBefore.dpr)}`;
        await realPanel.waitFor(restored, true, 10000);
        evidence.viewportRestored = true;
      } catch (error) {
        if (!primaryFailure) primaryFailure = error;
      }
    } else {
      evidence.viewportRestored = true;
    }
  }
  if (primaryFailure) throw primaryFailure;
  assert(
    Object.values(evidence).every((value) => value === true),
    'vault_accessibility_evidence_incomplete',
  );
  return evidence;
};
