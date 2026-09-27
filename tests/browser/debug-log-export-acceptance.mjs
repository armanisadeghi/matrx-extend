#!/usr/bin/env node
/** Owned-profile, natural-event Debug export and verbosity observations. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO, 'test-results', `debug-log-export-${randomUUID()}.json`);
const EXTENSION_DIR = join(REPO, '.output', 'chrome-mv3-dev');
const RECEIPT = join(REPO, '.output', 'release-receipt.json');
const DEV_BUILD_RECEIPT = process.env.DEBUG_DEV_BUILD_RECEIPT;
const MANIFEST = join(EXTENSION_DIR, 'manifest.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const ADMIN_EMAIL = 'admin@admin.com';
const WEB_ORIGIN = 'https://www.aimatrx.com';
const PUBLIC_PAGES = ['https://example.com/', 'https://www.iana.org/domains/reserved'];
let stage = 'build_start';
const report = {
  schema_version: 1,
  feature: 'EXT-F-1005',
  scope: 'admin natural-event Copy all, Download .log, and verbose-console setting',
  status: 'unverified',
  cases: [],
};

function fail(code) {
  report.failure = { stage, code };
  throw new Error('debug_log_export_unverified');
}

async function buildIdentity() {
  if (DEV_BUILD_RECEIPT !== undefined) {
    if (!DEV_BUILD_RECEIPT) fail('development_receipt_missing');
    const [receipt, manifest, pkg] = await Promise.all([
      readFile(DEV_BUILD_RECEIPT, 'utf8').then(JSON.parse),
      readFile(MANIFEST, 'utf8').then(JSON.parse),
      readFile(join(REPO, 'package.json'), 'utf8').then(JSON.parse),
    ]);
    requireLocalDevReceipt(receipt, EXTENSION_DIR);
    if (
      !manifest.key ||
      manifest.version !== pkg.version ||
      manifest.version !== receipt.version ||
      hashReleaseTree(EXTENSION_DIR) !== receipt.treeSha256
    )
      fail('development_build_mismatch');
    return {
      kind: receipt.kind,
      publishState: receipt.publish_state,
      version: receipt.version,
      treeSha256: receipt.treeSha256,
    };
  }
  const [receipt, manifest] = await Promise.all([
    readFile(RECEIPT, 'utf8').then(JSON.parse),
    readFile(MANIFEST, 'utf8').then(JSON.parse),
  ]);
  if (receipt.version !== manifest.version || !/^[a-f0-9]{64}$/.test(receipt.treeSha256 ?? ''))
    fail('release_manifest_mismatch');
  return { version: manifest.version, treeSha256: receipt.treeSha256 };
}

async function adminIdentity(panel) {
  return evaluate(
    panel,
    `(() => {
      const account=[...document.querySelectorAll('button[aria-expanded]')]
        .find(button=>button.textContent.trim()==='Account');
      const section=account?.parentElement?.nextElementSibling;
      const row=label=>[...(section?.querySelectorAll('span')??[])]
        .find(span=>span.textContent.trim()===label)?.parentElement?.textContent.trim()??null;
      return {email:row('Email')==='Email${ADMIN_EMAIL}',
        role:row('Role')?.toLowerCase()==='roleadmin',
        signOut:[...document.querySelectorAll('button')]
          .some(button=>button.textContent.trim()==='Sign out')};
    })()`,
  );
}

async function signIn(page, panel) {
  stage = 'real_admin_signin';
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Account');
  const web = await page.context().newPage();
  try {
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const route = new URL(web.url());
    if (route.origin !== WEB_ORIGIN || route.pathname !== '/login') fail('login_route_unverified');
    const variables = {};
    for (const line of (await readFile(ADMIN_ENV, 'utf8')).split(/\r?\n/)) {
      const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (!found) continue;
      let value = found[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      variables[found[1]] = value;
    }
    if (variables.AI_ADMIN_USERNAME !== ADMIN_EMAIL || !variables.AI_ADMIN_PASSWORD)
      fail('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(ADMIN_EMAIL);
    await web.locator('input[name="password"]').fill(variables.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await click(panel, 'button', 'Sign in');
    await waitFor(
      'admin_identity',
      () => adminIdentity(panel),
      (value) => value?.email && value.role && value.signOut,
      90_000,
    );
  } finally {
    await web.close();
  }
}

async function logView(panel) {
  return evaluate(
    panel,
    `(() => {
      const search=document.querySelector('input[placeholder="Search…"]');
      const view=search?.closest('div.flex.h-full.flex-col');
      const list=view?.lastElementChild;
      const rows=[...(list?.children??[])].filter(row=>row.firstElementChild?.matches('button'));
      const count=/^([0-9]+)[/]([0-9]+)$/.exec(search?.nextElementSibling?.textContent.trim()??'');
      return {present:!!search,searchEmpty:search?.value==='',
        visible:rows.length,filtered:count?Number(count[1]):null,
        total:count?Number(count[2]):null,
        paused:!!document.querySelector('button[title="Resume"]')};
    })()`,
  );
}

async function visibleRowSequence(panel) {
  return evaluate(
    panel,
    `(() => {
      const search=document.querySelector('input[placeholder="Search…"]');
      const list=search?.closest('div.flex.h-full.flex-col')?.lastElementChild;
      return [...(list?.children??[])].map(row=>row.firstElementChild)
        .filter(button=>button?.matches('button'))
        .map(button=>JSON.stringify({className:button.className,
          fields:[...button.children].map(child=>child.textContent),
          detail:button.parentElement?.querySelector('pre')?.textContent??null}));
    })()`,
  );
}

async function setSearch(panel, value) {
  const point = await evaluate(
    panel,
    `(() => {
      const input=document.querySelector('input[placeholder="Search…"]');
      input?.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const rect=input?.getBoundingClientRect();
      const x=rect?rect.x+rect.width/2:null,y=rect?rect.y+rect.height/2:null;
      const hit=rect?document.elementFromPoint(x,y):null;
      return {unique:document.querySelectorAll('input[placeholder="Search…"]').length===1,
        x,y,hit:!!input&&(hit===input||input.contains(hit)),
        area:!!rect&&rect.width>0&&rect.height>0};
    })()`,
  );
  if (!point?.unique || !point.hit || !point.area) fail('search_target_unavailable');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
    commands: ['selectAll'],
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
  });
  const selected = await evaluate(
    panel,
    `(() => {
      const input=document.querySelector('input[placeholder="Search…"]');
      return !!input&&document.activeElement===input&&input.selectionStart===0&&
        input.selectionEnd===input.value.length;
    })()`,
  );
  if (!selected) fail('search_selection_unverified');
  if (value) await panel.send('Input.insertText', { text: value });
  else {
    await panel.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
  }
  await waitFor(
    'trusted_search_value',
    () =>
      evaluate(
        panel,
        `(() => document.querySelector('input[placeholder="Search…"]')?.value===${JSON.stringify(value)})()`,
      ),
    (same) => same === true,
  );
}

async function naturalCandidateMessages(panel) {
  return evaluate(
    panel,
    `(() => {
      const search=document.querySelector('input[placeholder="Search…"]');
      const list=search?.closest('div.flex.h-full.flex-col')?.lastElementChild;
      return [...(list?.children??[])].map(row=>row.firstElementChild)
        .filter(button=>button?.matches('button')&&!button.firstElementChild?.querySelector('svg'))
        .map(button=>button.lastElementChild?.textContent??'')
        .filter(Boolean).slice(0,8);
    })()`,
  );
}

// The oracle is built from rendered, filtered rows, independent of Debug's
// formatter and store. Only a no-detail subset is accepted so hidden JSON
// cannot be silently omitted from the expected export.
async function renderedFilteredExport(panel) {
  return evaluate(
    panel,
    `(() => {
      const search=document.querySelector('input[placeholder="Search…"]');
      const list=search?.closest('div.flex.h-full.flex-col')?.lastElementChild;
      const buttons=[...(list?.children??[])].map(row=>row.firstElementChild)
        .filter(button=>button?.matches('button'));
      const noDetail=buttons.every(button=>!button.firstElementChild?.querySelector('svg'));
      const lines=buttons.map(button=>{
        const fields=[...button.children];
        const level=button.className.includes('text-red-600')?'error':
          button.className.includes('text-amber-600')?'warn':
          button.className.includes('text-emerald-600')?'success':'info';
        const tag=fields.length===6?' <'+fields[4].textContent+'>':'';
        return fields[1].textContent+' ['+fields[2].textContent+'/'+
          fields[3].textContent+'/'+level+']'+tag+' '+fields.at(-1).textContent;
      });
      return {count:buttons.length,noDetail,expected:lines.reverse().join('\\n')};
    })()`,
  );
}

async function selectNaturalFilteredSubset(panel, total) {
  for (const message of await naturalCandidateMessages(panel)) {
    await setSearch(panel, message);
    const sample = await renderedFilteredExport(panel);
    const state = await logView(panel);
    if (
      sample.count > 0 &&
      sample.count < total &&
      sample.noDetail &&
      state.filtered === sample.count &&
      state.total === total
    )
      return sample;
  }
  await setSearch(panel, '');
  return null;
}

async function readClipboard(panel) {
  return evaluate(panel, 'navigator.clipboard.readText()');
}

async function downloadFile(artifacts) {
  let priorSize = null;
  let stableSamples = 0;
  return waitFor(
    'owned_debug_download',
    async () => {
      const allNames = await readdir(artifacts);
      const names = allNames.filter((name) => /^matrx-extend-debug-[0-9TZ-]+\.log$/.test(name));
      if (names.length !== 1 || allNames.some((name) => name.endsWith('.crdownload')))
        return { count: names.length, ready: false };
      const path = join(artifacts, names[0]);
      const info = await stat(path);
      if (!info.isFile() || info.size <= 0) return { count: 1, ready: false };
      stableSamples = priorSize === info.size ? stableSamples + 1 : 0;
      priorSize = info.size;
      if (stableSamples < 2) return { count: 1, ready: false };
      await chmod(path, 0o600);
      return { count: 1, ready: true, path, size: info.size };
    },
    (item) => item.ready,
    15_000,
  );
}

async function verboseState(panel) {
  return evaluate(
    panel,
    `(async () => {
      const enabled=(await chrome.storage.local.get('matrx.debug.verboseConsole'))
        ['matrx.debug.verboseConsole']===true;
      const off=document.querySelectorAll(
        'button[title="DevTools console: warnings + errors only (click for everything)"]').length;
      const on=document.querySelectorAll(
        'button[title="DevTools console: everything (click for warnings + errors only)"]').length;
      return {enabled,off,on};
    })()`,
  );
}

async function exercise({ page, panel, artifacts }) {
  let priorClipboard;
  let exportedClipboard;
  let originalVerbose;
  let toggledVerbose = false;
  try {
    await signIn(page, panel);
    stage = 'debug_open';
    await click(panel, 'title', 'Debug (admin only)');
    await waitFor(
      'debug_log_ready',
      () => logView(panel),
      (state) => state?.present,
    );
    stage = 'natural_events';
    for (const url of PUBLIC_PAGES) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.locator('body').click({ position: { x: 5, y: 5 } });
    }
    const unfiltered = await waitFor(
      'natural_debug_rows',
      () => logView(panel),
      (state) => state?.visible > 0 && state.visible === state.filtered && state.total > 0,
      15_000,
    );
    stage = 'freeze_natural_feed';
    await click(panel, 'title', 'Pause');
    const frozen = await waitFor(
      'frozen_debug_rows',
      () => logView(panel),
      (state) =>
        state?.paused &&
        state.visible > 0 &&
        state.visible === state.filtered &&
        state.total === state.visible &&
        state.total >= unfiltered.total,
    );
    stage = 'filtered_export_oracle';
    const subset = await selectNaturalFilteredSubset(panel, frozen.total);
    if (!subset) {
      report.cases.push({
        id: 'EXT-F-1005-T16',
        status: 'unverified',
        evidence: { reason: 'no_natural_nonempty_proper_no_detail_filtered_subset' },
      });
    } else {
      const exportEvidence = {
        naturalRowCount: frozen.total,
        filteredRowCount: subset.count,
        chronologicalOrderChecked: true,
        clipboardExact: false,
        copyFeedback: false,
        downloadExact: false,
      };
      stage = 'clipboard_snapshot';
      try {
        priorClipboard = await readClipboard(panel);
      } catch {
        exportEvidence.clipboardUnavailable = true;
      }
      if (typeof priorClipboard === 'string') {
        stage = 'copy_filtered_rows';
        await click(panel, 'title', 'Copy all');
        exportedClipboard = subset.expected;
        const copied = await waitFor(
          'actual_clipboard_and_feedback',
          async () => ({
            same: (await readClipboard(panel)) === subset.expected,
            feedback: await evaluate(
              panel,
              `!!document.querySelector('button[title="Copy all"] svg.text-emerald-500')`,
            ),
          }),
          (value) => value.same && value.feedback,
        );
        exportEvidence.clipboardExact = copied.same;
        exportEvidence.copyFeedback = copied.feedback;
      }
      stage = 'download_filtered_rows';
      await panel.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: artifacts,
      });
      await click(panel, 'title', 'Download .log');
      const downloaded = await downloadFile(artifacts);
      exportEvidence.downloadExact = (await readFile(downloaded.path, 'utf8')) === subset.expected;
      exportEvidence.downloadBytes = downloaded.size;
      report.cases.push({
        id: 'EXT-F-1005-T16',
        status: !exportEvidence.downloadExact
          ? 'fail'
          : exportEvidence.clipboardExact && exportEvidence.copyFeedback
            ? 'partial'
            : 'unverified',
        evidence: exportEvidence,
      });
    }

    stage = 'verbose_before';
    const beforeVerbose = await verboseState(panel);
    if (beforeVerbose.off + beforeVerbose.on !== 1) fail('verbose_control_not_unique');
    originalVerbose = beforeVerbose.enabled;
    if ((originalVerbose ? beforeVerbose.on : beforeVerbose.off) !== 1)
      fail('verbose_ui_storage_disagree');
    const beforeToggleRows = await logView(panel);
    const beforeToggleSequence = await visibleRowSequence(panel);
    stage = 'verbose_toggle';
    await click(
      panel,
      'title',
      originalVerbose
        ? 'DevTools console: everything (click for warnings + errors only)'
        : 'DevTools console: warnings + errors only (click for everything)',
    );
    toggledVerbose = true;
    await waitFor(
      'verbose_persisted',
      () => verboseState(panel),
      (value) =>
        value?.enabled === !originalVerbose && (originalVerbose ? value.off : value.on) === 1,
    );
    const afterToggleRows = await logView(panel);
    const feedUnchanged =
      afterToggleRows.visible === beforeToggleRows.visible &&
      afterToggleRows.total === beforeToggleRows.total &&
      JSON.stringify(await visibleRowSequence(panel)) === JSON.stringify(beforeToggleSequence);
    stage = 'verbose_real_reload';
    const loaderBefore = (await panel.send('Page.getFrameTree'))?.frameTree?.frame?.loaderId;
    if (!loaderBefore) fail('panel_loader_missing');
    await panel.send('Page.reload', { ignoreCache: false });
    await waitFor(
      'new_panel_document',
      async () => (await panel.send('Page.getFrameTree'))?.frameTree?.frame?.loaderId,
      (loader) => Boolean(loader && loader !== loaderBefore),
      30_000,
    );
    await waitFor(
      'settings_after_reload',
      () => evaluate(panel, `!!document.querySelector('button[title="Settings"]')`),
      (value) => value === true,
      30_000,
    );
    await click(panel, 'title', 'Settings');
    await openSection(panel, 'Account');
    await waitFor(
      'admin_after_reload',
      () => adminIdentity(panel),
      (value) => value?.email && value.role && value.signOut,
      30_000,
    );
    await click(panel, 'title', 'Debug (admin only)');
    const reloadedVerbose = await waitFor(
      'verbose_after_reload',
      () => verboseState(panel),
      (value) =>
        value?.enabled === !originalVerbose && (originalVerbose ? value.off : value.on) === 1,
      30_000,
    );
    report.cases.push({
      id: 'EXT-F-1005-T18',
      status: feedUnchanged ? 'partial' : 'unverified',
      evidence: {
        realAdmin: true,
        persistedAfterRealReload: reloadedVerbose.enabled === !originalVerbose,
        visibleFeedSequenceUnchangedWhilePaused: feedUnchanged,
        consoleMirroring: 'unverified_no_natural_level_matched_console_control',
      },
    });
    report.status = report.cases.some((item) => item.status === 'fail')
      ? 'fail'
      : report.cases.some((item) => item.status === 'partial')
        ? 'partial'
        : 'unverified';
  } finally {
    if (toggledVerbose && typeof originalVerbose === 'boolean') {
      try {
        const current = await verboseState(panel);
        if (current.enabled !== originalVerbose) {
          await click(
            panel,
            'title',
            current.enabled
              ? 'DevTools console: everything (click for warnings + errors only)'
              : 'DevTools console: warnings + errors only (click for everything)',
          );
        }
        report.verboseRestored = (await verboseState(panel)).enabled === originalVerbose;
      } catch {
        report.verboseRestored = false;
      }
    }
    if (typeof priorClipboard === 'string' && typeof exportedClipboard === 'string') {
      try {
        const current = await readClipboard(panel);
        if (current === exportedClipboard) {
          await evaluate(panel, `navigator.clipboard.writeText(${JSON.stringify(priorClipboard)})`);
          report.clipboardRestored = (await readClipboard(panel)) === priorClipboard;
        } else if (current === priorClipboard) {
          report.clipboardRestored = true;
        } else {
          report.clipboardRestored = false;
          report.clipboardChangedByAnotherActor = true;
        }
      } catch {
        report.clipboardRestored = false;
      }
    }
    if (
      report.status !== 'fail' &&
      (report.verboseRestored === false || report.clipboardRestored === false)
    )
      report.status = 'unverified';
  }
}

try {
  const before = await buildIdentity();
  report.build = { ...before, before, after: null };
  stage = 'owned_native_profile';
  const run = await runNativeSidepanelQa({
    headed: true,
    ...(DEV_BUILD_RECEIPT !== undefined && {
      extensionDir: EXTENSION_DIR,
      expectedRelease: before,
      localDevReceiptPath: DEV_BUILD_RECEIPT,
    }),
    exercisePanel: exercise,
  });
  assert.equal(run.verified, true);
  stage = 'build_end';
  const after = await buildIdentity();
  if (
    after.version !== before.version ||
    after.treeSha256 !== before.treeSha256 ||
    hashReleaseTree(EXTENSION_DIR) !== before.treeSha256
  )
    fail('build_changed_during_run');
  report.build.after = { ...after, extensionId: run.extensionId };
  report.build.artifactTreeMatchedAfter = true;
  report.profileOwned = true;
} catch {
  report.status = 'unverified';
  report.failure ??= { stage, code: 'owned_harness_or_ui_stage_failed' };
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} debug_log_export_acceptance\n`);
if (report.status === 'unverified' || report.status === 'fail') process.exitCode = 1;
