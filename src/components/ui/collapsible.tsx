import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Smooth-height collapsible. No external dep — uses the grid-template-rows
 * 0fr → 1fr trick so we don't need to measure content height.
 */
export function Collapsible({
  label,
  defaultOpen = true,
  rightSlot,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  rightSlot?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex items-center px-1 py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group flex flex-1 items-center gap-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform duration-200',
              open && 'rotate-90',
            )}
          />
          {label}
        </button>
        {rightSlot}
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
