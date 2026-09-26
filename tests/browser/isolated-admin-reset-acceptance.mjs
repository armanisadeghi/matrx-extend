#!/usr/bin/env node
/**
 * EXT-F-1003-T51: a signed-in admin cancels, then confirms the Settings reset
 * in an owned disposable Chrome profile. A reset that preserves extension
 * auth, skips local/session clearing, or signs out on Cancel must fail.
 * Root alone admits this browser run through the campaign resource guard.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'isolated-admin-reset-acceptance.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const EXPECTED_ADMIN = 'admin@admin.com';
const LOCAL_KEY = 'matrx.qa.adminReset.local';
const LOCAL_VALUE = 'disposable-admin-reset-local-fixture';
const SESSION_KEY = 'matrx.qa.adminReset.session';
const SESSION_VALUE = 'disposable-admin-reset-fixture';
// Per-run salt and opaque fingerprints stay in this process, never in receipts.
// Raw storage names and values never cross CDP. The browser compares canonical
// value identities, including guest identity, instead of exempting key names.
const STORAGE_SALT = randomBytes(32).toString('hex');
let storageBaseline = null;
let initialGuestBaseline = null;
let stage = 'not_started';
const evidence = {
  schema_version: 1,
  case_id: 'EXT-F-1003-T51',
  scope: 'real native Settings side panel in an owned disposable Chrome profile',
  status: 'unverified',
  login_method: 'real web form followed by extension Settings Sign in',
  response_interception: false,
  injected_auth_session: false,
  fixture: 'Dark theme through Settings and inert local/session values',
  steps: [],
};

function fail(category) {
  evidence.failure_category = category;
  throw new Error('isolated_admin_reset_unverified');
}

// Credentials are read only when the real web form is ready. They never enter
// reports, URLs, logs, browser storage fixtures, or thrown diagnostic text.
async function readAdminCredentials() {
  let source;
  try {
    source = await readFile(ADMIN_ENV, 'utf8');
  } catch (error) {
    fail(
      error?.code === 'ENOENT'
        ? 'credential_file_missing'
        : error?.code === 'EACCES'
          ? 'credential_file_denied'
          : 'credential_file_unreadable',
    );
  }
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    values[match[1]] = value;
  }
  if (values.AI_ADMIN_USERNAME !== EXPECTED_ADMIN || !values.AI_ADMIN_PASSWORD)
    fail('credential_variables_unavailable');
  return { email: values.AI_ADMIN_USERNAME, password: values.AI_ADMIN_PASSWORD };
}

async function signInOnRealWebPage(page) {
  const web = await page.context().newPage();
  try {
    stage = 'web_navigation';
    try {
      await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch {
      fail('web_navigation_failed');
    }
    stage = 'web_login_path';
    const location = new URL(web.url());
    if (location.origin !== WEB_ORIGIN || location.pathname !== '/login')
      fail('web_login_path_mismatch');
    stage = 'web_form';
    const { email, password } = await readAdminCredentials();
    try {
      await web.locator('input[name="email"]').fill(email);
      await web.locator('input[name="password"]').fill(password);
      await Promise.all([
        web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
          timeout: 90_000,
        }),
        web.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
    } catch {
      fail('real_web_login_failed');
    }
    evidence.steps.push('Real web login reached the dashboard');
    return web;
  } catch {
    await web.close();
    throw new Error('real_web_login_unverified');
  }
}

async function panelState(panel) {
  return evaluate(
    panel,
    `(() => {
    const account = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.textContent.trim() === 'Account');
    const section = account?.parentElement?.nextElementSibling;
    const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
      .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    const buttons = [...document.querySelectorAll('button')];
    const themeRow = [...document.querySelectorAll('span')]
      .find((span) => span.textContent.trim() === 'Theme');
    const dialog = [...document.querySelectorAll('[role="alertdialog"]')]
      .find((el) => el.querySelector('[data-slot="alert-dialog-title"]')
        ?.textContent.trim() === 'Clear local data?');
    return {
      settings: Boolean(document.querySelector('button[title="Settings"][data-state="active"]')),
      emailIsAdmin: row('Email') === 'Email${EXPECTED_ADMIN}',
      roleIsAdmin: row('Role')?.toLowerCase() === 'roleadmin',
      signIn: buttons.some((button) => button.textContent.trim() === 'Sign in'),
      signOut: buttons.some((button) => button.textContent.trim() === 'Sign out'),
      advanced: buttons.some((button) => button.textContent.trim() === 'Advanced agent capabilities'),
      theme: themeRow?.parentElement?.parentElement
        ?.querySelector('button[role="combobox"]')?.textContent.trim() ?? null,
      dialog: Boolean(dialog),
    };
  })()`,
  );
}

async function storageState(panel) {
  // Only opaque per-run fingerprints and aggregate observations leave Chrome.
  return evaluate(
    panel,
    `(async () => {
    const local = await chrome.storage.local.get(null);
    const session = await chrome.storage.session.get(null);
    const baseline = ${JSON.stringify(storageBaseline)};
    const initialGuest = ${JSON.stringify(initialGuestBaseline)};
    // Fixed source-declared store classes only: observations, never exemptions.
    // Source census: config/env.ts, state/*.ts, lib/audit/{log,device-key}.ts,
    // lib/{guidance,demos,lists}/storage.ts and lib/desktop/ws-invoke.ts.
    const otherStores = {
      'matrx.chat.v1': 'chat_preferences',
      'matrx.pilot-chat.v1': 'pilot_chat_preferences',
      'matrxPilotSession': 'pilot_session',
      'matrx.permission-prompts': 'permission_preferences',
      'matrx.showcase.subTab.v1': 'showcase_tab',
      'matrx.voicePrefs.v1': 'voice_preferences',
      'matrx.scrapeQueue.view.v1': 'scrape_view',
      'matrx.org.active': 'organization_selection',
      'matrx.org.picker-pending': 'organization_picker',
      'matrx.audit.deviceKey': 'audit_device',
      'matrx.audit.publicKeyHistory': 'audit_history',
      'matrx.audit.log': 'audit_log',
      'matrx.audit.failedCount': 'audit_failures',
      'matrx.backend.env': 'backend_selection',
      'matrx.backend.urlOverride': 'backend_override',
      'matrx.desktop.pairToken': 'desktop_pairing',
      'matrx.credentials.captureNeverOrigins': 'credential_preferences',
      'matrx.capture.pickup': 'capture_pickup',
      'matrx.guidance.list': 'guidance_index',
      'matrx.demos.list': 'demo_index',
      'matrx.lists.plans': 'list_plans',
      'matrx.lists.user_todos': 'list_todos',
      'matrx.debug.verboseConsole': 'debug_console',
      'matrx.debug.bridgeTraffic.enabled': 'debug_bridge',
      'matrx.desktop.lastCapabilities': 'desktop_capabilities',
      'matrx.sources.unsaved': 'unsaved_sources',
      'matrx.domain_memos': 'domain_memos',
      'matrx.context.shape': 'context_preference',
      'matrx.recordings.v1': 'recordings',
      'matrxLocalEnginePortOverride': 'discovery_override',
      'matrx.admin-flags.v1': 'admin_flags',
      ${JSON.stringify(LOCAL_KEY)}: 'local_fixture',
      ${JSON.stringify(SESSION_KEY)}: 'session_fixture',
    };
    const canonical = (value) => JSON.stringify(value, (_, entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
        : entry);
    const fingerprint = async (value) => {
      const bytes = new TextEncoder().encode(${JSON.stringify(STORAGE_SALT)} + canonical(value));
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    const category = (area, key) => {
      if (area === 'session') return key === 'matrx.crossComponent.instanceId' ? 'instance' : 'other';
      if (['matrx.guest.signature', 'matrx.guest.nonce', 'matrx.guest.createdAt'].includes(key)) return 'guest';
      if (key === 'matrxLocalEnginePort') return 'discovery_cache';
      if (key === 'matrxLocalEngineLastGoodPort') return 'discovery_port';
      if (key.startsWith('matrx.auth.') || key.startsWith('matrx.user.')) return 'account';
      if (key === 'matrx.settings.v1') return 'settings';
      return 'other';
    };
    const describe = async (area, values) => Promise.all(Object.entries(values).map(async ([key, value]) => ({
      key: await fingerprint([area, key]), value: await fingerprint([area, key, value]),
      category: category(area, key),
      sourceClass: Object.hasOwn(otherStores, key) ? otherStores[key] : 'unclassified',
      shape: value === null ? 'null_value' : value === false ? 'false_value' : value === true ? 'true_value'
        : Array.isArray(value) ? (value.length === 0 ? 'empty_array' : 'array')
        : typeof value === 'object' ? (Object.keys(value).length === 0 ? 'empty_object' : 'object')
        : typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' : 'other',
      // A discovery port may be the same again. The cache must have a changed
      // value; neither user overrides nor pairing credentials are exempt.
      validDiscoveryPort: key === 'matrxLocalEngineLastGoodPort' && Number.isInteger(value) && value > 0 && value <= 65535,
    })));
    const identities = { local: await describe('local', local), session: await describe('session', session) };
    const compare = (area) => {
      const result = { overlap: 0, identical: 0, changed: 0, missing: 0, unexplained: 0,
        fresh_guest: 0, stale_guest: 0, fresh_instance: 0, stale_instance: 0,
        fresh_discovery_cache: 0, stale_discovery_cache: 0, rediscovered_port: 0,
        account_overlap: 0, settings_overlap: 0, other_overlap: 0, other_identical: 0, other_changed: 0 };
      result.other_sources = Object.fromEntries([...Object.values(otherStores), 'unclassified'].map((name) =>
        [name, { overlap: 0, identical: 0, changed: 0, matches_initial_guest: 0, absent_initial_guest: 0 }]));
      result.other_shapes = Object.fromEntries(['null_value', 'false_value', 'true_value', 'empty_array', 'array', 'empty_object', 'object', 'string', 'number', 'other'].map((name) => [name, 0]));
      for (const prior of baseline?.[area] ?? []) {
        const current = identities[area].find((entry) => entry.key === prior.key);
        if (!current) { result.missing++; continue; }
        result.overlap++;
        const same = current.value === prior.value;
        result[same ? 'identical' : 'changed']++;
        const kind = current.category;
        if (kind === 'guest' || kind === 'instance' || kind === 'discovery_cache') {
          result[(same ? 'stale_' : 'fresh_') + kind]++;
          if (same) result.unexplained++;
        } else if (kind === 'discovery_port' && current.validDiscoveryPort) {
          result.rediscovered_port++;
        } else {
          result[(kind === 'account' || kind === 'settings' ? kind : 'other') + '_overlap']++;
          if (kind !== 'account' && kind !== 'settings') {
            result[same ? 'other_identical' : 'other_changed']++;
            const group = result.other_sources[current.sourceClass];
            group.overlap++;
            group[same ? 'identical' : 'changed']++;
            const guest = initialGuest?.[area]?.find((entry) => entry.key === current.key);
            if (!guest) group.absent_initial_guest++;
            else if (guest.value === current.value) group.matches_initial_guest++;
            result.other_shapes[current.shape]++;
          }
          result.unexplained++;
        }
      }
      result.other_sources = Object.fromEntries(Object.entries(result.other_sources).filter(([, counts]) => counts.overlap > 0));
      result.other_shapes = Object.fromEntries(Object.entries(result.other_shapes).filter(([, count]) => count > 0));
      return result;
    };
    let theme = null;
    if (typeof local['matrx.settings.v1'] === 'string') {
      try { theme = JSON.parse(local['matrx.settings.v1']).state?.theme ?? null; } catch {}
    }
    return {
      theme,
      hasSettings: Object.hasOwn(local, 'matrx.settings.v1'),
      hasAccessToken: Object.hasOwn(local, 'matrx.auth.accessToken'),
      hasUserProfile: Object.hasOwn(local, 'matrx.user.profile'),
      hasAdminFlag: local['matrx.user.isAdmin'] === true,
      localFixtureMatches: local[${JSON.stringify(LOCAL_KEY)}] === ${JSON.stringify(LOCAL_VALUE)},
      hasLocalFixture: Object.hasOwn(local, ${JSON.stringify(LOCAL_KEY)}),
      sessionFixtureMatches: session[${JSON.stringify(SESSION_KEY)}] === ${JSON.stringify(SESSION_VALUE)},
      hasSessionFixture: Object.hasOwn(session, ${JSON.stringify(SESSION_KEY)}),
      localKeys: identities.local.map((entry) => entry.key).sort(),
      sessionKeys: identities.session.map((entry) => entry.key).sort(),
      identities: baseline ? undefined : identities,
      valueComparison: { local: compare('local'), session: compare('session') },
    };
  })()`,
  );
}

function isAdmin(state) {
  return (
    state?.emailIsAdmin && state.roleIsAdmin && state.signOut && state.advanced && !state.signIn
  );
}

// Keep a failed native click diagnosable without recording browser exceptions,
// page text, storage values, auth URLs, or credentials in the durable receipt.
function browserFailureCategory(error) {
  const message = String(error?.message ?? '');
  return message.startsWith('unique visible ')
    ? 'target_count'
    : message.startsWith('stable hit target for ')
      ? 'unstable_or_blocked_hit'
      : message.startsWith('pointer_sample_failed for ')
        ? 'pointer_sample_failed'
        : message === 'panel_runtime_exception'
          ? 'panel_runtime_exception'
          : message.includes('Target closed') || message.includes('Session closed')
            ? 'cdp_target_or_session_closed'
            : message.includes('context was destroyed')
              ? 'execution_context_destroyed'
              : message.includes('_not_observed:')
                ? 'condition_not_observed'
                : 'browser_operation_failed';
}

async function nativeActionDiagnostic(panel, error, kind, label) {
  const category = browserFailureCategory(error);
  try {
    const state = await evaluate(
      panel,
      `(() => {
      const kind = ${JSON.stringify(kind)}, label = ${JSON.stringify(label)};
      const rawTargets = [...document.querySelectorAll(
        kind === 'title' ? 'button[title]' : kind === 'section' ? 'button[aria-expanded]' : 'button'
      )].filter((button) => kind === 'title'
        ? button.title === label : button.textContent.trim() === label);
      const targets = rawTargets.filter((button) => {
        const style = getComputedStyle(button), rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
          style.display !== 'none' && !button.closest('[inert]');
      });
      const target = targets[0];
      const rect = target?.getBoundingClientRect();
      const x = rect ? rect.x + rect.width / 2 : null;
      const y = rect ? rect.y + rect.height / 2 : null;
      const hit = rect ? document.elementFromPoint(x, y) : null;
      const dialogs = [...document.querySelectorAll('[role="alertdialog"]')];
      const section = [...document.querySelectorAll('button[aria-expanded]')]
        .find((button) => button.textContent.trim() === 'Data & reset');
      return {
        target_count: targets.length,
        raw_target_count: rawTargets.length,
        target_has_layout: Boolean(rect && rect.width > 0 && rect.height > 0),
        target_in_viewport: Boolean(rect && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight),
        target_hit: Boolean(target && hit && (hit === target || target.contains(hit))),
        hit_is_dialog: Boolean(hit?.closest('[role="alertdialog"]')),
        raw_target_in_inert_tree: rawTargets.some((button) => Boolean(button.closest('[inert]'))),
        target_animating: Boolean(target?.getAnimations({ subtree: true })
          .some((animation) => animation.playState === 'running')),
        dialog_count: dialogs.length,
        dialog_animating: dialogs.some((dialog) => dialog.getAnimations({ subtree: true })
          .some((animation) => animation.playState === 'running')),
        section_expanded: section?.getAttribute('aria-expanded') === 'true',
        body_pointer_events_none: getComputedStyle(document.body).pointerEvents === 'none',
        body_scroll_locked: document.body.hasAttribute('data-scroll-locked'),
      };
    })()`,
    );
    return {
      category,
      ...state,
      ...(error?.pointerDiagnostic ? { pointer: error.pointerDiagnostic } : {}),
    };
  } catch {
    return { category, snapshot_available: false };
  }
}

// Failure-only evidence on the already attached native Settings target. Never
// attach to the login tab; never serialize node text, arbitrary attrs or values.
async function resetOcclusionDiagnostic(panel) {
  try {
    const snapshot = await evaluate(
      panel,
      `(() => {
      const activeSettings = document.querySelector('button[title="Settings"][data-state="active"]');
      const target = [...document.querySelectorAll('button')].find((el) =>
        el.textContent.trim() === 'Clear local data on this device' &&
        el.getBoundingClientRect().width > 0 && !el.closest('[inert]'));
      const settings = target?.closest('[role="tabpanel"]');
      const visible = (el) => { const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      const safeSurface = location.protocol === 'chrome-extension:' &&
        location.pathname === '/sidepanel.html' && Boolean(activeSettings && settings) &&
        ![...document.querySelectorAll('form, input[type="password"], iframe')].some(visible);
      if (!safeSurface) return { surface_verified: false };
      const rect = (el) => { const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const ids = new Map();
      const fixed = (value, allowed) => allowed.includes(value) ? value : value == null ? null : 'other';
      const describe = (el) => {
        if (!el) return null;
        if (!ids.has(el)) ids.set(el, ids.size + 1);
        const style = getComputedStyle(el);
        return { node: ids.get(el),
          tag: fixed(el.localName, ['html','body','div','span','button','svg','path','input','section','header','main','nav','p','a']),
          role: fixed(el.getAttribute('role'), ['tabpanel','tablist','tab','dialog','alertdialog','button','listbox','option','presentation','none']),
          // These slots are already source-declared selectors in this runner/driver.
          slot: fixed(el.getAttribute('data-slot'), ['alert-dialog-title','alert-dialog-overlay','dialog-overlay']),
          state: fixed(el.getAttribute('data-state'), ['active','inactive','open','closed']),
          aria_hidden: fixed(el.getAttribute('aria-hidden'), ['true','false']),
          inert: el.hasAttribute('inert'), hidden: el.hasAttribute('hidden'),
          is_target: el === target, contains_target: el.contains(target),
          within_settings: settings.contains(el), rect: rect(el),
          pointer_events: fixed(style.pointerEvents, ['auto','none']),
          position: fixed(style.position, ['static','relative','absolute','fixed','sticky']),
          z_index: style.zIndex === 'auto' ? 'auto' : Number.isFinite(Number(style.zIndex)) ? Number(style.zIndex) : 'other',
          opacity: Number(style.opacity),
          visibility: fixed(style.visibility, ['visible','hidden','collapse']),
          overflow_x: fixed(style.overflowX, ['visible','hidden','clip','scroll','auto']),
          overflow_y: fixed(style.overflowY, ['visible','hidden','clip','scroll','auto']),
          scroll_top: el.scrollTop, scroll_left: el.scrollLeft,
          client_width: el.clientWidth, client_height: el.clientHeight,
          transformed: style.transform !== 'none' };
      };
      const chain = (el) => { const result = [];
        for (; el; el = el.parentElement) result.push(describe(el)); return result; };
      const r = target.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const box = settings.getBoundingClientRect();
      const left = Math.max(0, box.left), top = Math.max(0, box.top);
      const width = Math.max(0, Math.min(innerWidth, box.right) - left);
      const height = Math.max(0, Math.min(innerHeight, box.bottom) - top);
      return { surface_verified: true, target_chain: chain(target), hit_chain: chain(hit),
        center_stack: document.elementsFromPoint(x, y).map(describe),
        point: { x, y }, viewport: { width: innerWidth, height: innerHeight },
        screenshot_clip: width > 0 && height > 0 ? { x: left + scrollX, y: top + scrollY, width, height, scale: 1 } : null };
    })()`,
    );
    if (!snapshot?.surface_verified || !snapshot.screenshot_clip)
      return { ...snapshot, screenshot_status: 'surface_refused' };
    try {
      const { data } = await panel.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: snapshot.screenshot_clip,
      });
      if (typeof data !== 'string' || data.length < 100) throw new Error('png_missing');
      const filename = 'isolated-admin-reset-occlusion.png';
      await writeFile(join(REPO, 'test-results', filename), Buffer.from(data, 'base64'), {
        mode: 0o600,
      });
      return {
        ...snapshot,
        screenshot_status: 'captured',
        screenshot_path: 'test-results/' + filename,
      };
    } catch {
      return { ...snapshot, screenshot_status: 'capture_failed' };
    }
  } catch {
    return { snapshot_available: false, screenshot_status: 'surface_unavailable' };
  }
}

async function panelLifecycleDiagnostic(panel) {
  const state = { target_info_available: false, runtime_read_available: false };
  try {
    const result = await panel.send('Target.getTargetInfo');
    state.target_info_available = true;
    state.target_type_page = result?.targetInfo?.type === 'page';
  } catch {
    /* A detached target is itself diagnostic. */
  }
  try {
    const result = await panel.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    state.runtime_read_available = !result.exceptionDetails;
    const ready = result.result?.value;
    state.document_ready_state = ['loading', 'interactive', 'complete'].includes(ready)
      ? ready
      : 'other';
  } catch {
    /* The fixed availability flag is enough. */
  }
  return state;
}

