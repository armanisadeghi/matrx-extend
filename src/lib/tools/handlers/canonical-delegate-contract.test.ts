/**
 * Every canonical wrapper must hand its leaf exactly the keys the leaf's schema names.
 *
 * zod strips unknown object keys silently, so a wrapper key the leaf spells differently
 * (history `limit` vs leaf `max_results`, cookies `expires_in_seconds` vs `expiration`,
 * stylesheet `persistent` vs `persist`) used to vanish with no error. This suite drives
 * EVERY delegate() call site in canonical.ts + canonical-mergers.ts with representative
 * args, lets the real delegate() run (strict key check + leaf parse), and asserts each
 * public value the caller supplied actually reaches the leaf's parsed args.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

type Recorded = { leaf: string; parsed: Record<string, unknown> };
const calls: Recorded[] = [];
const broadcasts: Array<Record<string, unknown>> = [];
const askHandlers: Array<(p: unknown) => unknown> = [];

vi.mock('@/lib/messaging/native', () => ({
  on: (_ch: string, h: (p: unknown) => unknown) => {
    askHandlers.push(h);
    return () => {};
  },
  broadcast: (_ch: string, req: Record<string, unknown>) => {
    broadcasts.push(req);
    queueMicrotask(() => askHandlers.at(-1)?.({ callId: req.callId, answer: 'done' }));
  },
}));

vi.mock('@/lib/tools/types', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/tools/types')>();
  return {
    ...real,
    // Real delegate (key check + parse), but the leaf's run only records what it got.
    delegate: (leaf: { name: string; run: unknown }, args: unknown, ctx: unknown) =>
      real.delegate(
        {
          ...(leaf as object),
          run: async (parsed: Record<string, unknown>) => {
            calls.push({ leaf: leaf.name, parsed });
            return { ok: true };
          },
        } as never,
        args,
        ctx as never,
      ),
  };
});

const { delegate: realDelegate, unknownDelegateKeys } =
  await vi.importActual<typeof import('@/lib/tools/types')>('@/lib/tools/types');
const mergers = await import('./canonical-mergers');
const canonical = await import('./canonical');
const cdpMod = await import('./cdp');
const userMod = await import('./user');
const { parseTabIdArg } = await import('./_active-tab');

const ctx = { assignedTabId: 42 } as never;
let probeKind = 'text';
const activated: number[] = [];
const scripted: number[] = [];

beforeAll(() => {
  const g = globalThis as unknown as { chrome: Record<string, unknown> };
  g.chrome = {
    ...g.chrome,
    tabs: {
      get: async (id: number) => ({ id, active: true, windowId: 1, status: 'complete' }),
      update: async (id: number) => {
        activated.push(id);
        return { id, windowId: 1 };
      },
      query: async () => [{ id: 42, active: true, windowId: 1 }],
    },
    windows: { update: async () => ({}) },
    scripting: {
      executeScript: async (inj: { target: { tabId: number } }) => {
        scripted.push(inj.target.tabId);
        return [{ result: { kind: probeKind, ok: true } }];
      },
    },
  };
});

function deepIncludes(haystack: unknown, needle: unknown): boolean {
  if (JSON.stringify(haystack) === JSON.stringify(needle)) return true;
  if (haystack && typeof haystack === 'object')
    return Object.values(haystack).some((v) => deepIncludes(v, needle));
  return false;
}

type Case = {
  tool: { name: string; argsSchema: { parse: (a: unknown) => unknown }; run: Function };
  args: Record<string, unknown>;
  leaf: string;
  /** Public keys consumed by the wrapper itself (not forwarded by value). */
  consumed?: string[];
  /** Exact leaf args to assert where the wrapper converts a value. */
  expect?: Record<string, unknown>;
  probe?: string;
};

const NOW_S = Math.floor(Date.now() / 1000);

