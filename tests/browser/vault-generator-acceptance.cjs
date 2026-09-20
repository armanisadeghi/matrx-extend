/* Browser transport proof against the real installed development artifact.
 * Synthetic values never leave the owned fixture and transient test process.
 * This is NOT positive generator-UI proof when canonical settings are absent. */
const http = require('node:http');
const crypto = require('node:crypto');

async function fixture(childUrl = null) {
  const state = { submits: 0 };
  const server = http.createServer((request, response) => {
    if (request.method === 'POST') {
      state.submits++;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><body><h1>Disposable password form</h1>
      <form method="post" action="/submit"><label>Current password<input id="current" type="password" autocomplete="current-password" value="owned-current-fixture"></label>
      <label>New password<input id="new" type="password" autocomplete="new-password" minlength="12"></label>
      <label>Confirm password<input id="confirm" type="password" autocomplete="new-password" aria-label="Confirm password"></label>
      <button type="submit">Save password</button></form>
      <textarea id="clipboard-fixture" aria-label="Disposable clipboard fixture"></textarea>
      ${childUrl && request.url !== '/embedded' ? `<iframe title="Embedded password form" src="${childUrl}" style="width:100%;height:220px"></iframe><iframe title="Same-site password form" src="/embedded" style="width:100%;height:220px"></iframe>` : ''}
      </body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { state, url: `http://127.0.0.1:${server.address().port}/password`, close: () => new Promise((resolve) => server.close(resolve)) };
}

exports.runGeneratorChecks = async ({ context, worker, panel, assert, wait, checkpoint, proof, focusOwnedBrowser, screenshotPath, verifyRealVaultPanel, displayMode, panelCloseLifecycleMode = false, workerRestartLifecycleMode = false, windowSwitchLifecycleMode = false, reopenPanelFromAction, refreshWorker }) => {
  assert(displayMode === 'HEADLESS_NO_CLIPBOARD' || displayMode === 'HEADED', 'generator_display_mode_required');
  const child = await fixture();
  let top;
  let page;
  let synthetic = `generated-${crypto.randomUUID()}`;
  let copiedSyntheticValue = null;
  const headlessNoClipboardMode = displayMode === 'HEADLESS_NO_CLIPBOARD';
  const evidence = proof.generator = {
    scope: 'real side-panel host transport and password/passphrase controls',
    displayMode,
    hostTransportOk: false,
    positiveGeneratorUi: false,
    checks: {},
  };
  const clipboardCustody = evidence.clipboard = {
    copyAttempted: false,
    disposition: headlessNoClipboardMode ? 'not_run_requires_isolated_clipboard' : 'unknown',
  };
  try {
    top = await fixture(child.url);
    page = await context.newPage();
    await page.goto(top.url);
    await page.bringToFront();
    const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, top.url);
    assert(Number.isInteger(tabId), 'generator_fixture_tab_missing');
    for (let focusAttempt = 0; focusAttempt < 5; focusAttempt++) {
    await focusOwnedBrowser(tabId);
    evidence.focusDiagnostic = await worker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id);
      await chrome.windows.update(tab.windowId, { focused: true });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      return { focused: focused.focused, type: focused.type, selectedWindowMatches: focused.id === tab.windowId, tabActive: tab.active };
    }, tabId);
    if (evidence.focusDiagnostic.focused && evidence.focusDiagnostic.selectedWindowMatches && evidence.focusDiagnostic.tabActive) break;
    await wait(250);
    }
    assert(evidence.focusDiagnostic.focused && evidence.focusDiagnostic.selectedWindowMatches && evidence.focusDiagnostic.tabActive, 'generator_owned_window_not_focused');

    evidence.runtimeVersion = context.browser()?.version() ?? null;
    // Observe the actual manifest-installed isolated registry in both frames.
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      ready = await worker.evaluate(async (id) => {
        const results = await chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, func: () => !!window.__matrx_generation_target_registry__ });
        return results.length === 3 && results.every((entry) => entry.result === true);
      }, tabId);
      if (ready) break;
      await wait(100);
    }
    assert(ready, 'generator_frame_registry_not_mounted');
    let connectionId = null;
    const openGeneratorConnection = async () => {
      const next = await panel.evaluate(`new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: 'matrx-generation-panel-v1' });
        const timer = setTimeout(() => resolve(null), 1500);
        const listener = (message) => {
          if (message?.__matrxCredentialGeneration !== true || message.operation !== 'connected' || typeof message.connectionId !== 'string') return;
          clearTimeout(timer);
          port.onMessage.removeListener(listener);
          globalThis.__vaultCanaryGeneratorPort = port;
          resolve(message.connectionId);
        };
        port.onMessage.addListener(listener);
      })`);
      assert(typeof next === 'string' && /^[a-f0-9]{36}$/.test(next), 'generator_panel_port_handshake_missing');
      return next;
    };
    connectionId = await openGeneratorConnection();
    const request = (payload) => {
      assert(typeof connectionId === 'string', 'generator_panel_port_not_connected');
      return panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ __matrxCredentialGeneration: true, connectionId, ...payload })})`);
    };
    const discover = () => request({ operation: 'discover', tabId });
    const use = (offerId) => request({ operation: 'use', offerId, value: synthetic });
    const discard = (offerIds) => request({ operation: 'discard', offerIds });
    const unchanged = async (frame) => frame.evaluate(() => document.querySelector('#new').value === '' && document.querySelector('#confirm').value === '' && document.querySelector('#current').value === 'owned-current-fixture');
    const matches = async (frame) => frame.evaluate((value) => document.querySelector('#new').value === value && document.querySelector('#confirm').value === value && document.querySelector('#current').value === 'owned-current-fixture', synthetic);
    const embedded = () => page.frames().find((frame) => frame.url() === child.url);

    // A value-free diagnostic listener observes Chrome's actual sender shape;
    // it cannot admit a product request or inspect a generated value.
    const probeId = crypto.randomUUID();
    await worker.evaluate((id) => {
      const listener = (message, sender, reply) => {
        if (message?.vaultCanarySenderProbe !== id) return false;
        void chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }).then((contexts) => reply({
          senderHasDocumentId: typeof sender.documentId === 'string',
          senderHasTab: !!sender.tab,
          senderUrlMatches: sender.url === chrome.runtime.getURL('sidepanel.html'),
          contexts: contexts.map((entry) => ({
            windowId: entry.windowId, tabId: entry.tabId,
            documentMatchesSender: entry.documentId === sender.documentId,
            documentUrlMatches: entry.documentUrl === chrome.runtime.getURL('sidepanel.html'),
          })),
        }));
        return true;
      };
      globalThis.__vaultCanarySenderProbe = listener;
      chrome.runtime.onMessage.addListener(listener);
    }, probeId);
    try { evidence.senderDiagnostic = await panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ vaultCanarySenderProbe: probeId })})`); }
    finally {
      await worker.evaluate(() => {
        chrome.runtime.onMessage.removeListener(globalThis.__vaultCanarySenderProbe);
        delete globalThis.__vaultCanarySenderProbe;
      });
    }
    checkpoint('generator_host_discovery');
    const first = await discover();
    evidence.discoveryStatus = first?.status ?? 'missing_response';
    assert(first?.status === 'ready' && first.offers.length === 3, 'generator_exact_frames_not_offered');
    const topOffer = first.offers.find((offer) => offer.frameId === 0 && offer.origin === new URL(top.url).origin);
    const childOffer = first.offers.find((offer) => offer.frameId !== 0 && offer.origin === new URL(child.url).origin);
    assert(topOffer && childOffer && embedded(), 'generator_frame_origin_binding_missing');
    assert(first.offers.every((offer) => offer.fieldCount === 2), 'generator_current_password_offered');
    evidence.checks.threeFramesWithExactOrigins = true;
    checkpoint('generator_top_fill');
    assert((await use(topOffer.id))?.status === 'filled', 'generator_top_fill_refused');
    assert(await matches(page), 'generator_top_values_mismatch');
    assert(await unchanged(embedded()), 'generator_unselected_frame_changed');
    assert((await use(topOffer.id))?.status === 'stale', 'generator_offer_replayed');
    evidence.checks.exactTopFillAndReplayRefusal = true;
    const discardedDiscovery = await discover();
    const discardedOffer = discardedDiscovery?.offers?.find((offer) => offer.frameId === 0);
    assert(discardedOffer, 'generator_discard_offer_missing');
    assert((await discard([discardedOffer.id]))?.status === 'discarded', 'generator_discard_refused');
    assert((await use(discardedOffer.id))?.status === 'stale', 'generator_discarded_offer_survived');
    evidence.checks.rawPortDiscardRefusedReplay = true;
    checkpoint('generator_child_fill');
    // A fresh discovery avoids assuming one request preserves sibling offers.
    const second = await discover();
    const selectedChild = second?.offers?.find((offer) => offer.frameId !== 0 && offer.origin === new URL(child.url).origin);
    assert(selectedChild, 'generator_child_offer_missing');
    assert((await use(selectedChild.id))?.status === 'filled', 'generator_child_fill_refused');
    assert(await matches(embedded()), 'generator_child_values_mismatch');
    assert(await matches(page), 'generator_child_fill_changed_top');
    evidence.checks.permittedCrossOriginFrameFill = true;
    const sameOriginDiscovery = await discover();
    const sameOriginOffer = sameOriginDiscovery?.offers?.find((offer) => offer.frameId !== 0 && offer.origin === new URL(top.url).origin);
    const sameOriginFrame = page.frames().find((frame) => frame.url() === new URL('/embedded', top.url).href);
    assert(sameOriginOffer && sameOriginFrame, 'generator_same_origin_frame_missing');
    assert((await use(sameOriginOffer.id))?.status === 'filled', 'generator_same_origin_fill_refused');
    assert(await matches(sameOriginFrame), 'generator_same_origin_values_mismatch');
    evidence.checks.sameOriginFrameFill = true;

    checkpoint('generator_replaced_field');
    const third = await discover();
    const replacedOffer = third?.offers?.find((offer) => offer.frameId === 0);
    assert(replacedOffer, 'generator_replacement_offer_missing');
    await page.evaluate(() => {
      const old = document.querySelector('#new');
      const replacement = old.cloneNode();
      replacement.value = '';
      old.replaceWith(replacement);
      document.querySelector('#confirm').value = '';
    });
    assert((await use(replacedOffer.id))?.status === 'refused_unchanged', 'generator_replacement_not_refused');
    assert(await unchanged(page), 'generator_replacement_wrote_value');
    evidence.checks.replacedFieldRefusedUnchanged = true;
    checkpoint('generator_tab_switch_refusal');
    const switchDiscovery = await discover();
    const switchOffer = switchDiscovery?.offers?.find((offer) => offer.frameId === 0);
    assert(switchOffer, 'generator_switch_offer_missing');
    const otherTab = await context.newPage();
    try { await otherTab.bringToFront(); await page.bringToFront(); }
    finally { await otherTab.close(); }
    assert((await use(switchOffer.id))?.status === 'stale', 'generator_tab_switch_offer_survived');
    assert(await unchanged(page), 'generator_tab_switch_wrote_value');
    evidence.checks.awayAndBackRefusedUnchanged = true;
    checkpoint('generator_expiry_refusal');
    const expiryDiscovery = await discover();
    const expiryOffer = expiryDiscovery?.offers?.find((offer) => offer.frameId === 0);
    assert(expiryOffer, 'generator_expiry_offer_missing');
    await wait(Math.max(0, expiryOffer.expiresAt - Date.now()) + 100);
    assert((await use(expiryOffer.id))?.status === 'stale', 'generator_expired_offer_survived');
    assert(await unchanged(page), 'generator_expiry_wrote_value');
    evidence.checks.expiryRefusedUnchanged = true;

    checkpoint('generator_navigation_refusal');
    await focusOwnedBrowser(tabId);
    await page.bringToFront();
    const fourth = await discover();
    evidence.navigationDiscovery = { status: fourth?.status, offerCount: fourth?.offers?.length ?? 0, focus: await worker.evaluate(async (id) => { const tab = await chrome.tabs.get(id); const win = await chrome.windows.get(tab.windowId); return { focused: win.focused, active: tab.active }; }, tabId) };
    checkpoint('generator_navigation_discovery');
    const oldDocumentOffer = fourth?.offers?.find((offer) => offer.frameId === 0);
    assert(oldDocumentOffer, 'generator_navigation_offer_missing');
    await page.reload();
    assert((await use(oldDocumentOffer.id))?.status === 'stale', 'generator_navigation_offer_survived');
    assert(await unchanged(page), 'generator_navigation_wrote_value');
    evidence.checks.navigationRefusedUnchanged = true;
    checkpoint('generator_unsafe_form_refusal');
    await page.evaluate(() => { document.querySelector('form').method = 'get'; });
    const unsafeDiscovery = await discover();
    assert(!unsafeDiscovery?.offers?.some((offer) => offer.frameId === 0), 'generator_get_form_offered');
    assert(await unchanged(page), 'generator_get_form_wrote_value');
    await page.evaluate(() => { document.querySelector('form').method = 'post'; });
    const actionDiscovery = await discover();
    const actionOffer = actionDiscovery?.offers?.find((offer) => offer.frameId === 0);
    assert(actionOffer, 'generator_safe_post_not_offered');
    await page.evaluate((origin) => { document.querySelector('form').action = origin + '/receive'; }, new URL(child.url).origin);
    assert((await use(actionOffer.id))?.status === 'refused_unchanged', 'generator_changed_action_not_refused');
    assert(await unchanged(page), 'generator_changed_action_wrote_value');
    await page.evaluate(() => { document.querySelector('form').action = '/submit'; });
    const rollbackDiscovery = await discover();
    const rollbackOffer = rollbackDiscovery?.offers?.find((offer) => offer.frameId === 0);
    assert(rollbackOffer, 'generator_rollback_offer_missing');
    await page.evaluate(() => document.querySelector('#new').addEventListener('input', () => { document.querySelector('form').method = 'get'; }, { once: true }));
    assert((await use(rollbackOffer.id))?.status === 'rolled_back', 'generator_action_reaction_not_rolled_back');
    assert(await unchanged(page), 'generator_action_reaction_left_value');
    await page.evaluate(() => { document.querySelector('form').method = 'post'; });
    evidence.checks.unsafeFormAndChangedActionRefused = true;
    evidence.checks.inputActionChangeRolledBack = true;

    assert(top.state.submits === 0 && child.state.submits === 0, 'generator_submitted_website');
    evidence.checks.noWebsiteSubmission = true;
    evidence.hostTransportOk = true;
    // Lifecycle cases require one unambiguous top-frame group. The preceding
    // transport matrix owns the three-frame coverage; remove only its owned
    // fixture frames before creating any UI candidate or lifecycle offer.
    await page.evaluate(() => document.querySelectorAll('iframe').forEach((frame) => frame.remove()));
    const lifecycleSection = `document.querySelector('[aria-label="Password generator"]')`;
    const lifecycleButton = (label) => `Array.from((${lifecycleSection}).querySelectorAll("button")).find((button) => button.textContent.trim() === ${JSON.stringify(label)})`;
    const uiCandidateState = () => panel.evaluate(`(() => {
      const root = ${lifecycleSection};
      const generate = ${lifecycleButton('Generate')};
      return {
        regionPresent: !!root,
        generatedCandidatePresent: !!root?.querySelector('[aria-label="Reveal generated value"]'),
        offerPresent: !!root?.querySelector('[name="generated-password-target"]'),
        generateReady: !!generate && !generate.disabled,
        connectionChanged: root?.innerText.includes('generator connection changed') === true,
      };
    })()`);
    const panelIdentity = async () => {
      const context = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
      assert(typeof panel.targetId === 'string' && panel.targetId.length > 0
        && context.length === 1 && typeof context[0].documentId === 'string'
        && context[0].documentId.length > 0, 'lifecycle_panel_identity_unavailable');
      return { targetId: panel.targetId, documentId: context[0].documentId };
    };
    const generateUiOffer = async () => {
      await verifyRealVaultPanel();
      await panel.waitFor(`!!${lifecycleSection}`);
      if (await panel.evaluate(`(${lifecycleButton('Password generator')})?.getAttribute('aria-expanded') !== 'true'`))
        await panel.click(lifecycleButton('Password generator'));
      await panel.click(lifecycleButton('Password'));
      // Start before the action: observation latency must never extend the TTL.
      const startedAt = Date.now();
      await panel.click(lifecycleButton('Generate'));
      await panel.waitFor(`!!(${lifecycleSection})?.querySelector('[aria-label="Reveal generated value"]') && (${lifecycleSection})?.innerText.includes('Generated.')`);
      const state = await uiCandidateState();
      assert(state.regionPresent && state.generatedCandidatePresent && state.offerPresent, 'lifecycle_ui_candidate_missing');
      const completedAt = Date.now();
      return { state, completedAt, expiresAt: startedAt + 30_000, identity: await panelIdentity() };
    };
    const freshUiGenerateUse = async (code) => {
      await panel.click(lifecycleButton('Generate'));
      await panel.waitFor(`!!(${lifecycleSection})?.querySelector('[aria-label="Reveal generated value"]') && (${lifecycleSection})?.innerText.includes('Generated.')`);
      await panel.click(`(${lifecycleSection}).querySelector('[aria-label="Reveal generated value"]')`);
      const uiValue = await panel.evaluate(`(${lifecycleSection}).querySelector('code')?.textContent`);
      assert(typeof uiValue === 'string' && uiValue.length > 0 && uiValue !== '••••••••••••••••••••••••', 'lifecycle_ui_reveal_missing');
      await panel.click(`(${lifecycleSection}).querySelector('[aria-label="Hide generated value"]')`);
      await panel.click(lifecycleButton('Use'));
      await panel.waitFor(`!(${lifecycleSection})?.querySelector('code') && /Filled/.test((${lifecycleSection})?.innerText ?? '')`);
      const uiFilled = await page.evaluate((value) => document.querySelector('#new').value === value && document.querySelector('#confirm').value === value && document.querySelector('#current').value === 'owned-current-fixture', uiValue);
      assert(uiFilled && top.state.submits === 0 && child.state.submits === 0, code);
      await page.evaluate(() => { document.querySelector('#new').value = ''; document.querySelector('#confirm').value = ''; });
    };
    if (workerRestartLifecycleMode) {
      const lifecycle = evidence.workerRestartLifecycle = { disposition: 'in_progress' };
      checkpoint('generator_worker_restart_offer');
      const uiCandidate = await generateUiOffer();
      const oldDiscovery = await discover();
      const oldOffer = oldDiscovery?.offers?.find((offer) => offer.frameId === 0);
      assert(oldOffer && oldOffer.expiresAt >= Date.now() + 10_000, 'worker_restart_old_offer_missing_or_near_expiry');
      const previousWorker = worker;
      const workerUrl = previousWorker.url();
      const cdp = await context.newCDPSession(page);
      const realmMarkerProperty = `__vaultCanaryWorkerRealm_${crypto.randomUUID().replaceAll('-', '')}`;
      let realmMarkerSet = false;
      try {
        const targetSnapshot = await cdp.send('Target.getTargets');
        const oldTarget = targetSnapshot.targetInfos.find((target) => target.type === 'service_worker' && target.url === workerUrl);
        if (!oldTarget || typeof refreshWorker !== 'function') {
          lifecycle.disposition = 'not_tested_worker_target_or_refresh_unavailable';
        } else {
          const versions = [];
          cdp.on('ServiceWorker.workerVersionUpdated', (event) => versions.push(...(event.versions || [])));
          await cdp.send('ServiceWorker.enable');
          let oldVersion;
          for (let attempt = 0; attempt < 20; attempt += 1) {
            oldVersion = versions.find((version) => version.scriptURL === workerUrl && version.targetId === oldTarget.targetId && typeof version.versionId === 'string');
            if (oldVersion) break;
            await wait(100);
          }
          if (!oldVersion) {
            lifecycle.disposition = 'not_tested_service_worker_version_unavailable';
          } else {
            const workerRuntimeId = await previousWorker.evaluate(() => chrome.runtime.id);
            lifecycle.workerRealmMarkerPresentBeforeStop = await previousWorker.evaluate((property) => {
              globalThis[property] = true;
              return globalThis[property] === true;
            }, realmMarkerProperty);
            realmMarkerSet = lifecycle.workerRealmMarkerPresentBeforeStop === true;
            assert(realmMarkerSet && typeof workerRuntimeId === 'string' && workerRuntimeId.length > 0, 'worker_restart_realm_marker_not_set');
            lifecycle.uiCandidatePreStop = await uiCandidateState();
            lifecycle.uiCandidateObservedAt = Date.now();
            lifecycle.oldOfferRemainingMs = oldOffer.expiresAt - Date.now();
            lifecycle.uiCandidateBeforeTtl = uiCandidate.expiresAt > lifecycle.uiCandidateObservedAt + 10_000;
            assert(lifecycle.uiCandidatePreStop.regionPresent && lifecycle.uiCandidatePreStop.generatedCandidatePresent && lifecycle.uiCandidatePreStop.offerPresent && lifecycle.uiCandidateBeforeTtl && lifecycle.oldOfferRemainingMs >= 10_000, 'worker_restart_ui_candidate_not_live_before_stop');
            await cdp.send('ServiceWorker.stopWorker', { versionId: oldVersion.versionId });
            let oldTargetGone = false;
            for (let attempt = 0; attempt < 30; attempt += 1) {
              const targets = await cdp.send('Target.getTargets');
              if (!targets.targetInfos.some((target) => target.targetId === oldTarget.targetId)) { oldTargetGone = true; break; }
              await wait(100);
            }
            lifecycle.oldWorkerTargetGone = oldTargetGone;
            if (!oldTargetGone) {
              lifecycle.disposition = 'not_tested_worker_stop_not_observed';
            } else {
              await panel.waitFor(`!!(${lifecycleSection}) && !(${lifecycleSection})?.querySelector('code') && !(${lifecycleSection})?.querySelector('[name="generated-password-target"]') && !!(${lifecycleButton('Generate')}) && !(${lifecycleButton('Generate')}).disabled && (${lifecycleSection})?.innerText.includes('generator connection changed')`);
              lifecycle.uiCandidateClearedOnDisconnect = true;
              lifecycle.uiCandidateClearedAt = Date.now();
              assert(lifecycle.uiCandidateClearedAt < uiCandidate.expiresAt, 'worker_restart_ui_clear_after_expiry');
              // A real panel Port wakes the worker; do not depend on unrelated alarms.
              // Keep the old connection ID for the stale-offer refusal below.
              const restartedConnectionId = await openGeneratorConnection();
              checkpoint('generator_worker_restart_port_woke');
              worker = await refreshWorker(previousWorker, {
                cdp,
                workerUrl,
              });
              const afterPanel = await panelIdentity();
              lifecycle.samePanelTargetAndDocument = afterPanel.targetId === uiCandidate.identity.targetId && afterPanel.documentId === uiCandidate.identity.documentId;
              assert(lifecycle.samePanelTargetAndDocument, 'worker_restart_panel_identity_changed');
              const targets = await cdp.send('Target.getTargets');
              const currentTarget = targets.targetInfos.find((target) => target.type === 'service_worker' && target.url === workerUrl);
              assert(currentTarget, 'worker_restart_current_target_missing');
              lifecycle.targetIdReused = currentTarget.targetId === oldTarget.targetId;
              const realm = await worker.evaluate(({ property, runtimeId, url }) => ({
                markerAbsent: !(property in globalThis),
                exactRuntime: chrome.runtime.id === runtimeId,
                exactWorkerUrl: location.href === url,
              }), { property: realmMarkerProperty, runtimeId: workerRuntimeId, url: workerUrl });
              lifecycle.workerRealmReset = realm?.markerAbsent === true && realm?.exactRuntime === true && realm?.exactWorkerUrl === true;
              assert(lifecycle.workerRealmReset, 'worker_restart_realm_not_reset');
              lifecycle.oldOfferRemainingMs = oldOffer.expiresAt - Date.now();
              assert(lifecycle.oldOfferRemainingMs >= 10_000, 'worker_restart_old_offer_insufficient_ttl_headroom');
              const oldUse = await use(oldOffer.id);
              lifecycle.oldOfferStatus = oldUse?.status ?? 'missing_response';
              lifecycle.oldOfferCompletedBeforeExpiry = Date.now() < oldOffer.expiresAt;
              assert(lifecycle.oldOfferCompletedBeforeExpiry, 'worker_restart_old_offer_refusal_after_expiry');
              lifecycle.oldOfferFieldsUnchanged = await unchanged(page);
              assert(lifecycle.oldOfferStatus === 'stale' && lifecycle.oldOfferFieldsUnchanged, 'worker_restart_old_offer_survived');
              connectionId = restartedConnectionId;
              await freshUiGenerateUse('worker_restart_fresh_ui_recovery_failed');
              lifecycle.freshUiGenerateUse = true;
              lifecycle.disposition = 'passed';
            }
          }
        }
      } finally {
        if (realmMarkerSet) {
          try {
            await previousWorker.evaluate((property) => { delete globalThis[property]; }, realmMarkerProperty);
          } catch {}
        }
        await cdp.send('ServiceWorker.disable').catch(() => {});
      }
      if (lifecycle.disposition !== 'passed') {
        (evidence.remaining ||= []).push(`worker-restart lifecycle ${lifecycle.disposition}`);
        return;
      }
    }
    if (windowSwitchLifecycleMode) {
      const lifecycle = evidence.windowSwitchLifecycle = { disposition: 'in_progress' };
      checkpoint('generator_window_switch_offer');
      const uiCandidate = await generateUiOffer();
      const oldDiscovery = await discover();
      const oldOffer = oldDiscovery?.offers?.find((offer) => offer.frameId === 0);
      assert(oldOffer && oldOffer.expiresAt >= Date.now() + 10_000, 'window_switch_old_offer_missing_or_near_expiry');
      lifecycle.uiCandidatePreSwitch = await uiCandidateState();
      lifecycle.uiCandidateObservedAt = Date.now();
      lifecycle.uiCandidateBeforeTtl = uiCandidate.expiresAt > lifecycle.uiCandidateObservedAt + 10_000;
      assert(lifecycle.uiCandidatePreSwitch.regionPresent && lifecycle.uiCandidatePreSwitch.generatedCandidatePresent && lifecycle.uiCandidatePreSwitch.offerPresent && lifecycle.uiCandidateBeforeTtl, 'window_switch_ui_candidate_missing');
      const before = await worker.evaluate(async (id) => {
        const tab = await chrome.tabs.get(id); const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        return { windowId: tab.windowId, tabActive: tab.active === true, focusedWindowId: focused.id, focused: focused.focused === true };
      }, tabId);
      assert(before.focused && before.focusedWindowId === before.windowId && before.tabActive, 'window_switch_fixture_not_focused_before_transition');
      let extraWindowId = null;
      let createdTargetId = null;
      let baselineWindowIds = [];
      let extraWindowClosed = false;
      let windowFocusProbeKey = null;
      let panelMessageProbeInstalled = false;
      const cdp = await context.newCDPSession(page);
      const closeOwnedExtraWindow = async () => {
        let cleanupVerified = false;
        if (Number.isInteger(extraWindowId)) {
          const removed = await worker.evaluate(async (id) => {
            try { await chrome.windows.remove(id); return true; }
            catch { return false; }
          }, extraWindowId);
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const windows = await worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((window) => window.id).filter(Number.isInteger).sort((left, right) => left - right));
            const targets = await cdp.send('Target.getTargets').catch(() => null);
            cleanupVerified = removed === true && !windows.includes(extraWindowId) && windows.length === baselineWindowIds.length && baselineWindowIds.every((id) => windows.includes(id)) && Array.isArray(targets?.targetInfos) && !targets.targetInfos.some((target) => target.targetId === createdTargetId);
            if (cleanupVerified) break;
            await wait(100);
          }
          lifecycle.ownedExtraWindowCleanup = cleanupVerified ? 'verified_chrome_window_removed' : 'failed_chrome_window_removal_verification';
        } else if (createdTargetId) {
          const closed = await cdp.send('Target.closeTarget', { targetId: createdTargetId }).catch(() => ({ success: false }));
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const windows = await worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((window) => window.id).filter(Number.isInteger));
            const targets = await cdp.send('Target.getTargets').catch(() => null);
            cleanupVerified = closed.success === true && windows.length === baselineWindowIds.length && baselineWindowIds.every((id) => windows.includes(id)) && Array.isArray(targets?.targetInfos) && !targets.targetInfos.some((target) => target.targetId === createdTargetId);
            if (cleanupVerified) break;
            await wait(100);
          }
          lifecycle.ownedExtraWindowCleanup = cleanupVerified ? 'verified_created_target_closed' : 'failed_created_target_cleanup_verification';
        } else {
          lifecycle.ownedExtraWindowCleanup = 'not_created_or_unidentified';
        }
        extraWindowClosed = cleanupVerified;
        return cleanupVerified;
      };
      try {
        baselineWindowIds = await worker.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((window) => window.id).filter(Number.isInteger).sort((left, right) => left - right));
        // Install before creating the target: background:false can focus the
        // new normal window before Target.createTarget resolves. Keep IDs only
        // in the worker realm and project them to a boolean after discovery.
        windowFocusProbeKey = `__vaultCanaryWindowFocus_${crypto.randomUUID().replaceAll('-', '')}`;
        await worker.evaluate((key) => {
          const state = { eventCount: 0, observedWindowIds: new Set() };
          const listener = (windowId) => {
            state.eventCount += 1;
            if (Number.isInteger(windowId)) state.observedWindowIds.add(windowId);
          };
          globalThis[key] = { state, listener };
          chrome.windows.onFocusChanged.addListener(listener);
        }, windowFocusProbeKey);
        panelMessageProbeInstalled = true;
        lifecycle.generatorPortPresent = await panel.evaluate(`(() => {
          const offerId = ${JSON.stringify(oldOffer.id)};
          const state = { invalidationMessageCount: 0, invalidationForOldOfferReceived: false, generatorPortPresent: false, generatorPortDisconnected: false };
          const listener = (message) => {
            if (message?.__matrxCredentialGeneration === true && message.operation === 'invalidated') {
              state.invalidationMessageCount += 1;
              if (Array.isArray(message.offerIds) && message.offerIds.includes(offerId)) state.invalidationForOldOfferReceived = true;
            }
          };
          const port = globalThis.__vaultCanaryGeneratorPort;
          const disconnected = () => { state.generatorPortDisconnected = true; };
          state.generatorPortPresent = !!port;
          chrome.runtime.onMessage.addListener(listener);
          port?.onDisconnect.addListener(disconnected);
          globalThis.__vaultCanaryWindowSwitchProbe = { state, listener, port, disconnected };
          return state.generatorPortPresent;
        })()`);
        const created = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: false });
        createdTargetId = typeof created.targetId === 'string' ? created.targetId : null;
        lifecycle.ownedNormalWindowBaselineCount = baselineWindowIds.length;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const delta = await worker.evaluate(async (baseline) => (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((window) => window.id).filter((id) => Number.isInteger(id) && !baseline.includes(id)), baselineWindowIds);
          lifecycle.ownedNormalWindowDeltaCount = delta.length;
          if (delta.length === 1) {
            extraWindowId = delta[0];
            break;
          }
          await wait(100);
        }
        if (!Number.isInteger(extraWindowId)) {
          lifecycle.disposition = 'not_tested_second_normal_window_unavailable';
        } else {
          lifecycle.transition = await worker.evaluate(async ({ originalWindowId, otherWindowId, expectedTabId }) => {
            const waitForFocusedWindow = async (windowId) => {
              for (let attempt = 0; attempt < 20; attempt += 1) {
                const [focused, window] = await Promise.all([
                  chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
                  chrome.windows.get(windowId),
                ]);
                if (focused.id === windowId && focused.focused === true && window.focused === true)
                  return true;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              return false;
            };
            await chrome.windows.update(otherWindowId, { focused: true });
            const awayFocusedOther = await waitForFocusedWindow(otherWindowId);
            const tab = await chrome.tabs.get(expectedTabId);
            return {
              awayFocusedOther,
              originalTabActive: tab.active === true && tab.windowId === originalWindowId,
            };
          }, { originalWindowId: before.windowId, otherWindowId: extraWindowId, expectedTabId: tabId });
          lifecycle.transitionKind = 'switch_away_then_close_other_window';
          lifecycle.twoOpenWindowReturnFocus = 'not_tested_headless_runtime_limitation';
          assert(lifecycle.transition.awayFocusedOther && lifecycle.transition.originalTabActive, 'window_switch_away_focus_transition_unproven');
          const windowSwitchUiState = () => panel.evaluate(`(() => {
            const root = ${lifecycleSection};
            const opener = Array.from(root?.querySelectorAll('button') ?? []).find((button) => button.textContent.trim() === 'Password generator');
            const generate = ${lifecycleButton('Generate')};
            const regenerate = ${lifecycleButton('Regenerate')};
            const action = generate || regenerate;
            const text = root?.innerText ?? '';
            return {
              sectionPresent: !!root,
              generatorOpen: opener?.getAttribute('aria-expanded') === 'true',
              codePresent: !!root?.querySelector('code'),
              revealPresent: !!root?.querySelector('[aria-label="Reveal generated value"]'),
              offerPresent: !!root?.querySelector('[name="generated-password-target"]'),
              copyPresent: Array.from(root?.querySelectorAll('button') ?? []).some((button) => button.textContent.trim() === 'Copy'),
              usePresent: Array.from(root?.querySelectorAll('button') ?? []).some((button) => button.textContent.trim() === 'Use'),
              actionLabel: action?.textContent?.trim() === 'Generate' ? 'generate' : action?.textContent?.trim() === 'Regenerate' ? 'regenerate' : 'missing',
              actionReady: !!action && !action.disabled,
              notice: text.includes('page changed') ? 'page_changed' : text.includes('generator connection changed') ? 'connection_changed' : text.includes('Generated.') ? 'generated' : text === '' ? 'none' : 'other',
            };
          })()`);
          lifecycle.uiBeforeClearWait = await windowSwitchUiState();
          lifecycle.panelIdentityBeforeUiWait = await panelIdentity();
          const uiWaitStartedAt = Date.now();
          try {
            await panel.waitFor(`!!(${lifecycleSection}) && !(${lifecycleSection})?.querySelector('code') && !(${lifecycleSection})?.querySelector('[name="generated-password-target"]') && !!(${lifecycleButton('Generate')}) && !(${lifecycleButton('Generate')}).disabled && (${lifecycleSection})?.innerText.includes('page changed')`);
            lifecycle.uiWaitOutcome = 'cleared';
          } catch (error) {
            lifecycle.uiWaitOutcome = error instanceof Error ? error.message : 'unknown_error';
            lifecycle.uiAfterClearWait = await windowSwitchUiState().catch(() => ({ unavailable: true }));
            const panelAfterFailedWait = await panelIdentity().catch(() => null);
            lifecycle.samePanelTargetAndDocumentAfterFailedWait = panelAfterFailedWait !== null
              && panelAfterFailedWait.targetId === uiCandidate.identity.targetId
              && panelAfterFailedWait.documentId === uiCandidate.identity.documentId;
            throw error;
          } finally {
            lifecycle.uiWaitElapsedMs = Date.now() - uiWaitStartedAt;
            lifecycle.focusEvent = await worker.evaluate(({ key, expectedWindowId }) => {
              const state = globalThis[key]?.state;
              return state
                ? { eventCount: state.eventCount, focusedOtherObserved: state.observedWindowIds.has(expectedWindowId) }
                : { unavailable: true };
            }, { key: windowFocusProbeKey, expectedWindowId: extraWindowId }).catch(() => ({ unavailable: true }));
            lifecycle.panelLifecycleSignal = await panel.evaluate(`globalThis.__vaultCanaryWindowSwitchProbe?.state ?? { unavailable: true }`).catch(() => ({ unavailable: true }));
          }
          lifecycle.uiAfterClearWait = await windowSwitchUiState();
          lifecycle.uiCandidateClearedOnWindowSwitch = true;
          lifecycle.uiCandidateClearedAt = Date.now();
          assert(lifecycle.uiCandidateClearedAt < uiCandidate.expiresAt, 'window_switch_ui_clear_after_expiry');
          const afterPanel = await panelIdentity();
          lifecycle.samePanelTargetAndDocument = afterPanel.targetId === uiCandidate.identity.targetId && afterPanel.documentId === uiCandidate.identity.documentId;
          assert(lifecycle.samePanelTargetAndDocument, 'window_switch_panel_identity_changed');
          lifecycle.oldOfferRemainingMs = oldOffer.expiresAt - Date.now();
          assert(lifecycle.oldOfferRemainingMs >= 10_000, 'window_switch_old_offer_insufficient_ttl_headroom');
          lifecycle.otherWindowFocusedBeforeOldUse = await worker.evaluate(async (id) => {
            const [focused, window] = await Promise.all([
              chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
              chrome.windows.get(id),
            ]);
            return focused.id === id && focused.focused === true && window.focused === true;
          }, extraWindowId);
          assert(lifecycle.otherWindowFocusedBeforeOldUse, 'window_switch_other_window_not_focused_before_old_use');
          const oldUse = await use(oldOffer.id);
          lifecycle.oldOfferStatus = oldUse?.status ?? 'missing_response';
          lifecycle.oldOfferCompletedBeforeExpiry = Date.now() < oldOffer.expiresAt;
          assert(lifecycle.oldOfferCompletedBeforeExpiry, 'window_switch_old_offer_refusal_after_expiry');
          lifecycle.otherWindowFocusedThroughOldUse = await worker.evaluate(async (id) => {
            try {
              const [focused, window] = await Promise.all([
                chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
                chrome.windows.get(id),
              ]);
              return focused.id === id && focused.focused === true && window.focused === true;
            } catch {
              return false;
            }
          }, extraWindowId);
          assert(lifecycle.otherWindowFocusedThroughOldUse, 'window_switch_other_window_lost_focus_during_old_use');
          lifecycle.oldOfferFieldsUnchanged = await unchanged(page);
          assert(lifecycle.oldOfferStatus === 'stale' && lifecycle.oldOfferFieldsUnchanged, 'window_switch_old_offer_survived');
          assert(await closeOwnedExtraWindow(), 'window_switch_owned_extra_window_cleanup_unverified');
          lifecycle.originalFocusedAfterClose = await worker.evaluate(async ({ windowId, expectedTabId }) => {
            const [focused, window, tab] = await Promise.all([
              chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
              chrome.windows.get(windowId),
              chrome.tabs.get(expectedTabId),
            ]);
            return focused.id === windowId && focused.focused === true && window.focused === true && tab.active === true && tab.windowId === windowId;
          }, { windowId: before.windowId, expectedTabId: tabId });
          assert(lifecycle.originalFocusedAfterClose, 'window_switch_original_focus_not_restored_after_close');
          await freshUiGenerateUse('window_switch_fresh_ui_recovery_failed');
          lifecycle.freshUiGenerateUse = true;
          lifecycle.disposition = 'passed';
        }
      } finally {
        if (windowFocusProbeKey) {
          await worker.evaluate((key) => {
            const probe = globalThis[key];
            if (probe?.listener) chrome.windows.onFocusChanged.removeListener(probe.listener);
            delete globalThis[key];
          }, windowFocusProbeKey).catch(() => {});
        }
        if (panelMessageProbeInstalled) {
          await panel.evaluate(`(() => {
            const probe = globalThis.__vaultCanaryWindowSwitchProbe;
            if (probe?.listener) chrome.runtime.onMessage.removeListener(probe.listener);
            probe?.port?.onDisconnect.removeListener(probe.disconnected);
            delete globalThis.__vaultCanaryWindowSwitchProbe;
          })()`).catch(() => {});
        }
        if (!extraWindowClosed && (Number.isInteger(extraWindowId) || createdTargetId)) await closeOwnedExtraWindow();
        if (!extraWindowClosed && lifecycle.disposition === 'passed') lifecycle.disposition = 'failed_owned_extra_window_cleanup_unverified';
      }
      if (lifecycle.disposition !== 'passed') {
        (evidence.remaining ||= []).push(`window-switch lifecycle ${lifecycle.disposition}`);
        return;
      }
    }
    if (panelCloseLifecycleMode) {
      const lifecycle = evidence.panelCloseLifecycle = { disposition: 'in_progress', offerKind: 'raw_discover_offer' };
      checkpoint('generator_panel_close_offer');
      const lifecycleDiscovery = await discover();
      const oldOffer = lifecycleDiscovery?.offers?.find((offer) => offer.frameId === 0);
      assert(oldOffer && oldOffer.expiresAt > Date.now() + 1000, 'panel_close_old_offer_missing_or_near_expiry');
      const intervalId = crypto.randomUUID();
      const before = await worker.evaluate(async (id) => {
        const tab = await chrome.tabs.get(id);
        const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        return { tabId: tab.id, windowId: tab.windowId, tabActive: tab.active === true, focusedWindowId: focused.id, focused: focused.focused === true };
      }, tabId);
      assert(before.tabActive && before.focused && before.windowId === before.focusedWindowId, 'panel_close_fixture_not_active_before_transition');
      await worker.evaluate((id) => {
        const state = { activated: 0, focusChanged: 0 };
        const onActivated = () => { state.activated += 1; };
        const onFocusChanged = () => { state.focusChanged += 1; };
        globalThis.__vaultPanelCloseLifecycle = { id, state, onActivated, onFocusChanged };
        chrome.tabs.onActivated.addListener(onActivated);
        chrome.windows.onFocusChanged.addListener(onFocusChanged);
      }, intervalId);
      const cdp = await context.newCDPSession(page);
      try {
        const supportsClose = await worker.evaluate(() => typeof chrome.sidePanel?.close === 'function');
        if (!supportsClose || typeof reopenPanelFromAction !== 'function') {
          lifecycle.disposition = !supportsClose ? 'not_tested_side_panel_close_unavailable' : 'not_tested_action_popup_reopen_unavailable';
        } else {
          const oldTargetId = panel.targetId;
          const beforeContexts = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
          assert(beforeContexts.length === 1, 'panel_close_initial_context_missing');
          lifecycle.initialContextWasGlobal = beforeContexts[0].windowId === -1;
          const closeResult = await worker.evaluate(async (windowId) => {
            try { await chrome.sidePanel.close({ windowId }); return 'requested'; }
            catch { return 'refused'; }
          }, before.windowId);
          if (closeResult !== 'requested') {
            lifecycle.disposition = 'not_tested_side_panel_close_refused';
          } else {
            let closed = false;
            for (let attempt = 0; attempt < 30; attempt += 1) {
              const contexts = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
              const targets = await cdp.send('Target.getTargets');
              if (contexts.length === 0 && !targets.targetInfos.some((target) => target.targetId === oldTargetId)) { closed = true; break; }
              await wait(100);
            }
            if (!closed) {
              lifecycle.disposition = 'not_tested_panel_destruction_unproven';
            } else {
              panel.dispose();
              const reopened = await reopenPanelFromAction(page, before.windowId);
              if (!reopened.opened) {
                lifecycle.disposition = `not_tested_${reopened.reason}`;
                lifecycle.actionPopupReadiness = reopened.readiness ?? null;
              } else {
                panel = reopened.panel;
                const afterContexts = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
                assert(afterContexts.length === 1 && afterContexts[0].documentId !== beforeContexts[0].documentId && panel.targetId !== oldTargetId, 'panel_close_reopen_not_new_document');
                lifecycle.oldTargetDestroyed = true;
                lifecycle.reopenedNewDocument = true;
                // This case owns a raw host offer, not a generated UI value. A
                // UI-value-disposal claim needs a separate positive Generate
                // transition before close and must not be inferred here.
                lifecycle.reopenedUiValueDisposal = 'not_claimed_raw_offer_only';
                const oldConnectionId = connectionId;
                connectionId = await openGeneratorConnection();
                lifecycle.reopenedConnectionDistinct = connectionId !== oldConnectionId;
                assert(lifecycle.reopenedConnectionDistinct, 'panel_close_reopened_connection_reused');
                checkpoint('generator_panel_close_old_offer');
                lifecycle.oldOfferRemainingMs = oldOffer.expiresAt - Date.now();
                assert(lifecycle.oldOfferRemainingMs >= 10_000, 'panel_close_old_offer_insufficient_ttl_headroom');
                const oldUse = await use(oldOffer.id);
                lifecycle.oldOfferStatus = oldUse?.status ?? 'missing_response';
                lifecycle.oldOfferCompletedBeforeExpiry = Date.now() < oldOffer.expiresAt;
                assert(lifecycle.oldOfferCompletedBeforeExpiry, 'panel_close_old_offer_refusal_after_expiry');
                lifecycle.oldOfferFieldsUnchanged = await unchanged(page);
                const after = await worker.evaluate(async (id) => {
                  const tab = await chrome.tabs.get(id);
                  const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
                  const tracker = globalThis.__vaultPanelCloseLifecycle;
                  return { tabId: tab.id, windowId: tab.windowId, tabActive: tab.active === true, focusedWindowId: focused.id, focused: focused.focused === true, activated: tracker?.state?.activated ?? -1, focusChanged: tracker?.state?.focusChanged ?? -1 };
                }, tabId);
                lifecycle.transitionCounters = after;
                assert(after.tabId === before.tabId && after.windowId === before.windowId && after.tabActive && after.focused && after.focusedWindowId === before.focusedWindowId && after.activated === 0 && after.focusChanged === 0, 'panel_close_transition_changed_tab_or_window');
                lifecycle.noTabOrWindowInvalidation = true;
                if (lifecycle.oldOfferStatus !== 'stale') {
                  lifecycle.disposition = 'failed_old_offer_survived';
                  throw new Error('panel_close_old_offer_survived');
                }
                if (!lifecycle.oldOfferFieldsUnchanged) {
                  lifecycle.disposition = 'failed_old_offer_wrote_value';
                  throw new Error('panel_close_old_offer_wrote_value');
                }
                const freshDiscovery = await discover();
                const freshOffer = freshDiscovery?.offers?.find((offer) => offer.frameId === 0);
                assert(freshOffer, 'panel_close_fresh_offer_missing');
                assert((await use(freshOffer.id))?.status === 'filled', 'panel_close_fresh_offer_refused');
                assert(await matches(page), 'panel_close_fresh_offer_value_mismatch');
                await page.evaluate(() => { document.querySelector('#new').value = ''; document.querySelector('#confirm').value = ''; });
                lifecycle.disposition = 'passed';
                lifecycle.oldOfferRefusedUnchanged = true;
                lifecycle.freshRecoveryFilled = true;
              }
            }
          }
        }
      } finally {
        await worker.evaluate((id) => {
          const tracker = globalThis.__vaultPanelCloseLifecycle;
          if (tracker?.id === id) {
            chrome.tabs.onActivated.removeListener(tracker.onActivated);
            chrome.windows.onFocusChanged.removeListener(tracker.onFocusChanged);
            delete globalThis.__vaultPanelCloseLifecycle;
          }
        }, intervalId).catch(() => {});
      }
      if (lifecycle.disposition !== 'passed') {
        (evidence.remaining ||= []).push(`panel-close lifecycle ${lifecycle.disposition}`);
        return;
      }
    }
    checkpoint('generator_positive_ui');
    await verifyRealVaultPanel();
    await panel.waitFor(`!!document.querySelector('[aria-label="Password generator"]')`);
    await page.evaluate(() => {
      document.querySelectorAll('iframe').forEach((frame) => frame.remove());
      document.querySelector('#new').value = '';
      document.querySelector('#confirm').value = '';
    });
    const section = `document.querySelector('[aria-label="Password generator"]')`;
    const button = (label) => `Array.from((${section}).querySelectorAll("button")).find((button) => button.textContent.trim() === ${JSON.stringify(label)})`;
    const nativeModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const clipboardMarker = 'matrx-vault-canary-clipboard-marker';
    const generatedValueWait = `!!(${section})?.querySelector('[aria-label="Reveal generated value"]') && (${section})?.innerText.includes('Generated.')`;
    const captureGenerateTimeout = async (kind, phase, knobResolve) => {
      let panelState;
      try {
        panelState = await panel.evaluate(`(() => {
          const root = (${section});
          const opener = Array.from(root?.querySelectorAll('button') ?? []).find((control) => control.textContent.trim() === 'Password generator');
          const control = (label) => Array.from(root?.querySelectorAll('button') ?? []).find((candidate) => candidate.textContent.trim() === label);
          const notice = root?.querySelector('[aria-live]')?.textContent?.trim() ?? '';
          const active = document.activeElement;
          const activeControl = active === opener ? 'opener'
            : active === control('Password') ? 'password'
            : active === control('Passphrase') ? 'passphrase'
            : active === control('Generate') || active === control('Regenerate') ? 'generate'
            : active?.getAttribute('aria-label') === 'Reveal generated value' ? 'reveal'
            : active?.getAttribute('aria-label') === 'Hide generated value' ? 'hide'
            : active === control('Copy') ? 'copy'
            : active === control('Use') ? 'use'
            : active?.tagName === 'INPUT' ? 'input'
            : active?.tagName === 'BUTTON' ? 'other_button'
            : active?.tagName?.toLowerCase() ?? 'none';
          return {
            generatorPresent: !!root,
            generatorOpen: opener?.getAttribute('aria-expanded') === 'true',
            documentFocused: document.hasFocus(),
            activeControl,
            busySpinnerPresent: !!root?.querySelector('.animate-spin'),
            generateDisabled: !!control('Generate')?.disabled || !!control('Regenerate')?.disabled || !!root?.querySelector('.animate-spin')?.closest('button')?.disabled,
            passwordDisabled: !!control('Password')?.disabled,
            passphraseDisabled: !!control('Passphrase')?.disabled,
            generatedCodePresent: !!root?.querySelector('code'),
            notice: notice === '' ? 'none'
              : notice.startsWith('Finding compatible new-password fields') ? 'finding_compatible_fields'
              : notice.startsWith('Generated.') ? 'generated'
              : notice.includes('secure limits could not be loaded') ? 'configuration_unavailable'
              : notice.includes('page or account changed') ? 'page_or_account_changed'
              : notice.includes('page changed') ? 'page_changed'
              : notice.includes('Options changed') ? 'options_changed'
              : 'other',
          };
        })()`);
      } catch {
        panelState = { unavailable: true };
      }
      evidence.uiTimeoutDiagnostic = { phase, kind, ...panelState, knobResolve: knobResolve.snapshot() };
      checkpoint(`${phase}_timeout`);
    };
    const waitForGeneratedValue = async (kind, phase, knobResolve) => {
      try {
        await panel.waitFor(generatedValueWait);
      } catch (error) {
        await captureGenerateTimeout(kind, phase, knobResolve);
        throw error;
      } finally {
        knobResolve.stop();
      }
    };
    const replaceOwnedCopiedClipboard = async (expectedValue) => {
      assert(!headlessNoClipboardMode, 'headless_clipboard_path_refused');
      if (!page || page.isClosed() || typeof expectedValue !== 'string') return 'unknown';
      const target = page.locator('#clipboard-fixture');
      try {
        await target.focus();
        await page.keyboard.press(`${nativeModifier}+V`);
        const owned = await page.evaluate((value) => {
          const textarea = document.querySelector('#clipboard-fixture');
          const matchesValue = textarea?.value === value;
          if (textarea) textarea.value = '';
          return matchesValue;
        }, expectedValue);
        // A mismatch can also be a failed native paste. Leave the clipboard
        // untouched unless the exact copied value was positively observed.
        if (!owned) return 'unknown';
        await page.evaluate((marker) => {
          const textarea = document.querySelector('#clipboard-fixture');
          textarea.value = marker;
          textarea.focus();
          textarea.select();
        }, clipboardMarker);
        // Replace only the generated value just proven by native paste. The
        // marker is harmless fixture data and the following paste verifies it.
        await page.keyboard.press(`${nativeModifier}+C`);
        await page.evaluate(() => { document.querySelector('#clipboard-fixture').value = ''; });
        await target.focus();
        await page.keyboard.press(`${nativeModifier}+V`);
        const markerVerified = await page.evaluate((marker) => {
          const textarea = document.querySelector('#clipboard-fixture');
          const matchesMarker = textarea?.value === marker;
          if (textarea) textarea.value = '';
          return matchesMarker;
        }, clipboardMarker);
        return markerVerified ? 'owned_value_replaced' : 'unknown';
      } catch {
        return 'unknown';
      }
    };
    await panel.click(button('Password generator'));
    for (const kind of ['Password', 'Passphrase']) {
      await panel.click(button(kind));
      const phase = `generator_${kind.toLowerCase()}_generated_value_wait`;
      checkpoint(`${phase}_start`);
      const knobResolve = panel.startKnobResolveProbe();
      await panel.click(button('Generate'));
      await wait(1000);
      evidence.uiAfterGenerate = await panel.evaluate(`({ generatorPresent: !!(${section}), selectedVault: document.querySelector('[title="Vault"]')?.getAttribute('aria-selected'), generatedCodePresent: !!(${section})?.querySelector('code'), signInPresent: /Sign in/.test(document.body.innerText), loadingPresent: !!document.querySelector('.animate-spin') })`);
      checkpoint(phase);
      await waitForGeneratedValue(kind, phase, knobResolve);
      assert(await panel.evaluate(`(${section}).querySelector('code').textContent === '••••••••••••••••••••••••'`), 'generator_value_not_masked');
      await panel.click(`(${section}).querySelector('[aria-label="Reveal generated value"]')`);
      synthetic = await panel.evaluate(`(${section}).querySelector('code').textContent`);
      assert(typeof synthetic === 'string' && (kind === 'Password' ? synthetic.length === 24 : synthetic.length >= 11 && synthetic.includes('-')), 'generator_default_value_invalid');
      if (kind === 'Password' && !headlessNoClipboardMode) {
        copiedSyntheticValue = synthetic;
        clipboardCustody.copyAttempted = true;
        await panel.click(button('Copy'));
        await panel.waitFor(`(${section})?.innerText.includes('Copied. Clipboard is not cleared automatically.')`);
        await page.bringToFront();
        // Exercise the cleanup path for an interruption after the real Copy
        // action without simulating a product failure, then continue normally.
        try {
          throw new Error('controlled_post_copy_acceptance_interruption');
        } catch {
          clipboardCustody.disposition = await replaceOwnedCopiedClipboard(copiedSyntheticValue);
        }
        assert(clipboardCustody.disposition === 'owned_value_replaced', 'generator_copy_native_paste_or_owned_replacement_mismatch');
        evidence.checks.passwordCopyNativePasteAndOwnedGeneratedClipboardReplacementVerified = true;
        evidence.checks.passwordCopyControlledFailureCustody = true;
        await focusOwnedBrowser(tabId);
      } else if (kind === 'Password') {
        // Clipboard custody requires an isolated native clipboard surface.
        // This narrow headless mode deliberately leaves the host clipboard untouched.
        clipboardCustody.disposition = 'not_run_requires_isolated_clipboard';
      }
      await panel.click(`(${section}).querySelector('[aria-label="Hide generated value"]')`);
      await panel.click(button('Regenerate'));
      await panel.waitFor(`!!(${section})?.querySelector('[aria-label="Reveal generated value"]') && (${section})?.innerText.includes('Generated.')`);
      await panel.click(`(${section}).querySelector('[aria-label="Reveal generated value"]')`);
      const regenerated = await panel.evaluate(`(${section}).querySelector('code').textContent`);
      assert(regenerated !== synthetic, 'generator_regenerate_reused_value');
      synthetic = regenerated;
      await panel.click(`(${section}).querySelector('[aria-label="Hide generated value"]')`);
      if (kind === 'Password') {
        try {
          await panel.screenshot(section, screenshotPath);
          evidence.maskedUiScreenshot = true;
        } catch (error) {
          if (!headlessNoClipboardMode) throw error;
          evidence.maskedUiScreenshot = false;
          evidence.maskedUiVisualEvidence = 'unverified_headless_capture_refused';
        }
      }
      await panel.click(button('Use'));
      await panel.waitFor(`!(${section}).querySelector('code') && /Filled/.test((${section}).innerText)`);
      assert(await matches(page), 'generator_ui_fill_mismatch');
      evidence.checks[kind.toLowerCase() + 'GenerateRevealRegenerateUse'] = true;
      await page.evaluate(() => { document.querySelector('#new').value = ''; document.querySelector('#confirm').value = ''; });
    }
    const captureKeyboardTimeout = async (step, key) => {
      let panelState;
      try {
        panelState = await panel.evaluate(`(() => {
          const root = (${section});
          const opener = Array.from(root?.querySelectorAll('button') ?? []).find((control) => control.textContent.trim() === 'Password generator');
          const active = document.activeElement;
          const activeControl = active === opener ? 'opener'
            : active?.getAttribute('aria-label') === 'Reveal generated value' ? 'reveal'
            : active?.getAttribute('aria-label') === 'Hide generated value' ? 'hide'
            : active?.tagName === 'INPUT' ? 'input'
            : active?.tagName === 'BUTTON' ? 'button'
            : active?.tagName?.toLowerCase() ?? 'none';
          return {
            generatorPresent: !!root,
            generatorOpen: opener?.getAttribute('aria-expanded') === 'true',
            generatedCodePresent: !!root?.querySelector('code'),
            busySpinnerPresent: !!root?.querySelector('.animate-spin'),
            documentFocused: document.hasFocus(),
            activeControl,
            activeFocusVisible: !!active?.matches(':focus-visible'),
            openerFocused: active === opener,
          };
        })()`);
      } catch {
        panelState = { unavailable: true };
      }
      evidence.keyboardTimeoutDiagnostic = { step, key, ...panelState };
      checkpoint(`generator_keyboard_${step}_timeout`);
    };
    const dispatchAndWaitForKeyboard = async (step, event, condition) => {
      checkpoint(`generator_keyboard_${step}_dispatch`);
      await panel.key(event);
      checkpoint(`generator_keyboard_${step}_wait`);
      try {
        await panel.waitFor(condition);
      } catch (error) {
        await captureKeyboardTimeout(step, event.key);
        throw error;
      }
    };
    // Generate a fresh value solely to prove that actual key events clear it,
    // collapse the section, and return focus to its native opener.
    await panel.click(button('Password'));
    await panel.click(button('Generate'));
    await panel.waitFor(`!!(${section})?.querySelector('[aria-label="Reveal generated value"]')`);
    await dispatchAndWaitForKeyboard('escape_generated_clear', { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, `(${section})?.querySelector('[aria-expanded="false"]') && !(${section})?.querySelector('code') && document.activeElement === (${button('Password generator')})`);
    evidence.checks.escapeClearsCollapsesAndRestoresOpenerFocus = true;

    await dispatchAndWaitForKeyboard('enter_opens', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, `(${section})?.querySelector('[aria-expanded="true"]') && !(${section})?.querySelector('code')`);
    await dispatchAndWaitForKeyboard('escape_after_enter', { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, `(${section})?.querySelector('[aria-expanded="false"]') && document.activeElement === (${button('Password generator')})`);
    await dispatchAndWaitForKeyboard('space_opens', { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }, `(${section})?.querySelector('[aria-expanded="true"]') && !(${section})?.querySelector('code')`);
    await panel.evaluate(`(${button('Password generator')}).focus()`);
    await dispatchAndWaitForKeyboard('tab_password_focus', { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, `document.activeElement === (${button('Password')}) && document.activeElement.matches(':focus-visible')`);
    evidence.checks.keyboardEnterSpaceAndTabNativeFocus = true;
    await dispatchAndWaitForKeyboard('escape_final', { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, `(${section})?.querySelector('[aria-expanded="false"]') && document.activeElement === (${button('Password generator')})`);
    evidence.positiveGenerateRevealUse = true;
    evidence.remaining = [
      ...(evidence.remaining || []),
      ...(headlessNoClipboardMode ? ['clipboard acceptance requires an isolated clipboard session'] : []),
      ...(!workerRestartLifecycleMode ? ['worker restart needs a separate real-browser case'] : []),
      ...(!windowSwitchLifecycleMode ? ['normal-window switch needs a separate real-browser case'] : []),
      ...(windowSwitchLifecycleMode ? ['two-open-normal-window return focus remains untested in the headless runtime'] : []),
      'actor and organization switches need separate real-browser cases',
      'distributed artifact and other browsers remain separate acceptance',
    ];
  } finally {
    if (!headlessNoClipboardMode && clipboardCustody.copyAttempted && clipboardCustody.disposition !== 'owned_value_replaced') {
      try {
        clipboardCustody.disposition = await replaceOwnedCopiedClipboard(copiedSyntheticValue);
      } catch {
        clipboardCustody.disposition = 'unknown';
      }
    }
    copiedSyntheticValue = null;
    synthetic = '';
    if (page && !page.isClosed()) await page.close();
    if (top) await top.close();
    await child.close();
    evidence.ownedFixtureServersClosed = true;
  }
};
