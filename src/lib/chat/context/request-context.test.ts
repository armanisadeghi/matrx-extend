import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { checkContextReceipt, isContextReceiptData, toContextReceipt } from '@/state/context-rules';
import {
  type ContextReceipt,
  type ContextReceiptRow,
  applyReceiptToRows,
} from '@ai-matrx/agents/context';
import { describe, expect, it } from 'vitest';
import {
  buildRequestContext,
  contextRequestFields,
  contextRowSources,
  rowsWithoutValues,
} from './request-context';

const PAGE_TEXT = 'Lorem ipsum '.repeat(2000);

const VALUES = {
  user: { id: 'u1', name: 'Pat', email: 'pat@example.com' },
  client: { surface: 'chrome-extension-chat', extension_version: '0.2.151' },
  page_brief: { url: 'https://example.com/pricing', title: 'Pricing', lang: 'en' },
  page_full_content: { markdown: PAGE_TEXT, word_count: 4000 },
  highlights: { count: 1, items: [{ id: 'h1', text: 'Plan B' }] },
  __google_files: ['drive-file-1', 'drive-file-2'],
};

function receiptRow(patch: Partial<ContextReceiptRow> & { key: string }): ContextReceiptRow {
  return {
    label: patch.key,
    surface_key: '_default',
    origin: 'client',
    chars: 10,
    include: true,
    max_inline_chars: 200,
    delivery: 'inline',
    decided_by: { include: 'default', max_inline_chars: 'default' },
    user_rule: null,
    clamped: false,
    client_sent_excluded: false,
    blocked_by: null,
    ...patch,
  };
}

function receiptFor(rows: ReturnType<typeof buildRequestContext>['rows']): ContextReceipt {
  return {
    version: 1,
    surface: null,
    cap: 50000,
    model_reads_context: true,
    rules_error: null,
    rows: rows
      .filter((r) => r.include || r.userRule?.include === false)
      .map((r) =>
        receiptRow({
          key: r.key,
          chars: r.chars,
          include: r.include,
          max_inline_chars: r.max_inline_chars,
          // A server-resolved row's delivery is the server's to say; the
          // receipt then reports what it did (on_request for a resolved ref).
          delivery: r.delivery === 'server' ? 'on_request' : r.delivery,
          decided_by: r.decided_by,
          user_rule: r.userRule,
          origin: r.include ? 'client' : 'rule',
        }),
      ),
  };
}

describe('rows → wire', () => {
  it('classifies every value and keeps directives out of the rows', () => {
    const { sources, directives } = contextRowSources(VALUES);
    expect(Object.fromEntries(sources.map((s) => [s.key, s.origin]))).toEqual({
      user: 'system',
      client: 'system',
      page_brief: 'page',
      page_full_content: 'page',
      highlights: 'attached',
    });
    expect(sources.every((s) => s.surfaceKey === '_default')).toBe(true);
    expect(directives).toEqual({ __google_files: ['drive-file-1', 'drive-file-2'] });
  });

  it('wraps values in envelopes and ships __google_files verbatim', () => {
    const { rows, context } = buildRequestContext(VALUES, null);
    expect(rows).toHaveLength(5);
    const wire = context as unknown as Record<string, { content?: unknown; label?: string }>;
    expect(wire.page_brief).toMatchObject({ content: VALUES.page_brief, label: 'Page brief' });
    expect(wire.page_full_content?.content).toEqual(VALUES.page_full_content);
    expect((context as unknown as Record<string, unknown>).__google_files).toEqual([
      'drive-file-1',
      'drive-file-2',
    ]);
    // Size is measured, so the chip can show what the page costs.
    const page = rows.find((r) => r.key === 'page_full_content')!;
    expect(page.chars).toBeGreaterThan(20000);
    expect(page.delivery).toBe('on_request');
  });

  it('never sends a value the person turned off', () => {
    const saved = { _default: { page_full_content: { include: false } } };
    const { rows, context } = buildRequestContext(VALUES, saved);
    const page = rows.find((r) => r.key === 'page_full_content')!;
    expect(page.include).toBe(false);
    expect(page.decided_by.include).toBe('you');
    expect(context).not.toHaveProperty('page_full_content');
    expect(JSON.stringify(context)).not.toContain('Lorem ipsum');
  });

  it("applies the person's inline limit", () => {
    const saved = { _default: { page_full_content: { max_inline_chars: 50000 } } };
    const page = buildRequestContext(VALUES, saved).rows.find(
      (r) => r.key === 'page_full_content',
    )!;
    expect(page.delivery).toBe('inline');
    expect(page.decided_by.max_inline_chars).toBe('you');
  });

  it('sends context_withheld from the same rows the wire was built from', () => {
    const saved = { _default: { page_full_content: { include: false } } };
    const built = buildRequestContext(VALUES, saved);
    expect(built.withheld).toEqual(['page_full_content']);
    const fields = contextRequestFields(built);
    expect(fields.context_withheld).toEqual(['page_full_content']);
    expect(fields.context).not.toHaveProperty('page_full_content');
    // Nothing withheld is still said: an empty list, never an absent field.
    expect(contextRequestFields(buildRequestContext({}, null))).toEqual({ context_withheld: [] });
  });

  it('sends nothing when there is nothing', () => {
    expect(buildRequestContext({}, null).context).toBeUndefined();
  });

  it('strips values from the rows a receipt is checked against', () => {
    const rows = rowsWithoutValues(buildRequestContext(VALUES, null).rows);
    expect(rows.every((r) => r.value === undefined)).toBe(true);
  });
});

