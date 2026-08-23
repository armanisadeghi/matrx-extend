/**
 * `markdown` — a kind whose payload is one string of markdown.
 *
 * The floor seam could render this, but a real markdown renderer is HOST
 * property (typography calibrated for a 400px side panel, the chat registry's
 * code/xml handlers), which is exactly why `renderValue` is a seam and this is
 * a registered component.
 */

import { Markdown } from '@/components/markdown';
import { chatMarkdownRegistry } from '@/features/chat/markdown-registry';
import type { KindComponentProps } from './types';

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

export function MarkdownKind({ value }: KindComponentProps) {
  const text = textOf(value);
  if (!text) return null;
  return <Markdown content={text} registry={chatMarkdownRegistry} />;
}
