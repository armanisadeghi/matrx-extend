/**
 * Top-level chat / agent markdown renderer — a thin door onto @ai-matrx/rich-content
 * (`rich-door.tsx`), with the side-panel look the hand-rolled renderer had.
 *
 * Pass a `registry` to draw tags yourself: `registry.xml` renderers (thinking / reasoning /
 * reflection) receive the same props as before. Streaming: safe to call on every chunk; an open tag
 * at the tail arrives with `complete: false`.
 *
 * Parity with the old renderer is pinned by `__tests__/markdown-parity.test.tsx`.
 */

import type { MarkdownRegistry } from './registry';
import { RichMarkdownDoor } from './rich-door';

export type { MarkdownRegistry } from './registry';
export type {
  XmlBlockRendererProps,
  CodeBlockRendererProps,
  JsonBlockRendererProps,
} from './registry';

export interface MarkdownProps {
  content: string;
  /** Optional custom renderer registry (xml tags; code / json have no rich-content hook). */
  registry?: MarkdownRegistry;
  /** Pass-through className applied to the wrapper. */
  className?: string;
  /** Both densities draw the side-panel scale (rich-content `density="compact"`). */
  density?: 'comfortable' | 'compact';
  /** True while the text is still streaming in. */
  isStreaming?: boolean;
}

export function Markdown({ content, registry, className, isStreaming }: MarkdownProps) {
  return (
    <RichMarkdownDoor
      content={content}
      {...(registry && { registry })}
      {...(className !== undefined && { className })}
      {...(isStreaming !== undefined && { isStreaming })}
    />
  );
}
