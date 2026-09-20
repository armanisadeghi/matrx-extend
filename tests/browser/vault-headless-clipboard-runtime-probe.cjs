'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire('/Users/armanisadeghi/code/matrx-frontend/package.json')('playwright');
const executablePath = '/Users/armanisadeghi/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const expectedVersion = '153.0.8010.12';
const assert = (condition, code) => { if (!condition) throw new Error(code); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const clipboardEqualsByDeadline = async (page, expected, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await page.evaluate(async value => (await navigator.clipboard.readText()) === value, expected)) return true;
    await wait(25);
  } while (Date.now() < deadline);
  return false;
};
const activateOwnedPage = async (page) => {
  await page.bringToFront();
  await page.locator('#focus').focus();
  return page.evaluate(() =>
    document.hasFocus() && document.visibilityState === 'visible' && document.activeElement?.id === 'focus',
  );
};
(async () => {
  assert(process.env.MATRX_HEADLESS_CLIPBOARD_PROBE === 'RUN_REVIEWED_ISOLATION_PROBE', 'probe_not_enabled');
  const root = path.resolve(__dirname, '../../.matrx/task1-active/clipboard-isolation', crypto.randomUUID());
  await fs.mkdir(root, {recursive:true, mode:0o700});
  const proof = {schema:1, scope:'native clipboard isolation between two owned headless Chrome processes', expectedVersion, credentialsRead:false, authenticationAttempted:false, hostClipboardApiCalled:false, platformIsolationBasis:"exact-runtime Chromium headless source uses ClipboardNonBacked; separately checked by process isolation", checks:{}, cleanup:{}, ok:false};
  const contexts = []; const profiles = []; const browserPids = []; const ownedPids = new Set();
  let server; let failure;
  try {
    server = http.createServer((req,res) => {res.writeHead(200, {'content-type':'text/html','cache-control':'no-store'});res.end('<!doctype html><title>Owned clipboard isolation probe</title><input id="focus">');});
    await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin = `http://127.0.0.1:${server.address().port}`;
    const pages = [];
    for (let i=0;i<2;i++) {
      const profile = path.join(root, `profile-${i}`); profiles.push(profile); await fs.mkdir(profile,{mode:0o700});
      const context = await chromium.launchPersistentContext(profile, {headless:true, executablePath, args:['--enable-automation','--no-first-run','--no-default-browser-check']}); contexts.push(context);
      const cdp = await context.browser().newBrowserCDPSession();
      const version = await cdp.send('Browser.getVersion');
      assert(version.product.endsWith('/'+expectedVersion), 'runtime_version_mismatch');
      const commandLine = await cdp.send('Browser.getBrowserCommandLine');
      assert(commandLine.arguments.some(arg => arg === '--headless' || arg === '--headless=new'), 'headless_flag_missing');
      assert(commandLine.arguments.includes('--user-data-dir='+profile), 'profile_owner_mismatch');
      const processes = await cdp.send('SystemInfo.getProcessInfo');
      const browser = processes.processInfo.filter(entry => entry.type === 'browser');
      assert(browser.length === 1 && Number.isInteger(browser[0].id), 'owned_browser_pid_missing');
      browserPids.push(browser[0].id);
      for (const entry of processes.processInfo) { assert(Number.isSafeInteger(entry.id) && entry.id > 0, 'process_id_invalid'); ownedPids.add(entry.id); }
      await cdp.detach();
      await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
      const page = context.pages()[0] || await context.newPage(); await page.goto(origin); await page.locator('#focus').focus(); pages.push(page);
    }
    assert(browserPids[0] !== browserPids[1], 'browser_processes_not_distinct');
    proof.checks.distinctOwnedHeadlessProcesses = true;
    const initial = await Promise.all(pages.map(page => page.evaluate(async () => (await navigator.clipboard.readText()) === '')));
    assert(initial.every(Boolean), 'fresh_clipboard_not_empty'); proof.checks.freshClipboardsEmpty = true;
    const canaryA = crypto.randomUUID(), canaryB = crypto.randomUUID();
    assert(await activateOwnedPage(pages[0]), 'clipboard_a_document_not_active');
    proof.checks.firstDocumentActive = true;
    await pages[0].evaluate(value => navigator.clipboard.writeText(value), canaryA);
    assert(await clipboardEqualsByDeadline(pages[0], canaryA), 'clipboard_a_roundtrip');
    assert(await activateOwnedPage(pages[1]), 'clipboard_b_document_not_active');
    proof.checks.secondDocumentActive = true;
    assert(await pages[1].evaluate(async () => (await navigator.clipboard.readText()) === ''), 'clipboard_a_leaked_to_b');
    proof.checks.firstProcessWriteIsolated = true;
    await pages[1].evaluate(value => navigator.clipboard.writeText(value), canaryB);
    assert(await clipboardEqualsByDeadline(pages[1], canaryB), 'clipboard_b_roundtrip');
    assert(await activateOwnedPage(pages[0]), 'clipboard_a_document_not_active_after_b');
    assert(await pages[0].evaluate(async value => (await navigator.clipboard.readText()) === value, canaryA), 'clipboard_b_changed_a');
    proof.checks.secondProcessWriteIsolated = true;
    for (const page of pages) {
      assert(await activateOwnedPage(page), 'clipboard_clear_document_not_active');
      await page.evaluate(() => navigator.clipboard.writeText(''));
      assert(await clipboardEqualsByDeadline(page, ''), 'owned_clipboard_not_cleared');
    }
    proof.checks.ownedClipboardsCleared = true;
  } catch(error) {failure = error.message;}
  finally {
    let processCensusComplete = true;
    for (const context of contexts) {
      try {
        const cdp = await context.browser().newBrowserCDPSession();
        const processes = await cdp.send('SystemInfo.getProcessInfo');
        for (const entry of processes.processInfo) {
          if (!Number.isSafeInteger(entry.id) || entry.id <= 0) throw new Error('process_id_invalid');
          ownedPids.add(entry.id);
        }
        await cdp.detach();
      } catch { processCensusComplete = false; }
    }
    proof.cleanup.processCensusComplete = processCensusComplete;
    proof.ownedProcessCount = ownedPids.size;
    const gone = pid => { try { process.kill(pid, 0); return false; } catch(error) { return error.code === 'ESRCH'; } };
    const closed = await Promise.allSettled(contexts.map(context => context.close()));
    proof.cleanup.contextsClosed = closed.every(result => result.status === 'fulfilled');
    for (let i=0;i<50;i++) {
      const alive = [...ownedPids].some(pid => !gone(pid));
      if (!alive) break; await wait(100);
    }
    proof.cleanup.allOwnedProcessesGone = ownedPids.size > 0 && [...ownedPids].every(gone);
    if(server) await new Promise(resolve => server.close(resolve)); proof.cleanup.serverClosed = server?.listening === false;
    await Promise.all(profiles.map(profile => fs.rm(profile,{recursive:true,force:true})));
    proof.cleanup.profilesRemoved = (await Promise.all(profiles.map(profile => fs.lstat(profile).then(()=>false,error=>error.code==='ENOENT')))).every(Boolean);
    if(failure) proof.failure = failure;
    proof.ok = !failure && Object.values(proof.checks).every(value=>value===true) && Object.values(proof.cleanup).every(value=>value===true);
    await fs.writeFile(path.join(root,'proof.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});
    process.stdout.write((proof.ok?'PASS':'FAIL')+': '+path.join(root,'proof.json')+'\n');
    if(!proof.ok)process.exitCode=1;
  }
})().catch(error => {process.stderr.write(error.message+'\n');process.exitCode=1;});