describe('server-resolved values', () => {
  const FILE = '3f6c2a51-8b8e-4d0f-9c3a-2f1e7b6d4a10';

  it('ships a *_id reference verbatim with delivery "server"', () => {
    const { rows, context } = buildRequestContext({ attached_file_id: FILE }, null);
    expect(rows[0]?.delivery).toBe('server');
    expect((context as unknown as Record<string, unknown>).attached_file_id).toBe(FILE);
  });

  it('is not flagged for a delivery the server decided, and is filled for display', () => {
    const { rows } = buildRequestContext({ attached_file_id: FILE }, null);
    const actual = receiptFor(rows);
    actual.rows = actual.rows.map((r) => ({ ...r, chars: 18000, delivery: 'on_request' }));
    expect(checkContextReceipt(rows, actual)).toEqual([]);
    const shown = applyReceiptToRows(rows, actual);
    expect(shown[0]?.chars).toBe(18000);
    expect(shown[0]?.delivery).toBe('on_request');
    // The rows a later receipt is checked against stay unfilled.
    expect(rows[0]?.delivery).toBe('server');
  });
});

describe('context_receipt', () => {
  it('recognizes the data event and normalizes the generated shape', () => {
    const data = { type: 'context_receipt' as const, cap: 50000, rows: [] };
    expect(isContextReceiptData(data)).toBe(true);
    expect(isContextReceiptData({ type: 'conversation_id', conversation_id: 'c' })).toBe(false);
    expect(toContextReceipt(data)).toEqual({
      version: 1,
      surface: null,
      cap: 50000,
      model_reads_context: true,
      rules_error: null,
      rows: [],
    });
  });

  it('keeps server text references and blocks for on-demand viewing', () => {
    const delivered = { chars: 17, sha256: 'a'.repeat(64) };
    const block = { id: 'organization_catalog', label: 'Organization catalog', delivered };
    const data = {
      type: 'context_receipt' as const,
      cap: 50000,
      rows: [
        {
          key: 'organization', label: 'Organization', surface_key: '_default',
          origin: 'server' as const, include: true, max_inline_chars: 200,
          delivery: 'inline' as const,
          decided_by: { include: 'default' as const, max_inline_chars: 'default' as const },
          delivered,
        },
      ],
      blocks: [block],
    };
    expect(toContextReceipt(data)).toMatchObject({
      rows: [{ delivered }],
      blocks: [block],
    });
  });

  it('is quiet when the server did what the rows said', () => {
    const saved = { _default: { page_full_content: { include: false } } };
    const { rows } = buildRequestContext(VALUES, saved);
    expect(checkContextReceipt(rows, receiptFor(rows))).toEqual([]);
  });

  it('is loud when the server delivered differently than the screen showed', () => {
    const { rows } = buildRequestContext(VALUES, null);
    const actual = receiptFor(rows);
    actual.rows = actual.rows.map((r) =>
      r.key === 'page_brief' ? { ...r, include: false, delivery: 'off' } : r,
    );
    const fields = checkContextReceipt(rows, actual).map((m) => `${m.key}.${m.field}`);
    expect(fields).toContain('page_brief.include');
  });

  it('flags a value the client sent although the person turned it off', () => {
    const actual = receiptFor([]);
    actual.rows = [receiptRow({ key: 'page_full_content', client_sent_excluded: true })];
    expect(checkContextReceipt([], actual)).toEqual([
      { key: 'page_full_content', field: 'include', expected: false, actual: 'sent' },
    ]);
  });

  it('flags a turn whose rules the server could not read', () => {
    const actual = { ...receiptFor([]), rules_error: 'timeout' };
    expect(checkContextReceipt([], actual)).toEqual([
      { key: '*', field: 'user_rule', expected: 'read', actual: 'timeout' },
    ]);
  });
});

/**
 * THE DOOR GUARD. A request's `context` comes only from `buildChatContext` /
 * `requestContextFromValues` (both end in `buildContextWire`). The branded
 * `RequestContextWire` stops a plain object reaching `AgentStartRequest`; this
 * scan stops an untyped body (resume, sub-runs) from carrying one.
 */
describe('context single door', () => {
  const SRC = resolve(__dirname, '../../..');
  const ALLOWED_VALUES = [
    /^context:\s*built\.context\b/,
    /^\.\.\.\(built\.context !== undefined && \{ context: built\.context \}\)/,
    /^context:\s*(undefined|RequestContextWire)\b/,
  ];

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  }

  it('no AI request body sets context outside the door', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      // Files that build requests to our AI server.
      if (!text.includes("source_app: 'matrx-extend'") && !text.includes('STREAM_START')) continue;
      text.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        const key = /(?:^|[{,]\s*)(context\s*[:,}])/.exec(trimmed);
        if (!key) return;
        const fromKey = trimmed.slice(trimmed.indexOf(key[1]!));
        if (/^context:\s*undefined\s*\}/.test(fromKey)) return;
        if (ALLOWED_VALUES.some((re) => re.test(fromKey) || re.test(trimmed))) return;
        offenders.push(`${relative(SRC, file)}:${i + 1}: ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('only the door calls buildContextWire', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(join('chat', 'context', 'request-context.ts')))
      .filter((f) => /buildContextWire\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
