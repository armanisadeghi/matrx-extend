"use client";

/**
 * THE EXTENSION'S CONTENT IR HOST — the four things
 * `@ai-matrx/content-ir-react` refuses to decide, supplied once.
 *
 * A boundary component rather than a root provider, for the same reason
 * matrx-frontend made the same call: the host object is a module singleton
 * with a referentially stable identity, so nesting the boundary wherever a
 * kind renders costs nothing and cannot go stale — while threading a provider
 * through the side panel, the pilot view and the tool timeline would be churn
 * for no benefit.
 */

import { useMemo, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { ContentIrRenderProvider, type ContentIrHost } from '@ai-matrx/content-ir-react';
import { kindRegistry, componentRegistry } from '@/lib/content-ir/registry';
import { reportContentIrError } from '@/lib/content-ir/errors';
import { CONTENT_IR_PLATFORM } from '@/lib/content-ir/platform';
import { StructuredValue } from './StructuredValue';
import { RenderBlockView } from './RenderBlockView';

export const contentIrHost: ContentIrHost = {
  platform: CONTENT_IR_PLATFORM,
  kinds: kindRegistry,
  components: componentRegistry,
  reportError: reportContentIrError,

  renderBlock: (block) => (
    <RenderBlockView
      block={{
        blockId: 'nested',
        blockIndex: 0,
        type: block.type,
        status: 'complete',
        content: block.content,
        ...(block.metadata !== undefined && { metadata: block.metadata }),
      }}
    />
  ),

  renderValue: ({ value, kind, note, footer }) => (
    <StructuredValue
      value={value}
      {...(kind === undefined ? {} : { kind })}
      {...(note === undefined ? {} : { note })}
      {...(footer === undefined ? {} : { footer })}
    />
  ),

  renderShimmer: (text) => (
    <span className="animate-pulse text-[10px] text-muted-foreground">{text}</span>
  ),

  renderNotice: (text) => (
    <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">
      <Info className="h-3 w-3 shrink-0" />
      {text}
    </div>
  ),
};

export function ContentIrHostBoundary({ children }: { children: ReactNode }) {
  // Stable by construction (module singleton); the memo only documents that.
  const host = useMemo(() => contentIrHost, []);
  return <ContentIrRenderProvider host={host}>{children}</ContentIrRenderProvider>;
}
