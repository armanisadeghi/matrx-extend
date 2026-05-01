/**
 * Drop-in copy widget. Three flavors:
 *   - <CopyButton text={...} /> — single one-click copy (icon button).
 *   - <CopyMenu options={[...]} /> — popover with multiple flavors. Admin-only
 *     options are hidden for non-admins automatically.
 *
 * Both render a clipboard icon that swaps to a check mark for ~1.2s on success.
 *
 * Use widely. The whole point is to move data out of the extension and into
 * the user's clipboard with as little friction as possible — into a doc, into
 * an agent chat, into a terminal.
 */

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/use-auth';
import { copyToClipboard } from '@/lib/clipboard/copy';
import { cn } from '@/lib/utils';
import { Check, Copy, Sparkles } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export interface CopyOption {
  label: string;
  description?: string;
  /** May be sync or async. Should return the final string ready to paste. */
  getContent: () => string | Promise<string>;
  /** Hidden for non-admin users when true. */
  adminOnly?: boolean;
  /** Show the sparkles icon next to this option to mark it as an AI flavor. */
  ai?: boolean;
}

const ICON_SIZE = 'size-3';

export interface CopyButtonProps {
  text: string | (() => string | Promise<string>);
  title?: string;
  className?: string;
  /** Pixel size of the button itself ('xs' = 5, 'sm' = 6, 'md' = 7). */
  size?: 'xs' | 'sm' | 'md';
}

export function CopyButton({ text, title = 'Copy', className, size = 'sm' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const value = typeof text === 'function' ? await text() : text;
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        size === 'xs' && 'size-5',
        size === 'sm' && 'size-6',
        size === 'md' && 'size-7',
        className,
      )}
    >
      {copied ? (
        <Check className={cn(ICON_SIZE, 'text-emerald-500')} />
      ) : (
        <Copy className={ICON_SIZE} />
      )}
    </button>
  );
}

export interface CopyMenuProps {
  options: CopyOption[];
  title?: string;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
  /** Optional label shown next to the icon (e.g. on section-level triggers). */
  label?: ReactNode;
  /** Forwarded to Popover content, for cases where 'end' alignment cuts off. */
  align?: 'start' | 'center' | 'end';
}

export function CopyMenu({
  options,
  title = 'Copy',
  className,
  size = 'sm',
  label,
  align = 'end',
}: CopyMenuProps) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const visible = options.filter((o) => !o.adminOnly || isAdmin);
  if (visible.length === 0) return null;

  const handleClick = async (o: CopyOption) => {
    const content = await o.getContent();
    const ok = await copyToClipboard(content);
    if (ok) {
      setCopiedLabel(o.label);
      setTimeout(() => setCopiedLabel(null), 1200);
      setOpen(false);
    }
  };

  // Single-option: render as a plain button, no popover noise.
  if (visible.length === 1) {
    const only = visible[0]!;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleClick(only);
        }}
        title={title}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          label ? 'h-6 px-2 text-xs' : '',
          !label && size === 'xs' && 'size-5',
          !label && size === 'sm' && 'size-6',
          !label && size === 'md' && 'size-7',
          className,
        )}
      >
        {copiedLabel ? (
          <Check className={cn(ICON_SIZE, 'text-emerald-500')} />
        ) : (
          <Copy className={ICON_SIZE} />
        )}
        {label}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={title}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            label ? 'h-6 px-2 text-xs' : '',
            !label && size === 'xs' && 'size-5',
            !label && size === 'sm' && 'size-6',
            !label && size === 'md' && 'size-7',
            className,
          )}
        >
          {copiedLabel ? (
            <Check className={cn(ICON_SIZE, 'text-emerald-500')} />
          ) : (
            <Copy className={ICON_SIZE} />
          )}
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-1">
        {visible.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleClick(o);
            }}
            className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
          >
            {o.ai ? (
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
            ) : (
              <Copy className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate">{o.label}</span>
                {o.adminOnly && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    admin
                  </span>
                )}
              </div>
              {o.description && (
                <div className="text-[11px] text-muted-foreground">{o.description}</div>
              )}
            </div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