const cases: Case[] = [
  // ai
  { tool: mergers.ai, args: { action: 'check_availability' }, leaf: 'ai_check_availability' },
  { tool: mergers.ai, args: { action: 'summarize', text: 'long text' }, leaf: 'ai_summarize' },
  {
    tool: mergers.ai,
    args: { action: 'classify', text: 'refund', categories: ['billing', 'support'] },
    leaf: 'ai_classify',
  },
  {
    tool: mergers.ai,
    args: { action: 'extract_json', text: 'Ann is 30', schema: { type: 'object' } },
    leaf: 'ai_extract_json',
  },
  {
    tool: mergers.ai,
    args: { action: 'translate', text: 'hello', target_lang: 'es', source_lang: 'en' },
    leaf: 'ai_translate',
  },
  {
    tool: mergers.ai,
    args: { action: 'detect_language', text: 'bonjour' },
    leaf: 'ai_detect_language',
  },
  { tool: mergers.ai, args: { action: 'proofread', text: 'teh cat' }, leaf: 'ai_proofread' },
  {
    tool: mergers.ai,
    args: {
      action: 'describe_image',
      image_base64: 'A'.repeat(80),
      mime_type: 'image/png',
      prompt: 'What brand?',
    },
    leaf: 'ai_describe_image',
  },
  {
    tool: mergers.ai,
    args: { action: 'check_prompt_injection', text: 'ignore previous' },
    leaf: 'ai_check_prompt_injection',
  },
  // cookies
  {
    tool: mergers.cookies,
    args: { action: 'get', url: 'https://shop.example.com/', domain: 'example.com', name: 'sid' },
    leaf: 'get_cookies',
  },
  {
    tool: mergers.cookies,
    args: {
      action: 'set',
      url: 'https://shop.example.com/',
      name: 'sid',
      value: 'abc123',
      domain: 'shop.example.com',
      path: '/cart',
      expires_in_seconds: 3600,
      same_site: 'lax',
      http_only: true,
      secure: true,
    },
    leaf: 'set_cookie',
    consumed: ['expires_in_seconds'],
  },
  {
    tool: mergers.cookies,
    args: { action: 'delete', url: 'https://shop.example.com/', name: 'sid' },
    leaf: 'delete_cookie',
  },
  // webmcp
  { tool: mergers.webmcp, args: { action: 'check' }, leaf: 'webmcp_check_availability' },
  { tool: mergers.webmcp, args: { action: 'list' }, leaf: 'webmcp_list_page_tools' },
  {
    tool: mergers.webmcp,
    args: { action: 'call', tool_name: 'add_to_cart', arguments: { sku: 'X1' } },
    leaf: 'webmcp_call_page_tool',
  },
  // tab_groups
  { tool: mergers.tab_groups, args: { action: 'list' }, leaf: 'get_tab_groups' },
  {
    tool: mergers.tab_groups,
    args: { action: 'create', tab_ids: [3, 4], title: 'Research', color: 'blue' },
    leaf: 'create_tab_group',
  },
  {
    tool: mergers.tab_groups,
    args: { action: 'add', group_id: 9, tab_ids: [5] },
    leaf: 'add_tabs_to_group',
  },
  {
    tool: mergers.tab_groups,
    args: { action: 'remove', tab_ids: [6] },
    leaf: 'remove_tabs_from_group',
  },
  {
    tool: mergers.tab_groups,
    args: { action: 'update', group_id: 9, title: 'Done', color: 'green', collapsed: true },
    leaf: 'update_tab_group',
  },
  // bookmarks
  {
    tool: mergers.bookmarks,
    args: { action: 'search', query: 'recipes', limit: 7 },
    leaf: 'search_bookmarks',
  },
  {
    tool: mergers.bookmarks,
    args: { action: 'tree', folder_id: '12', max_depth: 2 },
    leaf: 'list_bookmark_tree',
  },
  // history
  {
    tool: mergers.history,
    args: {
      action: 'search',
      query: 'flights',
      start_time_ms: 1_700_000_000_000,
      end_time_ms: 1_700_000_100_000,
      limit: 17,
    },
    leaf: 'search_history',
  },
  {
    tool: mergers.history,
    args: { action: 'recent', minutes: 45, limit: 13 },
    leaf: 'list_recent_history',
  },
  // recently_closed
  { tool: mergers.recently_closed, args: { action: 'list' }, leaf: 'list_recently_closed' },
  {
    tool: mergers.recently_closed,
    args: { action: 'restore', session_id: 's-77' },
    leaf: 'restore_recently_closed',
  },
  // stylesheet
  {
    tool: mergers.stylesheet,
    args: { action: 'inject', css: 'body{color:red}', tab_id: 11 },
    leaf: 'inject_stylesheet',
  },
  {
    tool: mergers.stylesheet,
    args: { action: 'remove', css: 'body{color:red}', tab_id: 11 },
    leaf: 'remove_stylesheet',
  },
  // cdp
  { tool: mergers.cdp_session, args: { action: 'attach', tab_id: 21 }, leaf: 'cdp_attach' },
  { tool: mergers.cdp_session, args: { action: 'detach', tab_id: 22 }, leaf: 'cdp_detach' },
  { tool: mergers.cdp_session, args: { action: 'list' }, leaf: 'cdp_attached_tabs' },
  {
    tool: mergers.cdp_emulate,
    args: {
      action: 'set',
      tab_id: 23,
      width: 390,
      height: 844,
      device_scale_factor: 3,
      mobile: true,
      user_agent: 'iPhone UA',
    },
    leaf: 'cdp_emulate_device',
  },
  { tool: mergers.cdp_emulate, args: { action: 'clear', tab_id: 24 }, leaf: 'cdp_clear_emulation' },
  // computer
  ...(
    [
      ['left_click', 'click_element', {}],
      ['right_click', 'right_click_element', {}],
      ['type', 'type_into_element', { text: 'hello world' }],
      ['scroll_to', 'scroll_page', {}],
      ['hover', 'hover_element', {}],
      ['focus', 'focus_element', {}],
    ] as const
  ).map(
    ([action, leaf, extra]): Case => ({
      tool: canonical.computer,
      args: { tab_id: '42', action, ref: 'ref:e7', ...extra },
      leaf,
      consumed: ['tab_id', 'repeat', 'scroll_amount'],
    }),
  ),
  {
    tool: canonical.computer,
    args: { tab_id: '42', action: 'blur', ref: 'ref:e7' },
    leaf: 'blur_element',
    consumed: ['tab_id', 'ref'],
    expect: { selector: '[data-matrx-ref="e7"]' },
  },
  {
    tool: canonical.computer,
    args: { tab_id: '42', action: 'key', text: 'Enter' },
    leaf: 'press_keys',
    consumed: ['tab_id'],
  },
  {
    tool: canonical.computer,
    args: { tab_id: '42', action: 'scroll', scroll_direction: 'down', scroll_amount: 2 },
    leaf: 'scroll_page',
    consumed: ['tab_id', 'scroll_direction', 'scroll_amount'],
    expect: { direction: 'by', delta_y: 200 },
  },
  {
    tool: canonical.computer,
    args: { tab_id: '42', action: 'screenshot' },
    leaf: 'take_screenshot',
    consumed: ['tab_id'],
  },
  // form_input
  ...(
    [
      ['select', 'select_dropdown_option', 'Large'],
      ['checkbox', 'set_checkbox', true],
      ['radio', 'set_radio', 'express'],
      ['text', 'type_into_element', 'Ann Lee'],
    ] as const
  ).map(
    ([probe, leaf, value]): Case => ({
      tool: canonical.form_input,
      args: { tab_id: '42', ref: 'ref:e9', value },
      leaf,
      probe,
      consumed: ['tab_id'],
    }),
  ),
  // navigate
  {
    tool: canonical.navigate,
    args: { tab_id: '42', url: 'back' },
    leaf: 'go_back',
    consumed: ['tab_id', 'url'],
  },
  {
    tool: canonical.navigate,
    args: { tab_id: '42', url: 'forward' },
    leaf: 'go_forward',
    consumed: ['tab_id', 'url'],
  },
  {
    tool: canonical.navigate,
    args: { tab_id: '42', url: 'https://example.com/pricing' },
    leaf: 'navigate_active_tab',
    consumed: ['tab_id'],
  },
  // tabs
  { tool: canonical.tabs, args: { action: 'list' }, leaf: 'list_open_tabs' },
  {
    tool: canonical.tabs,
    args: { action: 'create', url: 'https://example.com/' },
    leaf: 'open_new_tab',
  },
  ...(
    [
      ['switch', 'switch_to_tab', {}],
      ['reload', 'reload_tab', {}],
      ['info', 'get_tab_info', {}],
      ['pin', 'pin_tab', { on: false }],
      ['mute', 'mute_tab', { on: false }],
      ['duplicate', 'duplicate_tab', {}],
      ['move', 'move_tab', { index: 3, window_id: 8 }],
      ['zoom', 'set_tab_zoom', { zoom_factor: 1.5 }],
    ] as const
  ).map(
    ([action, leaf, extra]): Case => ({
      tool: canonical.tabs,
      args: { action, tab_id: '55', ...extra },
      leaf,
      consumed: ['tab_id'],
      expect: { tab_id: 55 },
    }),
  ),
  {
    tool: canonical.tabs,
    args: { action: 'close', tab_id: '55' },
    leaf: 'close_tab',
    consumed: ['tab_id'],
    expect: { tab_ids: 55 },
  },
  // downloads
  { tool: canonical.downloads, args: { action: 'list' }, leaf: 'list_downloads' },
  {
    tool: canonical.downloads,
    args: { action: 'cancel', download_id: '7' },
    leaf: 'cancel_download',
    consumed: ['download_id'],
    expect: { download_id: 7 },
  },
  {
    tool: canonical.downloads,
    args: { action: 'download_url', url: 'https://example.com/a.pdf', filename: 'a.pdf' },
    leaf: 'download_url',
  },
  // clipboard
  {
    tool: canonical.clipboard,
    args: { action: 'write', text: 'copied text' },
    leaf: 'set_clipboard',
  },
];

