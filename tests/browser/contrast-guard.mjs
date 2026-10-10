#!/usr/bin/env node
/**
 * CONTRAST GUARD — renders the built extension's chat surfaces (the legacy chat and the package
 * chat: empty state, composer, suggestion chips, buttons, and each button's HOVER state) in real
 * headless Chromium, in light AND dark, and computes the WCAG contrast of every visible text
 * element against its effective (alpha-composited) background. Fails when any is below 4.5:1
 * (3:1 for large text). Born from the 2026-10-09 regression where the extension adopted the web
 * theme (secondary = purple) while the legacy chat still painted `text-foreground` (dark) on it.
 *
 * ZERO AI spend: every POST to an AI run endpoint is aborted.
 *
 *   WXT_OUT_DIR=.output-x pnpm build && WXT_OUT_DIR=.output-x node tests/browser/contrast-guard.mjs
 *   (or CONTRAST_EXTENSION_DIR=/abs/path/to/chrome-mv3 for an arbitrary build)
 *
 * Screenshots: <build>/contrast-guard/<surface>-<scheme>[-hover].png   Exit 1 on any violation.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserRuntime } from './browser-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORKSPACE = resolve(REPO, '..');
const EXTENSION_DIR =
  process.env.CONTRAST_EXTENSION_DIR ||
  join(REPO, process.env.WXT_OUT_DIR || '.output', 'chrome-mv3');
const SHOTS = process.env.CONTRAST_SHOTS || join(dirname(EXTENSION_DIR), 'contrast-guard');
const ORGANIZATION_ID = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
const MIN_NORMAL = 4.5;
const MIN_LARGE = 3;

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const env = { ...readEnvFile(join(REPO, '.env')), ...readEnvFile(join(REPO, '.env.development')) };
const aidreamEnv = readEnvFile(join(WORKSPACE, 'aidream', '.env'));
const supabaseUrl = env.WXT_SUPABASE_URL;
const publishableKey = env.WXT_SUPABASE_PUBLISHABLE_KEY ?? env.WXT_SUPABASE_ANON_KEY;
const email = aidreamEnv.AI_ADMIN_USERNAME;
const password = aidreamEnv.AI_ADMIN_PASSWORD;
if (!supabaseUrl || !publishableKey || !email || !password) {
  console.error('REFUSED: missing WXT_SUPABASE_* or AI_ADMIN_* env');
  process.exit(1);
}
if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
  console.error(`REFUSED: no built extension at ${EXTENSION_DIR}`);
  process.exit(1);
}
const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: publishableKey },
  body: JSON.stringify({ email, password }),
});
if (!res.ok) {
  console.error(`REFUSED: sign-in ${res.status}`);
  process.exit(1);
}
const session = await res.json();
mkdirSync(SHOTS, { recursive: true });
const { chromium, executablePath } = await resolveBrowserRuntime();

/** Runs inside the page: returns violations for `root` (all text elements) or one element. */
const MEASURE = () => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const parse = (css) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#010203';
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (t, b2) => (t * top.a + b2 * bottom.a * (1 - top.a)) / a;
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const backdrop = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' && n !== el) layers.push({ image: true });
      const bg = parse(cs.backgroundColor);
      if (bg.a > 0) layers.push(bg);
      if (bg.a >= 1) break;
    }
    let acc = parse(
      getComputedStyle(document.documentElement).colorScheme === 'dark' ? '#000' : '#fff',
    );
    let sawImage = false;
    for (const l of layers.reverse()) {
      if (l.image) sawImage = true;
      else acc = over(l, acc);
    }
    return { color: acc, sawImage };
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const measure = (el) => {
    const cs = getComputedStyle(el);
    const { color: bg } = backdrop(el);
    const own = parse(cs.backgroundColor);
    const base = own.a > 0 ? over(own, backdrop(el.parentElement ?? el).color) : bg;
    const fgRaw = parse(cs.color);
    const fg = over({ ...fgRaw, a: fgRaw.a * opacityOf(el) }, base);
    const size = Number.parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    return { ratio: ratio(fg, base), need: large ? 3 : 4.5, fg, bg: base };
  };
  const hasOwnText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const hex = ({ r, g, b }) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  const describe = (el, m) => ({
    text: (el.textContent || '').trim().slice(0, 40),
    tag: el.tagName.toLowerCase(),
    cls: String(el.className?.baseVal ?? el.className).slice(0, 90),
    ratio: Number(m.ratio.toFixed(2)),
    need: m.need,
    fg: hex(m.fg),
    bg: hex(m.bg),
  });
  const holder = document.querySelector('[data-package-chat]') || document.body;
  const out = { violations: [], advisories: [], checked: 0, hoverable: [] };
  const isDisabled = (el) => !!el.closest('[disabled],[aria-disabled="true"]');
  for (const el of holder.querySelectorAll('*')) {
    if (!visible(el) || isDisabled(el)) continue;
    if (el.matches('button,a,[role=button],[role=tab],[role=menuitem]')) {
      el.setAttribute('data-cg-hover', String(out.hoverable.length));
      out.hoverable.push(el.textContent.trim().slice(0, 30) || el.getAttribute('aria-label') || '');
    }
    const ph = el.matches('input,textarea') && el.getAttribute('placeholder');
    if (!hasOwnText(el) && !ph) continue;
    out.checked++;
    const m = measure(el);
    if (ph) {
      // The placeholder paints in a UA-derived colour; measure what the UA computes.
      const phCs = getComputedStyle(el, '::placeholder');
      const fgRaw = parse(phCs.color);
      const base = backdrop(el).color;
      const fg = over(fgRaw, base);
      const pm = { ratio: ratio(fg, base), need: 4.5, fg, bg: base };
      // Advisory, not a failure: the placeholder is the @ai-matrx/chat package's own muted/60 design,
      // identical on the web (web look must not change); a package change owns that.
      if (pm.ratio < pm.need)
        out.advisories.push({ ...describe(el, pm), text: `placeholder:${ph}`.slice(0, 40) });
    }
    if (hasOwnText(el) && m.ratio < m.need) out.violations.push(describe(el, m));
  }
  out.measureOne = null;
  window.__cgMeasureOne = (idx) => {
    const el = document.querySelector(`[data-cg-hover="${idx}"]`);
    if (!el) return [];
    const bad = [];
    for (const t of [el, ...el.querySelectorAll('*')]) {
      if (!hasOwnText(t)) continue;
      const m = measure(t);
      if (m.ratio < m.need) bad.push(describe(t, m));
    }
    // An icon-only control paints its glyph with currentColor: measure that too.
    if (!hasOwnText(el) && el.querySelector('svg')) {
      const m = measure(el);
      if (m.ratio < 3)
        bad.push({
          ...describe(el, m),
          need: 3,
          text: `icon:${el.getAttribute('aria-label') || ''}`,
        });
    }
    return bad;
  };
  return out;
};

