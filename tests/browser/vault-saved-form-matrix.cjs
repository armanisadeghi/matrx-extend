'use strict';

const crypto = require('node:crypto');
const QUIET_OBSERVATION_MS = 6200;
const READY_ATTEMPTS = 60;

function renderSavedFormMatrixHTML(kind) {
  if (!['username_first', 'late_spa', 'same_origin_frame', 'two_same_origin_frames', 'cross_origin_parent', 'frame_login'].includes(kind)) throw new Error('saved_matrix_kind_invalid');
  if (kind === 'username_first') return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="username" autocomplete="username"><button id="continue" type="button">Continue</button><input id="decoy" value="unchanged"><script>document.querySelector('#continue').onclick=()=>{const p=document.createElement('input');p.id='password';p.type='password';p.autocomplete='current-password';document.querySelector('form').append(p)}</script></form></main>`;
  if (kind === 'late_spa') return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="decoy" value="unchanged"><button id="mount" type="button">Continue</button><script>document.querySelector('#mount').onclick=()=>{document.querySelector('form').insertAdjacentHTML('beforeend','<input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password">')}</script></form></main>`;
  if (kind === 'frame_login') return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password"><input id="unrelated" value="unchanged"></form></main>`;
  if (kind === 'same_origin_frame') return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="decoy" value="unchanged"><iframe id="login-frame"></iframe><script>const c=encodeURIComponent(new URLSearchParams(location.search).get('case')||'');document.querySelector('#login-frame').src='/saved-matrix/frame_login?case='+c</script></form></main>`;
  if (kind === 'two_same_origin_frames') return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="parent-decoy" value="unchanged"><div id="parent-pointer" style="width:20px;height:20px" onclick="window.__parentPointerClicks=(window.__parentPointerClicks||0)+1"></div><iframe id="frame-a"></iframe><iframe id="frame-b"></iframe><script>window.__parentDecoyFocusCount=0;document.querySelector('#parent-decoy').addEventListener('focus',()=>window.__parentDecoyFocusCount+=1);const c=encodeURIComponent(new URLSearchParams(location.search).get('case')||'');const src='/saved-matrix/frame_login?slot=same&case='+c;document.querySelector('#frame-a').src=src;document.querySelector('#frame-b').src=src</script></form></main>`;
  return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="parent-decoy" value="unchanged"><iframe id="cross-frame"></iframe><script>const c=encodeURIComponent(new URLSearchParams(location.search).get('case')||'');document.querySelector('#cross-frame').src='http://127.0.0.1:'+location.port+'/saved-matrix/frame_login?slot=cross&case='+c</script></form></main>`;
}

const fillButton = (name) => `(() => {
  const cards = Array.from(document.querySelectorAll('li')).filter((card) => card.querySelector('span')?.textContent?.trim() === ${JSON.stringify(name)});
  if (cards.length !== 1) return null;
  const buttons = Array.from(cards[0].querySelectorAll('button')).filter((button) => button.textContent?.trim() === 'Fill' && !button.disabled);
  return buttons.length === 1 ? buttons[0] : null;
})()`;

exports.runSavedFormMatrix = async ({ context, worker, realPanel, targetName, username, password, parentOrigin, getSubmitCount, assert, wait, checkpoint = () => {}, proof, focusOwnedBrowser, verifyRealVaultPanel }) => {
  assert(context && worker && realPanel && typeof parentOrigin === 'string', 'saved_matrix_context_missing');
  assert(typeof getSubmitCount === 'function' && typeof assert === 'function' && typeof wait === 'function' && typeof focusOwnedBrowser === 'function' && typeof verifyRealVaultPanel === 'function', 'saved_matrix_controls_missing');
  const parent = new URL(parentOrigin);
  assert(parent.origin === parentOrigin && parent.hostname === '127.0.0.1' && parent.protocol === 'http:', 'saved_matrix_parent_origin_invalid');
  const evidence = { usernameFirstFilled: false, lateSpaFilled: false, sameOriginFrameFilled: false, parentPointerStaleControlRemoved: false, sameUrlSiblingBOnlyFilled: false, crossOriginFrameFilled: false, childFramesReady: false, quietNoOverlay: false, noWebsiteSubmission: false, pagesClosed: false };
  const pages = new Set();
  const childDocuments = new Set();
  const baseline = getSubmitCount();
  assert(Number.isInteger(baseline) && baseline >= 0, 'saved_matrix_submit_counter_invalid');
  let primaryFailure;
  let focusedFixture;
  const url = (kind, origin = parentOrigin) => `${origin}/saved-matrix/${kind}?case=${crypto.randomUUID()}`;
  const tabFor = async (expected) => {
    for (let i = 0; i < READY_ATTEMPTS; i += 1) {
      const id = await worker.evaluate(async (u) => (await chrome.tabs.query({})).find((tab) => tab.url === u)?.id, expected);
      if (Number.isInteger(id)) return id;
      await wait(100);
    }
    throw new Error('saved_matrix_tab_missing');
  };
  const activeNormalWindow = async (tabId) => worker.evaluate(async (id) => {
    const [tab, window] = await Promise.all([chrome.tabs.get(id), chrome.windows.getLastFocused({ windowTypes: ['normal'] })]);
    return tab.active === true && tab.windowId === window.id && window.focused === true && window.type === 'normal';
  }, tabId);
  const bridgeReady = async (tabId) => {
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      const ready = await worker.evaluate(async (id) => {
        const result = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, func: () => window.__matrx_bridge_mounted === true });
        return result[0]?.result === true;
      }, tabId);
      if (ready) return;
      await wait(100);
    }
    throw new Error('saved_matrix_top_bridge_not_ready');
  };
  const childReady = async (tabId, expectedUrl, expectedCount = 1) => {
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      const ready = await worker.evaluate(async ({ id, expected, count }) => {
        const frames = (await chrome.webNavigation.getAllFrames({ tabId: id })).filter((frame) => frame.url === expected);
        if (frames.length !== count) return false;
        const results = await Promise.all(frames.map(async (frame) => {
          const injected = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [frame.frameId] }, func: () => window.__matrx_generation_target_registry__ !== undefined });
          return injected[0]?.result === true;
        }));
        return results.every(Boolean);
      }, { id: tabId, expected: expectedUrl, count: expectedCount });
      if (ready) return;
      await wait(100);
    }
    throw new Error('saved_matrix_child_frame_not_ready');
  };
  const open = async (kind, origin = parentOrigin) => {
    const page = await context.newPage();
    pages.add(page);
    const pageUrl = url(kind, origin);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    const tabId = await tabFor(pageUrl);
    await bridgeReady(tabId);
    return { page, tabId, pageUrl };
  };
  const focusTop = async ({ page, tabId }, selector) => {
    await page.bringToFront();
    await focusOwnedBrowser(tabId);
    assert(await activeNormalWindow(tabId), 'saved_matrix_owned_normal_window_not_focused');
    await page.locator(selector).focus();
    assert(await page.evaluate((id) => document.hasFocus() && document.activeElement?.id === id, selector.slice(1)), 'saved_matrix_top_document_focus_invalid');
    focusedFixture = page;
  };
  const focusChild = async ({ page, tabId }, frameElement, expectedUrl, selector) => {
    await page.bringToFront();
    await focusOwnedBrowser(tabId);
    assert(await activeNormalWindow(tabId), 'saved_matrix_owned_normal_window_not_focused');
    assert(page.frames().some((candidate) => candidate.url() === expectedUrl && candidate.parentFrame() === page.mainFrame()), 'saved_matrix_child_frame_missing');
    const frame = page.frameLocator(frameElement);
    childDocuments.add(frame);
    await frame.locator(selector).focus();
    assert(await frame.locator(selector).evaluate((element) => document.hasFocus() && document.activeElement === element), 'saved_matrix_child_document_focus_invalid');
    assert(await page.locator(frameElement).count() === 1, 'saved_matrix_child_frame_element_missing');
    focusedFixture = frame;
    return frame;
  };
  const stableQuiet = async (frame) => {
    const deadline = Date.now() + QUIET_OBSERVATION_MS;
    const observe = async () => {
      assert(await frame.locator('#matrx-inline-login-suggestion').count() === 0, 'saved_matrix_inline_overlay_present');
    };
    await observe();
    while (Date.now() < deadline) await wait(Math.min(100, Math.max(1, deadline - Date.now())));
    await observe();
  };
  const panelFillAvailable = async () => {
    await verifyRealVaultPanel();
    const selector = fillButton(targetName);
    try { await realPanel.waitFor(`!!(${selector})`, true, 15000); } catch { throw new Error('saved_matrix_panel_fill_unavailable'); }
    return selector;
  };
  const fill = async () => {
    const selector = await panelFillAvailable();
    await realPanel.click(selector);
    try { await realPanel.waitFor(`Array.from(document.querySelectorAll('p')).some((node)=>node.textContent?.trim()==='Filled. Review the form, then sign in.')`, true, 15000); } catch {
      evidence.fillFailure = await realPanel.evaluate(`(() => {
        const text = document.body.innerText;
        return {
          staleRemedy: text.includes('Click the username or password box on the website, then choose Fill.'),
          staleParagraphCount: Array.from(document.querySelectorAll('p')).filter(node => node.textContent?.trim() === 'Click the username or password box on the website, then choose Fill.').length,
          unavailableRemedy: text.includes('Saved logins are unavailable right now.'),
          partialRemedy: text.includes('Matrx could not fully restore the login fields. Review them before signing in.'),
          signInRequired: text.includes('Sign in to Matrx'),
          actionableFill: !!(${fillButton(targetName)})
        };
      })()`);
      if (focusedFixture) evidence.fillFailure.fields = await focusedFixture.locator('body').evaluate((body, expected) => {
        const user = body.ownerDocument.querySelector('#username');
        const pass = body.ownerDocument.querySelector('#password');
        return { usernamePresent: !!user, usernameMatches: user?.value === expected.username, passwordPresent: !!pass, passwordMatches: pass?.value === expected.password };
      }, { username, password });
      throw new Error('saved_matrix_panel_fill_incomplete');
    }
  };
  const noActionableFill = async () => {
    await verifyRealVaultPanel();
    try { await realPanel.waitFor(`!(${fillButton(targetName)})`, true, 15000); } catch { throw new Error('saved_matrix_stale_fill_remained_actionable'); }
  };
  const valuesAreUntouched = async (frame) => {
    assert(await frame.locator('#username').inputValue() === '', 'saved_matrix_stale_username_changed');
    assert(await frame.locator('#password').inputValue() === '', 'saved_matrix_stale_password_changed');
    assert(await frame.locator('#unrelated').inputValue() === 'unchanged', 'saved_matrix_stale_unrelated_changed');
  };
  try {
    checkpoint('saved_matrix_username_first');
    const first = await open('username_first');
    await focusTop(first, '#username'); await stableQuiet(first.page); checkpoint('saved_matrix_username_only_fill'); await fill();
    assert(await first.page.locator('#username').inputValue() === username, 'saved_matrix_username_first_username');
    assert(await first.page.locator('#password').count() === 0, 'saved_matrix_username_first_automatic_continue');
    checkpoint('saved_matrix_explicit_continue'); await first.page.locator('#continue').click(); await focusTop(first, '#password'); await stableQuiet(first.page); checkpoint('saved_matrix_second_step_fill'); await fill();
    assert(await first.page.locator('#password').inputValue() === password, 'saved_matrix_username_first_password');
    assert(await first.page.locator('#username').inputValue() === username && await first.page.locator('#decoy').inputValue() === 'unchanged', 'saved_matrix_username_first_collateral_write');
    evidence.usernameFirstFilled = true;

    checkpoint('saved_matrix_late_spa');
    const late = await open('late_spa');
    await late.page.locator('#mount').click(); await focusTop(late, '#password'); await stableQuiet(late.page); await fill();
    assert(await late.page.locator('#username').inputValue() === username && await late.page.locator('#password').inputValue() === password, 'saved_matrix_late_spa_values');
    assert(await late.page.locator('#decoy').inputValue() === 'unchanged', 'saved_matrix_late_spa_collateral_write');
    evidence.lateSpaFilled = true;

    checkpoint('saved_matrix_same_origin_frame');
    const framed = await open('same_origin_frame');
    const sameChildUrl = `${parentOrigin}/saved-matrix/frame_login?case=${new URL(framed.pageUrl).searchParams.get('case')}`;
    await childReady(framed.tabId, sameChildUrl); evidence.childFramesReady = true;
    const sameFrame = await focusChild(framed, '#login-frame', sameChildUrl, '#password'); await stableQuiet(sameFrame); await fill();
    assert(await sameFrame.locator('#username').inputValue() === username && await sameFrame.locator('#password').inputValue() === password, 'saved_matrix_frame_values');
    assert(await framed.page.locator('#decoy').inputValue() === 'unchanged' && await sameFrame.locator('#unrelated').inputValue() === 'unchanged', 'saved_matrix_frame_unrelated_changed');
    evidence.sameOriginFrameFilled = true;

    checkpoint('saved_matrix_same_url_siblings');
    const siblings = await open('two_same_origin_frames');
    const siblingUrl = `${parentOrigin}/saved-matrix/frame_login?slot=same&case=${new URL(siblings.pageUrl).searchParams.get('case')}`;
    await childReady(siblings.tabId, siblingUrl, 2); evidence.childFramesReady = true;
    const siblingFrames = siblings.page.frames().filter((candidate) => candidate.url() === siblingUrl && candidate.parentFrame() === siblings.page.mainFrame());
    const siblingA = siblings.page.frameLocator('#frame-a');
    const siblingB = siblings.page.frameLocator('#frame-b');
    childDocuments.add(siblingA); childDocuments.add(siblingB);
    assert(siblingFrames.length === 2, 'saved_matrix_same_url_siblings_missing');
    await focusChild(siblings, '#frame-a', siblingUrl, '#password'); await panelFillAvailable();
    await siblings.page.bringToFront(); await focusOwnedBrowser(siblings.tabId);
    assert(await activeNormalWindow(siblings.tabId), 'saved_matrix_owned_normal_window_not_focused');
    await siblings.page.locator('#parent-pointer').click();
    assert(await siblings.page.evaluate(() => document.hasFocus() && window.__parentPointerClicks === 1 && window.__parentDecoyFocusCount === 0), 'saved_matrix_parent_pointer_focus_invalid');
    await stableQuiet(siblings.page); await noActionableFill();
    await Promise.all([stableQuiet(siblingA), stableQuiet(siblingB)]);
    await valuesAreUntouched(siblingA); await valuesAreUntouched(siblingB);
    assert(await siblings.page.locator('#parent-decoy').inputValue() === 'unchanged', 'saved_matrix_parent_focus_collateral_write');
    evidence.parentPointerStaleControlRemoved = true;
    await focusChild(siblings, '#frame-a', siblingUrl, '#password'); await panelFillAvailable();
    await focusChild(siblings, '#frame-b', siblingUrl, '#password'); await stableQuiet(siblingB); await fill();
    await Promise.all([stableQuiet(siblingA), stableQuiet(siblingB)]);
    await valuesAreUntouched(siblingA);
    assert(await siblingB.locator('#username').inputValue() === username && await siblingB.locator('#password').inputValue() === password && await siblingB.locator('#unrelated').inputValue() === 'unchanged', 'saved_matrix_sibling_b_fill_invalid');
    assert(await siblings.page.locator('#parent-decoy').inputValue() === 'unchanged', 'saved_matrix_sibling_parent_changed');
    evidence.sameUrlSiblingBOnlyFilled = true;

    checkpoint('saved_matrix_cross_origin_frame');
    const crossOrigin = `http://localhost:${parent.port}`;
    const crossed = await open('cross_origin_parent', crossOrigin);
    const crossChildUrl = `${parentOrigin}/saved-matrix/frame_login?slot=cross&case=${new URL(crossed.pageUrl).searchParams.get('case')}`;
    const permissionsPresent = await worker.evaluate(async ({ top, child }) => (await Promise.all([top, child].map((origin) => chrome.permissions.contains({ origins: [`${origin}/*`] })))).every(Boolean), { top: crossOrigin, child: parentOrigin });
    assert(permissionsPresent, 'saved_matrix_cross_origin_permission_missing');
    await childReady(crossed.tabId, crossChildUrl); evidence.childFramesReady = true;
    const crossFrame = await focusChild(crossed, '#cross-frame', crossChildUrl, '#password'); await stableQuiet(crossFrame); await fill();
    assert(await crossFrame.locator('#username').inputValue() === username && await crossFrame.locator('#password').inputValue() === password && await crossFrame.locator('#unrelated').inputValue() === 'unchanged', 'saved_matrix_cross_origin_values');
    assert(await crossed.page.locator('#parent-decoy').inputValue() === 'unchanged', 'saved_matrix_cross_origin_parent_changed');
    evidence.crossOriginFrameFilled = true;

    await Promise.all([...pages, ...childDocuments].map(stableQuiet));
    assert(getSubmitCount() === baseline, 'saved_matrix_submitted_website');
    evidence.quietNoOverlay = true;
    evidence.noWebsiteSubmission = true;
  } catch (error) { primaryFailure = error; } finally {
    const closed = await Promise.allSettled([...pages].map(async (page) => { if (!page.isClosed()) await page.close(); return page.isClosed() === true; }));
    evidence.pagesClosed = closed.every((row) => row.status === 'fulfilled' && row.value === true);
    if (!evidence.pagesClosed) evidence.cleanupFailure = 'owned_pages_not_closed';
    if (proof) proof.savedFormMatrix = evidence;
  }
  if (primaryFailure) throw primaryFailure;
  assert(evidence.usernameFirstFilled && evidence.lateSpaFilled && evidence.sameOriginFrameFilled && evidence.parentPointerStaleControlRemoved && evidence.sameUrlSiblingBOnlyFilled && evidence.crossOriginFrameFilled && evidence.childFramesReady && evidence.quietNoOverlay && evidence.noWebsiteSubmission && evidence.pagesClosed, 'saved_matrix_incomplete');
  return evidence;
};

exports.renderSavedFormMatrixHTML = renderSavedFormMatrixHTML;
