/**
 * THE WIRE BOUNDARY for inbound `render_block` events.
 *
 * A server-built envelope on `metadata.__ir` is the ONLY way structured
 * content enters this client. It is not trusted on arrival: the kernel's pure
 * gate (`sanitizeInboundEnvelopeMetadata`) validates the envelope field by
 * field, passes a good one through untouched, and STRIPS a malformed one so
 * nothing downstream routes on garbage. Malformed is reported, never silently
 * dropped.
 *
 * React-free: the stream handler runs in the side panel's event loop, not in
 * a render.
 */

import { sanitizeInboundEnvelopeMetadata } from '@ai-matrx/content-ir/core';
import { reportContentIrError } from './errors';

/** The `render_block` event payload, camelCase on the wire (aidream `RenderBlockEvent`). */
export interface InboundRenderBlock {
  blockId: string;
  blockIndex: number;
  type: string;
  status: 'streaming' | 'complete';
  content?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

/**
 * Read one wire event into a block, or null when it is not a render block at
 * all. `blockId` is the reconciliation key: the server re-sends the same id as
 * a block grows from `streaming` to `complete`.
 */
export function readInboundRenderBlock(data: unknown): InboundRenderBlock | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = data as Record<string, unknown>;
  const blockId = asString(raw.blockId, '');
  if (!blockId) return null;

  const metadata =
    typeof raw.metadata === 'object' && raw.metadata !== null
      ? sanitizeInboundEnvelopeMetadata(raw.metadata as Record<string, unknown>, { blockId }, {
          reportMalformed: (report) => {
            reportContentIrError({
              source: 'content-ir',
              message: `inbound render_block "${report.blockId}" carried a malformed __ir envelope (engine ${String(
                report.engine,
              )}) — the envelope was stripped and the block renders as plain content.`,
              relation: 'inbound-envelope',
              raw: report.raw,
            });
          },
        })
      : undefined;

  const blockIndex = typeof raw.blockIndex === 'number' ? raw.blockIndex : 0;

  return {
    blockId,
    blockIndex,
    type: asString(raw.type, 'text'),
    status: raw.status === 'complete' ? 'complete' : 'streaming',
    ...(typeof raw.content === 'string' && { content: raw.content }),
    ...(typeof raw.data === 'object' && raw.data !== null && {
      data: raw.data as Record<string, unknown>,
    }),
    ...(metadata !== undefined && { metadata }),
  };
}
