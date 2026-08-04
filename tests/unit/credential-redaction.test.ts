/**
 * Redaction hardening — the fix for gap 9 of
 * /Users/armanisadeghi/code/common-docs/projects/credential-sharing-browser-login/PLAN.md.
 *
 * Before this change every page-reading tool keyed redaction on the LIVE
 * `type === 'password'` property, so:
 *   (a) a filled USERNAME (type="text") was echoed to the model verbatim, and
 *   (b) a site toggling "show password" to type="text" un-redacted the
 *       password itself.
 *
 * Redaction is now the OR of marker attribute, the extension's own
 * filled-field memory, and the legacy password check. This suite proves each
 * signal works ALONE, so no single one of them can be defeated — including by
 * a page that strips our attribute or rewrites the input type.
 *
 * It also greps the redaction sites, because the injected page code is an
 * opaque string to `tsc` and Biome: a new page-reading tool that forgets to
 * thread the selectors through is a silent leak nothing else can see.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SENSITIVE_ATTR,
  _resetSensitiveFieldMemory,
  forgetSensitiveFields,
  rememberSensitiveFields,
  sensitiveSelectorsForTab,
} from '@/lib/credentials/sensitive-fields';
import { get_form_fields } from '@/lib/tools/handlers/forms';
import {
  get_element_at_point,
  get_element_details,
  inspect_element,
} from '@/lib/tools/handlers/inspect';
import { read_page } from '@/lib/tools/handlers/page-refs';
import { query_elements } from '@/lib/tools/handlers/read';
import type { ToolContext } from '@/lib/tools/types';
import { beforeEach, describe, expect, it } from 'vitest';

const SECRET = 'ZZREDACTIONSENTINELZZ';
const PUBLIC_VALUE = 'ordinary-search-term';
const TAB_ID = 99;

const ctx: ToolContext = {
  conversationId: null,
  runId: 'r',
  callId: 'c',
  agentName: null,
  permissionMode: 'act',
  assignedTabId: TAB_ID,
};

function installChrome(): void {
  const existing = (globalThis as unknown as { chrome?: Record<string, unknown> }).chrome ?? {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    ...existing,
    scripting: {
      executeScript: async ({
        func,
        args,
      }: { func: (...a: never[]) => unknown; args?: unknown[] }) => [
        { result: await (func as (...a: unknown[]) => unknown)(...(args ?? [])) },
      ],
    },
    tabs: {
      get: async (id: number) => ({ id, url: 'https://accounts.example.com/login' }),
      query: async () => [{ id: TAB_ID, url: 'https://accounts.example.com/login' }],
      onUpdated: { addListener: () => undefined },
      onRemoved: { addListener: () => undefined },
    },
    runtime: { getManifest: () => ({ version: '0.0.0-test' }) },
  };
}

function render(): void {
  document.body.innerHTML = `
    <form id="f" method="post">
      <input id="secretfield" name="secretfield" type="text" />
      <input id="searchbox" name="searchbox" type="text" />
    </form>
  `;
  for (const el of Array.from(document.querySelectorAll('input, form'))) {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ width: 120, height: 24, x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 24 }) as DOMRect;
  }
  (document.getElementById('secretfield') as HTMLInputElement).value = SECRET;
  (document.getElementById('searchbox') as HTMLInputElement).value = PUBLIC_VALUE;
}

/** Run every redaction site and return one searchable blob. */
async function readEverything(): Promise<string> {
  const results: unknown[] = [];
  results.push(await read_page.run(read_page.argsSchema.parse({}), ctx));
  results.push(await get_form_fields.run(get_form_fields.argsSchema.parse({}), ctx));
  results.push(
    await query_elements.run(query_elements.argsSchema.parse({ selector: 'input' }), ctx),
  );
  results.push(
    await inspect_element.run(inspect_element.argsSchema.parse({ selector: '#secretfield' }), ctx),
  );
  results.push(
    await get_element_at_point.run(get_element_at_point.argsSchema.parse({ x: 1, y: 1 }), ctx),
  );
  const ref = document.getElementById('secretfield')?.getAttribute('data-matrx-ref');
  if (ref) {
    results.push(
      await get_element_details.run(
        get_element_details.argsSchema.parse({ ref, include_html: true, include_styles: false }),
        ctx,
      ),
    );
  }
  const formRef = document.getElementById('f')?.getAttribute('data-matrx-ref');
  if (formRef) {
    results.push(
      await get_element_details.run(
        get_element_details.argsSchema.parse({
          ref: formRef,
          include_html: true,
          include_styles: false,
        }),
        ctx,
      ),
    );
  }
  return JSON.stringify(results);
}