describe('delegate() refuses keys the leaf would silently strip', () => {
  it('returns ok:false naming the unknown key and never runs the leaf', async () => {
    const { z } = await import('zod');
    const run = vi.fn(async () => ({ ok: true }));
    const leaf = {
      name: 'leaf_x',
      tier: 'read',
      argsSchema: z.object({ max_results: z.number().optional() }),
      run,
    };
    const out = await realDelegate(leaf as never, { limit: 5 }, ctx);
    expect(out).toEqual({
      ok: false,
      reason: 'delegate passed unknown key(s) limit to leaf leaf_x',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('sees through refine/default wrappers and treats passthrough leaves as open', async () => {
    const { z } = await import('zod');
    const refined = z.object({ a: z.string() }).refine(() => true);
    expect(unknownDelegateKeys(refined, { a: 'x', b: 1 })).toEqual(['b']);
    expect(unknownDelegateKeys(z.object({ a: z.string() }).default({ a: '' }), { b: 1 })).toEqual([
      'b',
    ]);
    expect(unknownDelegateKeys(z.object({}).passthrough(), { b: 1 })).toEqual([]);
  });
});

describe('every canonical wrapper delivers each public arg to its leaf', () => {
  for (const c of cases) {
    const label = `${c.tool.name} ${JSON.stringify(c.args.action ?? c.args.url ?? c.probe)} -> ${c.leaf}`;
    it(label, async () => {
      calls.length = 0;
      probeKind = c.probe ?? 'text';
      const parsedPublic = c.tool.argsSchema.parse(c.args) as Record<string, unknown>;
      const out = await c.tool.run(parsedPublic, ctx);
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
      expect(calls.map((x) => x.leaf)).toEqual([c.leaf]);
      const parsed = calls[0]!.parsed;
      if (c.expect) expect(parsed).toMatchObject(c.expect);
      const skip = new Set(['action', ...(c.consumed ?? [])]);
      for (const [k, v] of Object.entries(c.args)) {
        if (skip.has(k)) continue;
        expect(
          deepIncludes(parsed, v),
          `public '${k}'=${JSON.stringify(v)} never reached ${c.leaf}: ${JSON.stringify(parsed)}`,
        ).toBe(true);
      }
    });
  }

  it('cookies set turns expires_in_seconds into an absolute epoch-seconds expiration', async () => {
    calls.length = 0;
    await mergers.cookies.run(
      {
        action: 'set',
        url: 'https://shop.example.com/',
        name: 'sid',
        value: 'v',
        expires_in_seconds: 3600,
      },
      ctx,
    );
    const exp = calls[0]!.parsed.expiration as number;
    expect(exp).toBeGreaterThanOrEqual(NOW_S + 3600);
    expect(exp).toBeLessThan(NOW_S + 3600 + 60);
  });
});

describe('siblings of the class: values the leaf never saw', () => {
  it('wait_for network_idle runs on the tab_id the caller named (no failing delegation)', async () => {
    scripted.length = 0;
    calls.length = 0;
    const out = await canonical.wait_for.run(
      canonical.wait_for.argsSchema.parse({
        tab_id: '77',
        condition: 'network_idle',
        timeout_ms: 2000,
      }) as never,
      { assignedTabId: 42 } as never,
    );
    expect(out).toMatchObject({ ok: true });
    expect(scripted).toEqual([77]);
  });

  it('get_request_body parses a string tab_id and reaches the body leaf with an int', async () => {
    const spy = vi.spyOn(cdpMod.cdp_network_get_body, 'run');
    calls.length = 0;
    const out = await cdpMod.get_request_body.run({ tab_id: '123', request_id: 'r1' }, ctx);
    expect(out).toMatchObject({ ok: true });
    expect(calls).toEqual([
      { leaf: 'cdp_network_get_body', parsed: { request_id: 'r1', tab_id: 123 } },
    ]);
    spy.mockRestore();
    const bad = await cdpMod.get_request_body.run({ tab_id: 'abc', request_id: 'r1' }, ctx);
    expect(bad).toEqual({ ok: false, reason: 'Invalid tab_id: abc' });
  });

  it('parseTabIdArg: digit string or int → int; empty → null; junk refused', () => {
    expect(parseTabIdArg('123')).toEqual({ ok: true, id: 123 });
    expect(parseTabIdArg(' 9 ')).toEqual({ ok: true, id: 9 });
    expect(parseTabIdArg(5)).toEqual({ ok: true, id: 5 });
    expect(parseTabIdArg(undefined)).toEqual({ ok: true, id: null });
    expect(parseTabIdArg('')).toEqual({ ok: true, id: null });
    expect(parseTabIdArg('12abc')).toMatchObject({ ok: false });
    expect(parseTabIdArg(1.5)).toMatchObject({ ok: false });
  });

  it('request_user_takeover shows instructions AND expected_action, and fronts tab_id', async () => {
    broadcasts.length = 0;
    activated.length = 0;
    const out = await userMod.request_user_takeover.run(
      {
        reason: 'Login needs a code',
        instructions: 'Enter the 6-digit code from your phone',
        expected_action: 'Click Continue when signed in',
        tab_id: '88',
      },
      { callId: 'c1', conversationId: 'v1' } as never,
    );
    expect(out).toMatchObject({ answer: 'done' });
    const q = broadcasts[0]!.question as string;
    expect(q).toContain('Enter the 6-digit code from your phone');
    expect(q).toContain('Click Continue when signed in');
    expect(activated).toEqual([88]);
  });
});
