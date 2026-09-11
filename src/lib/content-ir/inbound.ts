/**
 * THE WIRE BOUNDARY for inbound `render_block` events.
 *
 * A server-built envelope on `metadata.__ir` — or, for a producer that shadows
 * its text channel, a terminal on `metadata.__ir_partial` — is the ONLY way
 * structured content enters this client. Neither is trusted on arrival: the
 * kernel's pure gates (`sanitizeInboundEnvelopeMetadata`,
 * `sanitizeInboundPartialKindMetadata`) validate field by field, pass a good
 * one through untouched, and STRIP a malformed one so nothing downstream
 * routes on garbage. Malformed is reported, never silently dropped.
 *
 * React-free: the stream handler runs in the side panel's event loop, not in
 * a render.
 */

import { sanitizeInboundEnvelopeMetadata } from '@ai-matrx/content-ir/core';
import { sanitizeInboundPartialKindMetadata } from '@ai-matrx/content-ir/wire';
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

  const withEnvelope =
    typeof raw.metadata === 'object' && raw.metadata !== null
      ? sanitizeInboundEnvelopeMetadata(
          raw.metadata as Record<string, unknown>,
          { blockId },
          {
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
          },
        )
      : undefined;

  // The PARTIAL channel (`metadata.__ir_partial`) is the twin gate. A shadowed
  // producer's `superseded` terminal is the only identity such a block carries,
  // and `resolveSupersededKindRender` routes on it — so it gets validated at
  // the same boundary as `__ir` rather than trusted downstream. A valid event
  // (or no event at all) comes back on the SAME reference; a malformed one is
  // stripped loudly, degrading that block to "no live rendering" and no more.
  const metadata = sanitizeInboundPartialKindMetadata(
    withEnvelope,
    { blockId },
    {
      reportMalformed: (report) => {
        reportContentIrError({
          source: 'content-ir',
          message: `inbound render_block "${report.blockId}" carried a malformed __ir_partial event — the partial channel was stripped and the block renders from its own content only.`,
          relation: 'inbound-envelope',
          raw: report.raw,
        });
      },
    },
  );

  const blockIndex = typeof raw.blockIndex === 'number' ? raw.blockIndex : 0;

  return {
    blockId,
    blockIndex,
    type: asString(raw.type, 'text'),
    status: raw.status === 'complete' ? 'complete' : 'streaming',
    ...(typeof raw.content === 'string' && { content: raw.content }),
    ...(typeof raw.data === 'object' &&
      raw.data !== null && {
        data: raw.data as Record<string, unknown>,
      }),
    ...(metadata !== undefined && { metadata }),
  };
}
