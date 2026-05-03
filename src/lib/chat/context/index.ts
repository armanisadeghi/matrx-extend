/**
 * Context-builder dispatcher. Reads `matrx.context.shape` from chrome.storage
 * (admin toggle) and routes to v1-flat (legacy) or v2-bundled (default).
 *
 * Public surface for the rest of the app: `buildChatContext(inputs)`.
 */

import { log } from '@/lib/debug/log';
import { getContextShape } from './shape-config';
import type { ContextBuildInputs } from './types';
import { buildContextV1Flat } from './v1-flat';
import { buildContextV2Bundled } from './v2-bundled';

export type { ContextBuildInputs };
export { getContextShape, setContextShape, DEFAULT_CONTEXT_SHAPE } from './shape-config';
export type { ContextShape } from './shape-config';

export async function buildChatContext(
  inputs: ContextBuildInputs,
): Promise<Record<string, unknown>> {
  const shape = await getContextShape();
  log.info('stream', `building context (shape=${shape})`);
  if (shape === 'v1-flat') return buildContextV1Flat(inputs);
  return buildContextV2Bundled(inputs);
}
