/**
 * Context-builder dispatcher and THE ONE DOOR for a request's `context`.
 *
 * `buildChatContextValues` reads `matrx.context.shape` from chrome.storage
 * (admin toggle) and collects every value via v1-flat (legacy) or v2-bundled
 * (default). `buildChatContext` turns those values into rows with the
 * person's saved rules applied and builds the request `context` from the rows
 * with `@ai-matrx/agents/context` `buildContextWire` — the only way a request
 * gets one. Contract:
 * /Users/armanisadeghi/code/common-docs/systems/scopes-context/context-delivery/RULES.md
 */

import { log } from '@/lib/debug/log';
import { ensureContextRulesReady, useContextRulesStore } from '@/state/context-rules';
import { DEFAULT_INLINE_CAP, type ResolvedContextRow } from '@ai-matrx/agents/context';
import {
  type RequestContext,
  type RequestContextWire,
  buildRequestContext,
  contextRequestFields,
} from './request-context';
import { getContextShape } from './shape-config';
import type { ContextBuildInputs } from './types';
import { buildContextV1Flat } from './v1-flat';
import { buildContextV2Bundled } from './v2-bundled';

export type { ContextBuildInputs };
export type { RequestContext, RequestContextWire };
export { contextRequestFields };
export { getContextShape, setContextShape, DEFAULT_CONTEXT_SHAPE } from './shape-config';
export type { ContextShape } from './shape-config';

/** Every value the next turn would carry, before any rule. */
export async function buildChatContextValues(
  inputs: ContextBuildInputs,
): Promise<Record<string, unknown>> {
  const shape = await getContextShape();
  log.info('stream', `building context (shape=${shape})`);
  if (shape === 'v1-flat') return buildContextV1Flat(inputs);
  return buildContextV2Bundled(inputs);
}

export interface ChatRequestContext {
  /** The raw values (for reading facts like `page_brief.lang`; never sent as-is). */
  values: Record<string, unknown>;
  /** What the chip shows and what the receipt is checked against. */
  rows: ResolvedContextRow[];
  /** The request body's `context`, or undefined when nothing rides. */
  context: RequestContextWire | undefined;
  /** The request body's `context_withheld`, from the same rows. */
  withheld: string[];
}

/** The inline cap the server last reported for this conversation, else the default. */
function capFor(conversationId: string | null | undefined): number {
  if (!conversationId) return DEFAULT_INLINE_CAP;
  return (
    useContextRulesStore.getState().receiptByConversation[conversationId]?.receipt.cap ??
    DEFAULT_INLINE_CAP
  );
}

/**
 * The request `context` for one turn. Awaits the person's saved rules (and any
 * rule write still in flight) first, so a change made a moment before send is
 * the one the request honours.
 */
export async function buildChatContext(inputs: ContextBuildInputs): Promise<ChatRequestContext> {
  await ensureContextRulesReady();
  const values = await buildChatContextValues(inputs);
  const { rows, context, withheld } = buildRequestContext(
    values,
    useContextRulesStore.getState().rows,
    capFor(inputs.conversationId),
  );
  return { values, rows, context, withheld };
}

/**
 * The request `context` for a one-off request (extraction, SEO advice…) whose
 * values are not the chat's page bundle. Same door: the person's saved rules
 * as currently loaded, then `buildContextWire`. Synchronous so pure request
 * builders stay pure; the server re-reads the rules every turn regardless.
 */
export function requestContextFromValues(
  values: Readonly<Record<string, unknown>>,
): RequestContext {
  return buildRequestContext(values, useContextRulesStore.getState().rows);
}

/** Spread helper: the `context` + `context_withheld` fields of one built context. */
export function withContext(rc: RequestContext): ReturnType<typeof contextRequestFields> {
  return contextRequestFields(rc);
}
