/**
 * Clipboard utilities — three flavors of copy supported throughout the
 * extension:
 *
 *   1. Plain text — what a user would paste into a doc
 *   2. JSON — the underlying data representation (admin-flavor)
 *   3. AI-wrapped — the data plus context an LLM needs to understand it
 *      without the user having to explain
 *
 * The AI wrapper is intentionally simple and consistent so an agent picks up
 * the structure on first sight: a single sentence describing the payload,
 * an optional bullet list of metadata, then the content in a fenced block.
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: hidden textarea (old contexts, deny-listed permissions, etc.)
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export type AgentWrapFormat = 'markdown' | 'json' | 'text' | 'html' | 'tsv' | 'csv';

export interface AgentWrapInput {
  /** Single sentence describing what the payload is. e.g. "an article scraped from a webpage". */
  description: string;
  /** Source page metadata. URL especially helps an agent reason about origin. */
  source?: {
    url?: string | null;
    title?: string | null;
    host?: string | null;
    capturedAt?: string | number | null;
  };
  /** Extra free-form context bullets — anything that adds meaning. */
  meta?: Record<string, string | number | boolean | null | undefined>;
  /** Format of the content block — drives the fence info-string. */
  format?: AgentWrapFormat;
  /** The actual data, stringified. JSON callers should pass already-stringified JSON. */
  content: string;
  /** Optional trailing instruction. Leave empty if the user will add their own. */
  followUp?: string;
}

/**
 * Wrap a payload for pasting into an AI chat. Output is plain text with a
 * predictable shape: 1-line preamble, optional metadata bullets, fenced
 * content block, optional follow-up line.
 */
export function wrapForAgent(input: AgentWrapInput): string {
  const lines: string[] = [];
  lines.push(`The following is ${input.description}.`);

  const bullets: string[] = [];
  const src = input.source ?? {};
  if (src.url) bullets.push(`Source URL: ${src.url}`);
  if (src.title) bullets.push(`Title: ${src.title}`);
  if (src.host && !src.url) bullets.push(`Host: ${src.host}`);
  if (src.capturedAt) {
    const ts = formatTimestamp(src.capturedAt);
    if (ts) bullets.push(`Captured: ${ts}`);
  }
  for (const [k, v] of Object.entries(input.meta ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    bullets.push(`${humanKey(k)}: ${v}`);
  }
  if (bullets.length > 0) {
    lines.push('');
    for (const b of bullets) lines.push(`- ${b}`);
  }

  lines.push('');
  const fence = fenceFor(input.format ?? 'text');
  lines.push('```' + fence);
  lines.push(input.content.trimEnd());
  lines.push('```');

  if (input.followUp) {
    lines.push('');
    lines.push(input.followUp);
  }

  return lines.join('\n');
}

/**
 * Convenience: wrap an arbitrary object as JSON for an agent.
 */
export function wrapJsonForAgent(
  data: unknown,
  rest: Omit<AgentWrapInput, 'content' | 'format'>,
): string {
  return wrapForAgent({
    ...rest,
    format: 'json',
    content: stringifyJson(data),
  });
}

export function stringifyJson(data: unknown, indent = 2): string {
  try {
    return JSON.stringify(data, jsonReplacer, indent);
  } catch {
    return String(data);
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'string' && value.length > 50_000) {
    return `${value.slice(0, 50_000)}…(+${value.length - 50_000} chars truncated)`;
  }
  return value;
}

function fenceFor(fmt: AgentWrapFormat): string {
  switch (fmt) {
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'html':
      return 'html';
    case 'tsv':
      return 'tsv';
    case 'csv':
      return 'csv';
    default:
      return '';
  }
}

function humanKey(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function formatTimestamp(t: string | number): string {
  try {
    const ms = typeof t === 'number' ? t : Date.parse(t);
    if (!Number.isFinite(ms)) return String(t);
    return new Date(ms).toISOString();
  } catch {
    return String(t);
  }
}

/**
 * Convert an array of records to TSV. Useful for tables headed to spreadsheets.
 */
export function rowsToTsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      for (const k of Object.keys(r)) acc.add(k);
      return acc;
    }, new Set()),
  );
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  };
  const lines = [headers.join('\t')];
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join('\t'));
  return lines.join('\n');
}