describe('page-read redaction — each signal defends on its own', () => {
  beforeEach(() => {
    _resetSensitiveFieldMemory();
    installChrome();
    render();
  });

  it('is not vacuous — an ordinary field IS returned when nothing marks it', async () => {
    const blob = await readEverything();
    expect(blob).toContain(PUBLIC_VALUE);
    // …and with no signal at all, the "secret" field is returned too. This is
    // the control: every masking assertion below is meaningful only because
    // this one shows the value would otherwise come through.
    expect(blob).toContain(SECRET);
  });

  it('redacts on the marker attribute ALONE (no memory, type="text")', async () => {
    document.getElementById('secretfield')?.setAttribute(SENSITIVE_ATTR, '');
    const blob = await readEverything();
    expect(blob).not.toContain(SECRET);
    expect(blob).toContain(PUBLIC_VALUE);
  });

  it('redacts on filled-field MEMORY alone — a page stripping the marker cannot un-redact', async () => {
    rememberSensitiveFields(TAB_ID, ['#secretfield']);
    // The page rips our attribute out (it never had it here) and keeps the
    // field as a plain text input. Memory is the only signal left.
    expect(document.getElementById('secretfield')?.hasAttribute(SENSITIVE_ATTR)).toBe(false);
    const blob = await readEverything();
    expect(blob).not.toContain(SECRET);
    expect(blob).toContain(PUBLIC_VALUE);
  });

  it('survives the "show password" type toggle', async () => {
    const el = document.getElementById('secretfield') as HTMLInputElement;
    el.setAttribute('type', 'password');
    rememberSensitiveFields(TAB_ID, ['#secretfield']);
    // The site's show-password control flips the input back to text AND the
    // page strips our marker. Both DOM-side defences are gone.
    el.setAttribute('type', 'text');
    el.removeAttribute(SENSITIVE_ATTR);
    const blob = await readEverything();
    expect(blob).not.toContain(SECRET);
  });

  it('still redacts a plain password input with no marker and no memory (legacy path intact)', async () => {
    const el = document.getElementById('secretfield') as HTMLInputElement;
    el.setAttribute('type', 'password');
    const blob = await readEverything();
    expect(blob).not.toContain(SECRET);
  });
});

describe('sensitive-field memory', () => {
  beforeEach(() => {
    _resetSensitiveFieldMemory();
  });

  it('is per tab and never bleeds across tabs', () => {
    rememberSensitiveFields(1, ['#a']);
    expect(sensitiveSelectorsForTab(1)).toEqual(['#a']);
    expect(sensitiveSelectorsForTab(2)).toEqual([]);
    expect(sensitiveSelectorsForTab(null)).toEqual([]);
  });

  it('de-duplicates and is bounded', () => {
    rememberSensitiveFields(1, ['#a', '#a', '  ', '#b']);
    expect(sensitiveSelectorsForTab(1)).toEqual(['#a', '#b']);
    rememberSensitiveFields(
      1,
      Array.from({ length: 40 }, (_, i) => `#f${i}`),
    );
    expect(sensitiveSelectorsForTab(1).length).toBeLessThanOrEqual(16);
  });

  it('forgets on request', () => {
    rememberSensitiveFields(1, ['#a']);
    forgetSensitiveFields(1);
    expect(sensitiveSelectorsForTab(1)).toEqual([]);
  });
});

describe('redaction site coverage (grep guard)', () => {
  // The injected page code is an opaque string to tsc and Biome. If someone
  // adds a page-reading tool or rewrites one of these injections without
  // threading the selectors through, only a grep can catch it.
  const SITES = [
    'src/lib/tools/handlers/page-refs.ts',
    'src/lib/tools/handlers/forms.ts',
    'src/lib/tools/handlers/read.ts',
    'src/lib/tools/handlers/inspect.ts',
  ];

  for (const site of SITES) {
    it(`${site} threads the sensitive-field selectors into its injected code`, () => {
      const src = readFileSync(join(process.cwd(), site), 'utf8');
      expect(src, `${site} must import the shared redaction contract`).toContain(
        "from '@/lib/credentials/sensitive-fields'",
      );
      expect(src, `${site} must pass the SW-held selectors into the page`).toContain(
        'sensitiveSelectorsForTab(',
      );
      expect(src, `${site} must check the marker attribute`).toContain('sensitiveAttr');
      expect(src, `${site} must match against the SW-held selector set`).toContain('sensitiveEls');
    });
  }
});
