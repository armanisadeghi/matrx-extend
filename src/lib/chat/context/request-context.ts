/**
 * THE ONE DOOR for a request's `context` — and the rows the chip shows.
 *
 * Contract: /Users/armanisadeghi/code/common-docs/systems/data/scopes-context/context-delivery/RULES.md
 *
 * `buildChatContext` (v2-bundled / v1-flat) collects every value the page,
 * the chat and the extension know about. This file turns each of those values
 * into ONE `ResolvedContextRow` (`@ai-matrx/agents/context`) with the person's
 * saved rules applied, and the request's `context` is built ONLY by the
 * package's `buildContextWire(rows)`. So:
 *   - a value the person turned off never reaches the wire;
 *   - the chip shows exactly the rows the request was built from;
 *   - the server's `context_receipt` is checked against those same rows.
 *
 * Reserved DIRECTIVE keys (`__google_files`, `__table_access`) are not values:
 * aidream pops them before its context gate (`context_utils.apply_context_objects`),
 * they never appear in a receipt, and they ship byte-for-byte as they are.
 *
 * `RequestContextWire` is branded and `AgentStartRequest.context` /
 * `ConversationContinueRequest.context` accept nothing else. Guard:
 * `request-context.test.ts` (scans every request body for a second door).
 */

import {
  type ContextRowOrigin,
  type ContextRowSource,
  DEFAULT_INLINE_CAP,
  DEFAULT_SURFACE_KEY,
  type ResolvedContextRow,
  type SavedContextRuleRows,
  buildContextWire,
  resolveContextRow,
  withheldKeys,
} from '@ai-matrx/agents/context';

declare const requestContextBrand: unique symbol;

/** A request `context` that came out of `buildRequestContext` — nothing else. */
export type RequestContextWire = Readonly<Record<string, unknown>> & {
  readonly [requestContextBrand]: true;
};

/**
 * Reserved directive keys: aidream pops these before the context gate
 * (`db_grants.models.TABLE_ACCESS_CONTEXT_KEY`,
 * `google_workspace.attachments.GOOGLE_FILES_CONTEXT_KEY`).
 */
export const CONTEXT_DIRECTIVE_KEYS: ReadonlySet<string> = new Set([
  '__google_files',
  '__table_access',
]);

/** Values the extension itself supplies about the person and the client. */
const SYSTEM_KEYS: ReadonlySet<string> = new Set(['user', 'client']);
/** Values the person or the conversation attached (not read off the page). */
const ATTACHED_KEYS: ReadonlySet<string> = new Set(['highlights', 'plan', 'tasks', 'user_todos']);

const LABELS: Readonly<Record<string, string>> = {
  page_brief: 'Page brief',
  page_full_content: 'Page content',
  page_meta: 'Page details',
  page_seo_audit: 'SEO audit',
  page_links: 'Links',
  page_media: 'Media',
  page_media_raw: 'Media (raw)',
  page_structured_data: 'Structured data',
  page_dismissibles: 'Pop-ups',
  chrome_elements: 'Page chrome',
  form_elements: 'Forms',
  result_list: 'Result list',
  tab_state: 'Tab',
  viewport_state: 'Viewport',
  selection: 'Selection',
  highlights: 'Highlights',
  user_todos: 'Your to-dos',
  user: 'You',
  client: 'Extension',
};

function labelFor(key: string): string {
  const known = LABELS[key];
  if (known) return known;
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

function originFor(key: string): ContextRowOrigin {
  if (SYSTEM_KEYS.has(key)) return 'system';
  if (ATTACHED_KEYS.has(key)) return 'attached';
  return 'page';
}

/**
 * Split the builder's value map into rule-governed rows and directives.
 *
 * Values carry the same declared surface as the request so the client's
 * saved rules and the server's rule provenance agree. Utilities without a
 * declared chat surface retain the global rules row.
 */
export function contextRowSources(
  values: Readonly<Record<string, unknown>>,
  surfaceKey: string = DEFAULT_SURFACE_KEY,
): {
  sources: ContextRowSource[];
  directives: Record<string, unknown>;
} {
  const sources: ContextRowSource[] = [];
  const directives: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (CONTEXT_DIRECTIVE_KEYS.has(key)) {
      directives[key] = value;
      continue;
    }
    sources.push({
      key,
      label: labelFor(key),
      surfaceKey,
      origin: originFor(key),
      value,
    });
  }
  return { sources, directives };
}

export interface RequestContext {
  /** What the chip shows and what the receipt is checked against. */
  rows: ResolvedContextRow[];
  /** The request body's `context`, or undefined when nothing rides. */
  context: RequestContextWire | undefined;
  /**
   * The request body's `context_withheld`: keys this client has a value for
   * but is not sending (off by the page, the agent or the person's rule), so
   * the receipt lists rule rows only for keys actually withheld here.
   */
  withheld: string[];
}

/** Rows (with the person's rules) and the request `context` built from them. */
export function buildRequestContext(
  values: Readonly<Record<string, unknown>>,
  savedRules: SavedContextRuleRows | null | undefined,
  cap: number = DEFAULT_INLINE_CAP,
  surfaceKey: string = DEFAULT_SURFACE_KEY,
): RequestContext {
  const { sources, directives } = contextRowSources(values, surfaceKey);
  const rows = sources.map((source) => resolveContextRow(source, savedRules, cap));
  const wire: Record<string, unknown> = buildContextWire(rows);
  for (const [key, value] of Object.entries(directives)) wire[key] = value;
  return {
    rows,
    context: Object.keys(wire).length > 0 ? (wire as unknown as RequestContextWire) : undefined,
    withheld: withheldKeys(rows),
  };
}

/** The rows a request was built from, without their values (for the receipt check). */
export function rowsWithoutValues(rows: readonly ResolvedContextRow[]): ResolvedContextRow[] {
  return rows.map((row) => ({ ...row, value: undefined }));
}

/**
 * The two request-body fields one built context contributes — `context` (only
 * when something rides) and `context_withheld` (always, from the SAME rows).
 */
export function contextRequestFields(rc: Pick<RequestContext, 'context' | 'withheld'>): {
  context?: RequestContextWire;
  context_withheld: string[];
} {
  return {
    ...(rc.context !== undefined && { context: rc.context }),
    context_withheld: rc.withheld,
  };
}
