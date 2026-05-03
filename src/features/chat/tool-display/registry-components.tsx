/**
 * Field components used by `results.keysInfo` (and reusable for any future
 * config that names a component to render a single value). Each one accepts
 * `{ value: unknown; className?: string }` and is responsible for coercing
 * the value into something renderable. Anything weird (null, object) should
 * render as empty / a JSON dump rather than throw.
 */

import { MarkdownView } from '@/components/MarkdownView';
import { cn } from '@/lib/utils';
import type { ComponentType } from 'react';
import type { FieldComponentName } from './types';

interface FieldProps {
  value: unknown;
  className?: string;
}

function safeJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const BoldLabel = ({ value, className }: FieldProps) => (
  <div className={cn('text-[12px] font-semibold', className)}>{String(value ?? '')}</div>
);

const TextDisplay = ({ value, className }: FieldProps) => (
  <div className={cn('text-[12px]', className)}>{String(value ?? '')}</div>
);

const Markdown = ({ value, className }: FieldProps) => (
  <div className={className}>
    <MarkdownView content={String(value ?? '')} density="compact" />
  </div>
);

const Code = ({ value, className }: FieldProps) => (
  <pre
    className={cn(
      'max-h-48 overflow-auto rounded-md bg-background/60 p-1.5 text-[11px] leading-snug',
      className,
    )}
  >
    {String(value ?? '')}
  </pre>
);

const Json = ({ value, className }: FieldProps) => (
  <pre
    className={cn(
      'max-h-48 overflow-auto rounded-md bg-background/60 p-1.5 text-[11px] leading-snug',
      className,
    )}
  >
    {safeJson(value)}
  </pre>
);

const Image = ({ value, className }: FieldProps) => {
  const src = typeof value === 'string' ? value : '';
  if (!src) return null;
  return <img src={src} className={cn('max-w-full rounded-md', className)} alt="" />;
};

const Badge = ({ value, className }: FieldProps) => (
  <span
    className={cn(
      'inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground',
      className,
    )}
  >
    {String(value ?? '')}
  </span>
);

export const fieldComponents: Record<FieldComponentName, ComponentType<FieldProps>> = {
  BoldLabel,
  TextDisplay,
  Markdown,
  Code,
  Json,
  Image,
  Badge,
};
