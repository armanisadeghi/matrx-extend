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
      ${childUrl && request.url !== '/embedded' ? `<iframe title="Embedded password form" src="${childUrl}" style="width:100%;height:220px"></iframe><iframe title="Same-site password form" src="/embedded" style="width:100%;height:220px"></iframe>` : ''}
      </body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { state, url: `http://127.0.0.1:${server.address().port}/password`, close: () => new Promise((resolve) => server.close(resolve)) };
}

exports.runGeneratorChecks = async ({ context, worker, panel, assert, wait, checkpoint, proof, focusOwnedBrowser, screenshotPath, verifyRealVaultPanel }) => {
  const child = await fixture();
  let top;
  let page;
  let synthetic = `generated-${crypto.randomUUID()}`;
  const evidence = proof.generator = { scope: 'real side-panel host transport and password/passphrase controls', hostTransportOk: false, positiveGeneratorUi: false, checks: {} };
  try {
    top = await fixture(child.url);
    page = await context.newPage();
    await page.goto(top.url);
    await page.bringToFront();
    const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, top.url);
    assert(Number.isInteger(tabId), 'generator_fixture_tab_missing');
    for (let focusAttempt = 0; focusAttempt < 5; focusAttempt++) {
    await focusOwnedBrowser();
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
    const request = (payload) => panel.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ __matrxCredentialGeneration: true, ...payload })})`);
    const discover = () => request({ operation: 'discover', tabId });
    const use = (offerId) => request({ operation: 'use', offerId, value: synthetic });
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
    await focusOwnedBrowser();
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
    await panel.click(button('Password generator'));
    for (const kind of ['Password', 'Passphrase']) {
      await panel.click(button(kind));
      await panel.click(button('Generate'));
      await wait(1000);
      evidence.uiAfterGenerate = await panel.evaluate(`({ generatorPresent: !!(${section}), selectedVault: document.querySelector('[title="Vault"]')?.getAttribute('aria-selected'), generatedCodePresent: !!(${section})?.querySelector('code'), signInPresent: /Sign in/.test(document.body.innerText), loadingPresent: !!document.querySelector('.animate-spin') })`);
      checkpoint('generator_ui_after_generate');
      await panel.waitFor(`!!(${section})?.querySelector('[aria-label="Reveal generated value"]') && (${section})?.innerText.includes('Generated.')`);
      assert(await panel.evaluate(`(${section}).querySelector('code').textContent === '••••••••••••••••••••••••'`), 'generator_value_not_masked');
      await panel.click(`(${section}).querySelector('[aria-label="Reveal generated value"]')`);
      synthetic = await panel.evaluate(`(${section}).querySelector('code').textContent`);
      assert(typeof synthetic === 'string' && (kind === 'Password' ? synthetic.length === 24 : synthetic.length >= 11 && synthetic.includes('-')), 'generator_default_value_invalid');
      await panel.click(`(${section}).querySelector('[aria-label="Hide generated value"]')`);
      await panel.click(button('Regenerate'));
      await panel.waitFor(`!!(${section})?.querySelector('[aria-label="Reveal generated value"]') && (${section})?.innerText.includes('Generated.')`);
      await panel.click(`(${section}).querySelector('[aria-label="Reveal generated value"]')`);
      const regenerated = await panel.evaluate(`(${section}).querySelector('code').textContent`);
      assert(regenerated !== synthetic, 'generator_regenerate_reused_value');
      synthetic = regenerated;
      await panel.click(`(${section}).querySelector('[aria-label="Hide generated value"]')`);
      if (kind === 'Password') await panel.screenshot(section, screenshotPath);
      await panel.click(button('Use'));
      await panel.waitFor(`!(${section}).querySelector('code') && /Filled/.test((${section}).innerText)`);
      assert(await matches(page), 'generator_ui_fill_mismatch');
      evidence.checks[kind.toLowerCase() + 'GenerateRevealRegenerateUse'] = true;
      await page.evaluate(() => { document.querySelector('#new').value = ''; document.querySelector('#confirm').value = ''; });
    }
    evidence.positiveGenerateRevealUse = true;
    evidence.maskedUiScreenshot = true;
    evidence.remaining = ['clipboard and keyboard acceptance', 'window/actor/organization switches and restart need separate real-browser cases', 'distributed artifact and other browsers remain separate acceptance'];
  } finally {
    synthetic = '';
    if (page && !page.isClosed()) await page.close();
    if (top) await top.close();
    await child.close();
    evidence.ownedFixtureServersClosed = true;
  }
};