async function observedReloadPanelState(panel) {
  evidence.reset_reload.panel_state_read_attempts += 1;
  try {
    const observed = await panelState(panel);
    evidence.reset_reload.panel_state_read_successes += 1;
    evidence.reset_reload.last_panel = {
      settings_visible: observed.settings,
      sign_in_visible: observed.signIn,
      sign_out_visible: observed.signOut,
      advanced_visible: observed.advanced,
      admin_email_visible: observed.emailIsAdmin,
      theme_is_system: observed.theme === 'System',
    };
    return observed;
  } catch (error) {
    evidence.reset_reload.last_read_failure_category = browserFailureCategory(error);
    throw error;
  }
}

try {
  stage = 'release_receipt';
  const receipt = JSON.parse(await readFile(join(REPO, '.output', 'release-receipt.json'), 'utf8'));
  evidence.build = {
    version: receipt.version,
    source_sha: receipt.sourceSha,
    tree_sha256: receipt.treeSha256,
  };
  stage = 'owned_profile';
  const result = await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      stage = 'guest_settings';
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      const guest = await panelState(panel);
      assert.equal(guest.signIn && !guest.signOut && !guest.advanced, true);

      // Capture the untouched owned profile's guest values before real login.
      // This is diagnostic provenance, not permission to restore the same data.
      const initialGuestStorage = await storageState(panel);
      assert.ok(
        Array.isArray(initialGuestStorage.identities?.local) &&
          Array.isArray(initialGuestStorage.identities?.session),
      );
      initialGuestBaseline = initialGuestStorage.identities;
      evidence.initial_guest_storage = {
        local_count: initialGuestStorage.localKeys.length,
        session_count: initialGuestStorage.sessionKeys.length,
        auth_present:
          initialGuestStorage.hasAccessToken ||
          initialGuestStorage.hasUserProfile ||
          initialGuestStorage.hasAdminFlag,
      };
      const web = await signInOnRealWebPage(page);
      try {
        stage = 'extension_signin';
        await click(panel, 'button', 'Sign in');
        await waitFor('admin_settings_after_real_signin', () => panelState(panel), isAdmin, 90_000);
        await openSection(panel, 'Appearance');
        await click(panel, 'theme', 'Theme');
        await click(panel, 'option', 'Dark');
        await waitFor(
          'dark_theme_visible',
          () => panelState(panel),
          (s) => s?.theme === 'Dark',
        );
        await waitFor(
          'dark_theme_persisted',
          () => storageState(panel),
          (s) => s?.theme === 'dark',
        );
        await evaluate(
          panel,
          `(async () => {
        await chrome.storage.local.set({ [${JSON.stringify(LOCAL_KEY)}]: ${JSON.stringify(LOCAL_VALUE)} });
        await chrome.storage.session.set({ [${JSON.stringify(SESSION_KEY)}]: ${JSON.stringify(SESSION_VALUE)} });
      })()`,
        );
        stage = 'admin_fixture_ready';
        const before = await waitFor(
          'admin_storage_ready',
          () => storageState(panel),
          (s) =>
            s?.hasAccessToken &&
            s.hasUserProfile &&
            s.hasAdminFlag &&
            s.hasSettings &&
            s.theme === 'dark' &&
            s.localFixtureMatches &&
            s.sessionFixtureMatches,
        );
        assert.ok(
          Array.isArray(before.identities?.local) && Array.isArray(before.identities?.session),
          'Storage identity baseline must be available',
        );
        storageBaseline = before.identities;
        evidence.steps.push(
          'Real admin identity, Dark preference, and disposable local/session fixtures observed',
        );

        stage = 'reset_cancel';
        await openSection(panel, 'Data & reset');
        await click(panel, 'button', 'Clear local data on this device');
        await waitFor(
          'admin_reset_dialog',
          () => panelState(panel),
          (s) => s?.dialog,
        );
        await click(panel, 'dialog', 'Cancel');
        await waitFor(
          'admin_cancel_closed_dialog',
          () => panelState(panel),
          (s) => !s?.dialog,
        );
        assert.equal(
          isAdmin(await panelState(panel)),
          true,
          'Cancel must preserve signed-in admin',
        );
        const afterCancel = await storageState(panel);
        evidence.reset_cancel = {
          prior_value_comparison: afterCancel.valueComparison,
        };
        for (const area of ['local', 'session']) {
          assert.equal(
            afterCancel.valueComparison[area].changed,
            0,
            `Cancel must preserve every preexisting ${area} value`,
          );
          assert.equal(
            afterCancel.valueComparison[area].missing,
            0,
            `Cancel must preserve every preexisting ${area} key`,
          );
        }
        assert.equal(
          afterCancel.hasAccessToken &&
            afterCancel.hasUserProfile &&
            afterCancel.hasAdminFlag &&
            afterCancel.theme === 'dark' &&
            afterCancel.localFixtureMatches &&
            afterCancel.sessionFixtureMatches,
          true,
          'Cancel must preserve auth and fixture values',
        );
        assert.deepEqual(
          before.localKeys.filter((key) => !afterCancel.localKeys.includes(key)),
          [],
          'Cancel must not remove any preexisting local key',
        );
        assert.deepEqual(
          before.sessionKeys.filter((key) => !afterCancel.sessionKeys.includes(key)),
          [],
          'Cancel must not remove any preexisting session key',
        );
        evidence.steps.push(
          'Cancel preserved admin UI, auth, preference, fixtures, and every prior storage key/value',
        );

        evidence.reset_confirm = {
          dialog_reopened: false,
          confirm_click_completed: false,
          storage_read_attempts: 0,
          storage_read_successes: 0,
        };
        stage = 'reset_confirm_open_action';
        try {
          evidence.reset_confirm.open_pointer = await click(
            panel,
            'button',
            'Clear local data on this device',
          );
        } catch (error) {
          evidence.reset_confirm.open_click_diagnostic = await nativeActionDiagnostic(
            panel,
            error,
            'button',
            'Clear local data on this device',
          );
          evidence.reset_confirm.occlusion = await resetOcclusionDiagnostic(panel);
          throw error;
        }
        stage = 'reset_confirm_dialog_wait';
        await waitFor(
          'admin_reset_dialog_reopened',
          () => panelState(panel),
          (s) => s?.dialog,
        );
        evidence.reset_confirm.dialog_reopened = true;
        stage = 'reset_confirm_click';
        await click(panel, 'dialog', 'Clear & sign out');
        evidence.reset_confirm.confirm_click_completed = true;
        stage = 'reset_confirm_storage_wait';
        await waitFor(
          'admin_extension_storage_cleared',
          async () => {
            evidence.reset_confirm.storage_read_attempts += 1;
            const observed = await storageState(panel);
            evidence.reset_confirm.storage_read_successes += 1;
            evidence.reset_confirm.last_storage = {
              local_count: observed.localKeys.length,
              session_count: observed.sessionKeys.length,
              prior_local_overlap_count: before.localKeys.filter((key) =>
                observed.localKeys.includes(key),
              ).length,
              prior_session_overlap_count: before.sessionKeys.filter((key) =>
                observed.sessionKeys.includes(key),
              ).length,
              auth_present:
                observed.hasAccessToken || observed.hasUserProfile || observed.hasAdminFlag,
              settings_present: observed.hasSettings,
              local_fixture_present: observed.hasLocalFixture,
              session_fixture_present: observed.hasSessionFixture,
            };
            return observed;
          },
          (s) =>
            !s?.hasSettings &&
            !s.hasAccessToken &&
            !s.hasUserProfile &&
            !s.hasAdminFlag &&
            !s.hasLocalFixture &&
            !s.hasSessionFixture,
        );
        stage = 'reset_confirm_storage_snapshot';
        const after = await storageState(panel);
        evidence.reset_confirm.last_storage = {
          local_count: after.localKeys.length,
          session_count: after.sessionKeys.length,
          prior_local_overlap_count: before.localKeys.filter((key) => after.localKeys.includes(key))
            .length,
          prior_session_overlap_count: before.sessionKeys.filter((key) =>
            after.sessionKeys.includes(key),
          ).length,
          auth_present: after.hasAccessToken || after.hasUserProfile || after.hasAdminFlag,
          settings_present: after.hasSettings,
          local_fixture_present: after.hasLocalFixture,
          session_fixture_present: after.hasSessionFixture,
        };
        stage = 'reset_confirm_prior_key_check';
        assert.deepEqual(
          before.localKeys.filter((key) => after.localKeys.includes(key)),
          [],
          'Confirm must clear every preexisting local key',
        );
        assert.deepEqual(
          before.sessionKeys.filter((key) => after.sessionKeys.includes(key)),
          [],
          'Confirm must clear every preexisting session key',
        );
        stage = 'reset_confirm_signout_wait';
        await waitFor(
          'admin_signed_out',
          async () => {
            const observed = await panelState(panel);
            evidence.reset_confirm.last_panel = {
              sign_in_visible: observed.signIn,
              sign_out_visible: observed.signOut,
              advanced_visible: observed.advanced,
              admin_email_visible: observed.emailIsAdmin,
              admin_role_visible: observed.roleIsAdmin,
            };
            return observed;
          },
          (s) => s?.signIn && !s.signOut && !s.advanced && !s.emailIsAdmin && !s.roleIsAdmin,
        );
        evidence.steps.push(
          'Confirm removed prior extension local/session keys and signed out in Settings',
        );

        evidence.reset_reload = {
          command_completed: false,
          panel_state_read_attempts: 0,
          panel_state_read_successes: 0,
        };
        stage = 'reset_reload_command';
        try {
          await panel.send('Page.reload', { ignoreCache: true });
          evidence.reset_reload.command_completed = true;
        } catch (error) {
          evidence.reset_reload.failure_category = browserFailureCategory(error);
          evidence.reset_reload.lifecycle = await panelLifecycleDiagnostic(panel);
          throw error;
        }
        stage = 'reset_reload_guest_wait';
        await waitFor(
          'guest_after_reload',
          () => observedReloadPanelState(panel),
          (s) => s?.signIn && !s.signOut,
        );
        stage = 'reset_reload_settings_click';
        try {
          await click(panel, 'title', 'Settings');
        } catch (error) {
          evidence.reset_reload.action_diagnostic = await nativeActionDiagnostic(
            panel,
            error,
            'title',
            'Settings',
          );
          throw error;
        }
        stage = 'reset_reload_account_section';
        try {
          await openSection(panel, 'Account');
        } catch (error) {
          evidence.reset_reload.action_diagnostic = await nativeActionDiagnostic(
            panel,
            error,
            'section',
            'Account',
          );
          throw error;
        }
        stage = 'reset_reload_appearance_section';
        try {
          await openSection(panel, 'Appearance');
        } catch (error) {
          evidence.reset_reload.action_diagnostic = await nativeActionDiagnostic(
            panel,
            error,
            'section',
            'Appearance',
          );
          throw error;
        }
        stage = 'reset_reload_defaults_wait';
        await waitFor(
          'guest_defaults_after_reload',
          () => observedReloadPanelState(panel),
          (s) =>
            s?.settings &&
            s.signIn &&
            !s.signOut &&
            !s.advanced &&
            !s.emailIsAdmin &&
            s.theme === 'System',
        );
        stage = 'reset_reload_storage_read';
        const reloaded = await storageState(panel);
        evidence.reset_reload.storage_read_completed = true;
        evidence.reset_reload.storage_snapshot = {
          auth_present: reloaded.hasAccessToken || reloaded.hasUserProfile || reloaded.hasAdminFlag,
          settings_present: reloaded.hasSettings,
          prior_value_comparison: reloaded.valueComparison,
          local_fixture_present: reloaded.hasLocalFixture,
          session_fixture_present: reloaded.hasSessionFixture,
          prior_local_overlap_count: before.localKeys.filter((key) =>
            reloaded.localKeys.includes(key),
          ).length,
          prior_session_overlap_count: before.sessionKeys.filter((key) =>
            reloaded.sessionKeys.includes(key),
          ).length,
        };
        stage = 'reset_reload_storage_assert';
        assert.equal(
          reloaded.hasAccessToken ||
            reloaded.hasUserProfile ||
            reloaded.hasAdminFlag ||
            reloaded.hasSettings ||
            reloaded.hasLocalFixture ||
            reloaded.hasSessionFixture,
          false,
        );
        assert.equal(
          reloaded.valueComparison.local.unexplained,
          0,
          'Reload must not restore prior account/settings/data or reuse guest identity',
        );
        assert.equal(
          reloaded.valueComparison.session.unexplained,
          0,
          'Reload must not restore prior session values or reuse component identity',
        );
        evidence.steps.push(
          'Panel reload remained guest with System theme; returning keys passed browser-side value identity checks',
        );
      } catch (error) {
        if (stage.startsWith('reset_reload')) {
          evidence.reset_reload.failure_category ??= browserFailureCategory(error);
          evidence.reset_reload.lifecycle ??= await panelLifecycleDiagnostic(panel);
        }
        throw error;
      } finally {
        await web.close();
      }
    },
  });
  assert.equal(result.verified, true);
  evidence.build.extension_id = result.extensionId;
  evidence.status = 'pass';
  stage = 'complete';
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write('PASS isolated_admin_reset_real_ui\n');
} catch {
  // Raw browser/auth exceptions may contain callback URLs, tokens, or entered
  // form values. Only a fixed stage/category can leave this process.
  evidence.status = 'unverified';
  evidence.failure_stage = stage;
  evidence.failure_category ??= 'stage_operation_failed';
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write(`UNVERIFIED isolated_admin_reset at ${stage}\n`);
  process.exitCode = 1;
}
