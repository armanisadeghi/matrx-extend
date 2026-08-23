"use client";

/**
 * THE RENDER SEAM for one inbound `render_block`.
 *
 * The pipeline, end to end, with nothing invented on this side:
 *
 *   server detects + validates → `render_block` + `metadata.__ir`
 *     → `readInboundRenderBlock` (kernel gate: valid envelope or none)
 *     → `applyIrKindRoute` (SHARED — the same decisions matrx-frontend makes)
 *     → this dispatch → a registered component, or the generic floor
 *
 * This client never parses a raw chunk looking for structure. Detection is
 * server-side for thin clients by design; re-implementing it here is the
 * "bespoke stream renderer" the platform bans.
 */

import { useMemo } from 'react';
import {
  applyIrKindRoute,
  GenericStructuredView,
  useContentIrKindVersion,
  type IrRenderBlock,
} from '@ai-matrx/content-ir-react';
import { readEnvelope, reconstructRegionValue } from '@ai-matrx/content-ir';
import { Markdown } from '@/components/markdown';
import { CodeBlock } from '@/components/markdown/CodeBlock';
import { chatMarkdownRegistry } from '@/features/chat/markdown-registry';
import { contentIrRouteEnv, contentIrVersionSources } from '@/lib/content-ir/route-env';
import { componentRegistry } from '@/lib/content-ir/registry';
import { CONTENT_IR_PLATFORM } from '@/lib/content-ir/platform';
import type { InboundRenderBlock } from '@/lib/content-ir/inbound';
import { lookupKindComponent } from './dispatch';
import { ContentIrHostBoundary } from './host';

/** Block types the server emits for prose — these are text, not shapes. */
const TEXT_TYPES = new Set(['text', 'markdown', 'paragraph']);

export function RenderBlockView({ block }: { block: InboundRenderBlock }) {
  const envelope = readEnvelope(block.metadata);
  const kind = envelope?.root.kind ?? null;

  // The registries warm asynchronously and a kind may be cold when its block
  // arrives. Without this subscription the block would keep its pre-arrival
  // decision — generic, or unrouted — for the rest of the session.
  const version = useContentIrKindVersion(kind, contentIrVersionSources);

  // Eager per-kind fetch (deduped, miss-latched inside the resolver): the
  // moment a kind is identified mid-stream, pull ITS component row rather than
  // waiting on the wholesale warm load.
  if (kind) componentRegistry.requestComponent(kind, CONTENT_IR_PLATFORM, 'output');

  // No React Compiler in this repo (WXT/Vite) — the route is a real function
  // call and must not re-execute on every unrelated parent render.
  const routed = useMemo(
    () =>
      applyIrKindRoute<IrRenderBlock>(
        {
          type: block.type,
          content: block.content ?? '',
          // `exactOptionalPropertyTypes` is on here: an OPTIONAL key is omitted,
          // never widened to `| undefined`.
          ...(block.metadata !== undefined && { metadata: block.metadata }),
        },
        contentIrRouteEnv,
      ),
    // `version` is the repaint key: a late schema/component arrival changes it
    // and only then does the decision get remade.
    [block.type, block.metadata, block.content, version],
  );

  const complete = block.status === 'complete';

  // ── A registered component for this kind on this platform ────────────────
  const Component = lookupKindComponent(routed.type);
  if (Component && envelope && kind) {
    return (
      <Component value={reconstructRegionValue(envelope)} kind={kind} complete={complete} />
    );
  }

  // ── A known shape with no component here — the honest floor (R6) ─────────
  if (envelope && kind) {
    return (
      <ContentIrHostBoundary>
        <GenericStructuredView
          content={block.content ?? ''}
          {...(routed.metadata !== undefined && { metadata: routed.metadata })}
          streamingIndicator={
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Still arriving…
            </div>
          }
        />
      </ContentIrHostBoundary>
    );
  }

  // ── No envelope at all: an ordinary server block ─────────────────────────
  if (TEXT_TYPES.has(routed.type)) {
    return block.content ? (
      <Markdown content={block.content} registry={chatMarkdownRegistry} />
    ) : null;
  }

  return (
    <CodeBlock
      lang={typeof block.metadata?.language === 'string' ? block.metadata.language : routed.type}
      code={block.content ?? ''}
      complete={complete}
    />
  );
}