const surfaces = [
  { name: 'legacy-chat', url: 'sidepanel.html', ready: 'textarea' },
  {
    name: 'package-chat',
    url: 'sidepanel.html?chat=package',
    ready: '[data-package-chat] textarea',
  },
];
const failures = [];
const blockedPosts = [];

for (const scheme of ['light', 'dark']) {
  const context = await chromium.launchPersistentContext('', {
    executablePath,
    headless: true,
    viewport: { width: 420, height: 900 },
    colorScheme: scheme,
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });
  // AI SPEND: abort every POST to an AI run endpoint. This guard never sends.
  await context.route('**/*', (route) => {
    const req = route.request();
    if (
      req.method() === 'POST' &&
      /\/(ai|agent|agents|chat|execute|conversation)\b/.test(new URL(req.url()).pathname) &&
      !/supabase|\/auth\/|\/rest\//.test(req.url())
    ) {
      blockedPosts.push(req.url());
      return route.abort();
    }
    return route.continue();
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.evaluate(
      async ([accessToken, refreshToken, expiresIn, user, org]) => {
        const enc = new TextEncoder();
        const base = await crypto.subtle.importKey(
          'raw',
          enc.encode('matrx-extend.refresh-token.v1'),
          { name: 'PBKDF2' },
          false,
          ['deriveKey'],
        );
        const key = await crypto.subtle.deriveKey(
          {
            name: 'PBKDF2',
            salt: enc.encode(chrome.runtime.id),
            iterations: 100_000,
            hash: 'SHA-256',
          },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt'],
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(
          await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(refreshToken)),
        );
        const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
        await chrome.storage.local.set({
          'matrx.auth.accessToken': accessToken,
          'matrx.auth.refreshTokenEnc': b64(ct),
          'matrx.auth.refreshTokenIv': b64(iv),
          'matrx.auth.expiresAt': Date.now() + expiresIn * 1000,
          'matrx.user.profile': user,
          'matrx.org.active': org,
          'matrx-extend:chat-address': '/chat',
        });
      },
      [
        session.access_token,
        session.refresh_token,
        session.expires_in ?? 3600,
        session.user,
        { id: ORGANIZATION_ID, name: "Admin's Workspace" },
      ],
    );
    for (const s of surfaces) {
      await page.goto(`chrome-extension://${extensionId}/${s.url}`);
      await page
        .locator(s.ready)
        .first()
        .waitFor({ timeout: 45_000 })
        .catch(() => undefined);
      await page.waitForTimeout(2500);
      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      const label = `${s.name}/${scheme}`;
      if (isDark !== (scheme === 'dark')) {
        failures.push(
          `${label}: panel theme did not follow prefers-color-scheme (dark class=${isDark})`,
        );
      }
      const rendered = await page.locator(s.ready).count();
      if (!rendered) {
        failures.push(`${label}: surface never rendered (no ${s.ready})`);
        continue;
      }
      const report = await page.evaluate(MEASURE);
      await page.screenshot({ path: join(SHOTS, `${s.name}-${scheme}.png`) });
      if (report.checked < 3)
        failures.push(
          `${label}: only ${report.checked} text elements found (surface not rendered?)`,
        );
      for (const v of report.advisories) {
        console.log(`  advisory ${label} ${v.text} ${v.ratio}:1 (package-owned, not failing)`);
      }
      for (const v of report.violations) {
        failures.push(
          `${label} [rest] "${v.text}" <${v.tag}> ${v.ratio}:1 < ${v.need}:1 fg ${v.fg} on ${v.bg} .${v.cls}`,
        );
      }
      let hovered = 0;
      for (let i = 0; i < report.hoverable.length && hovered < 40; i++) {
        const loc = page.locator(`[data-cg-hover="${i}"]`).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.hover({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(250);
        hovered++;
        const bad = await page.evaluate((idx) => window.__cgMeasureOne(idx), i);
        for (const v of bad) {
          failures.push(
            `${label} [hover "${report.hoverable[i]}"] "${v.text}" ${v.ratio}:1 < ${v.need}:1 fg ${v.fg} on ${v.bg} .${v.cls}`,
          );
          await page.screenshot({ path: join(SHOTS, `${s.name}-${scheme}-hover-${i}.png`) });
        }
      }
      console.log(`  ${label}: ${report.checked} text elements, ${hovered} hover states checked`);
    }
  } finally {
    await context.close();
  }
}
writeFileSync(join(SHOTS, 'result.json'), JSON.stringify({ failures }, null, 2));
console.log(`  blocked AI POSTs: ${blockedPosts.length}; screenshots ${SHOTS}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} contrast violation(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(
  'PASS  every checked text element meets WCAG contrast in light and dark, at rest and on hover',
);
