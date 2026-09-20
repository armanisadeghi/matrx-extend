'use strict';
const crypto = require('node:crypto');

function renderSavedFormMatrixHTML(kind) {
  if (!['username_first', 'late_spa', 'same_origin_frame', 'frame_login'].includes(kind)) throw new Error('saved_matrix_kind_invalid');
  if (kind === 'username_first') return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="username" autocomplete="username"><button id="continue" type="button">Continue</button><input id="decoy" value="unchanged"><script>document.querySelector('#continue').onclick=()=>{const p=document.createElement('input');p.id='password';p.type='password';p.autocomplete='current-password';document.querySelector('form').append(p)}</script></form></main>`;
  if (kind === 'late_spa') return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="decoy" value="unchanged"><button id="mount" type="button">Continue</button><script>document.querySelector('#mount').onclick=()=>{document.querySelector('form').insertAdjacentHTML('beforeend','<input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password">')}</script></form></main>`;
  if (kind === 'frame_login') return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password"><input id="unrelated" value="unchanged"></form></main>`;
  return `<!doctype html><main><form method="post" action="/submitted" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})"><input id="decoy" value="unchanged"><iframe id="login-frame" src="/saved-matrix/frame_login"></iframe></form></main>`;
}
const fillButton = (name) => `(() => {
  const cards = Array.from(document.querySelectorAll('li')).filter((card) => card.querySelector('span')?.textContent?.trim() === ${JSON.stringify(name)});
  if (cards.length !== 1) return null;
  const buttons = Array.from(cards[0].querySelectorAll('button')).filter((button) => button.textContent?.trim() === 'Fill');
  return buttons.length === 1 ? buttons[0] : null;
})()`;
exports.runSavedFormMatrix = async ({ context, worker, realPanel, targetName, username, password, parentOrigin, getSubmitCount, assert, wait, checkpoint = () => {}, proof, focusOwnedBrowser, verifyRealVaultPanel }) => {
  assert(context && worker && realPanel && typeof parentOrigin === 'string', 'saved_matrix_context_missing');
  assert(typeof getSubmitCount === 'function' && typeof assert === 'function' && typeof wait === 'function', 'saved_matrix_controls_missing');
  const origin = new URL(parentOrigin);
  assert(origin.origin === parentOrigin && origin.hostname === '127.0.0.1' && origin.protocol === 'http:', 'saved_matrix_parent_origin_invalid');
  const evidence = { usernameFirstFilled: false, lateSpaFilled: false, sameOriginFrameFilled: false, quietNoOverlay: false, noWebsiteSubmission: false, pagesClosed: false };
  const pages = new Set(); const baseline = getSubmitCount();
  assert(Number.isInteger(baseline) && baseline >= 0, 'saved_matrix_submit_counter_invalid');
  let primaryFailure;
  const url = (kind) => `${parentOrigin}/saved-matrix/${kind}?case=${crypto.randomUUID()}`;
  const tabFor = async (expected) => { for (let i=0;i<60;i+=1) { const id=await worker.evaluate(async (u)=>(await chrome.tabs.query({})).find((t)=>t.url===u)?.id,expected); if(Number.isInteger(id)) return id; await wait(100); } throw new Error('saved_matrix_tab_missing'); };
  const fill = async () => { await verifyRealVaultPanel(); const selector=fillButton(targetName); try { await realPanel.waitFor(`!!(${selector})`,true,15000); } catch { throw new Error('saved_matrix_panel_fill_unavailable'); } await realPanel.click(selector); try { await realPanel.waitFor(`Array.from(document.querySelectorAll('p')).some((p)=>p.textContent?.trim()==='Filled. Review the form, then sign in.')`,true,15000); } catch { throw new Error('saved_matrix_panel_fill_incomplete'); } };
  const bridgeReady = async (tabId) => {
    for(let attempt=0;attempt<60;attempt+=1) {
      const ready=await worker.evaluate(async (id) => { const result=await chrome.scripting.executeScript({target:{tabId:id,frameIds:[0]},func:()=>window.__matrx_bridge_mounted===true});return result[0]?.result===true;},tabId);
      if(ready)return;await wait(100);
    }
    throw new Error('saved_matrix_top_bridge_not_ready');
  };
  const open = async (kind) => { const page=await context.newPage(); pages.add(page); const pageUrl=url(kind); await page.goto(pageUrl,{waitUntil:'domcontentloaded'}); const tabId=await tabFor(pageUrl); await bridgeReady(tabId); await page.bringToFront(); if(focusOwnedBrowser) await focusOwnedBrowser(tabId); return {page,tabId}; };
  try {
    checkpoint('saved_matrix_username_first'); const first=await open('username_first'); await first.page.locator('#username').focus(); await fill(); assert(await first.page.locator('#username').inputValue()===username,'saved_matrix_username_first_username'); assert(await first.page.locator('#password').count()===0,'saved_matrix_username_first_automatic_continue'); await first.page.locator('#continue').click(); await first.page.locator('#password').focus(); await fill(); assert(await first.page.locator('#password').inputValue()===password,'saved_matrix_username_first_password'); assert(await first.page.locator('#username').inputValue()===username && await first.page.locator('#decoy').inputValue()==='unchanged','saved_matrix_username_first_collateral_write'); evidence.usernameFirstFilled=true;
    checkpoint('saved_matrix_late_spa'); const late=await open('late_spa'); await late.page.locator('#mount').click(); await late.page.locator('#password').focus(); await fill(); assert(await late.page.locator('#username').inputValue()===username&&await late.page.locator('#password').inputValue()===password,'saved_matrix_late_spa_values'); assert(await late.page.locator('#decoy').inputValue()==='unchanged','saved_matrix_late_spa_collateral_write'); evidence.lateSpaFilled=true;
    checkpoint('saved_matrix_same_origin_frame'); const framed=await open('same_origin_frame'); const frame=framed.page.frameLocator('#login-frame'); await frame.locator('#password').focus(); await fill(); assert(await frame.locator('#username').inputValue()===username&&await frame.locator('#password').inputValue()===password,'saved_matrix_frame_values'); assert(await framed.page.locator('#decoy').inputValue()==='unchanged'&&await frame.locator('#unrelated').inputValue()==='unchanged','saved_matrix_frame_unrelated_changed'); assert(await frame.locator('#matrx-inline-login-suggestion').count()===0,'saved_matrix_frame_inline_overlay_present'); evidence.sameOriginFrameFilled=true;
    for (const page of pages) assert(await page.locator('#matrx-inline-login-suggestion').count()===0,'saved_matrix_inline_overlay_present'); assert(getSubmitCount()===baseline,'saved_matrix_submitted_website'); evidence.quietNoOverlay=true; evidence.noWebsiteSubmission=true;
  } catch(error) { primaryFailure=error; } finally { const closed=await Promise.allSettled([...pages].map(async(page)=>{if(!page.isClosed())await page.close();return page.isClosed()===true;})); evidence.pagesClosed=closed.every((row)=>row.status==='fulfilled'&&row.value===true); if(!evidence.pagesClosed)evidence.cleanupFailure='owned_pages_not_closed'; if(proof)proof.savedFormMatrix=evidence; }
  if(primaryFailure)throw primaryFailure;
  assert(evidence.usernameFirstFilled&&evidence.lateSpaFilled&&evidence.sameOriginFrameFilled&&evidence.quietNoOverlay&&evidence.noWebsiteSubmission&&evidence.pagesClosed,'saved_matrix_incomplete'); return evidence;
};
exports.renderSavedFormMatrixHTML = renderSavedFormMatrixHTML;
