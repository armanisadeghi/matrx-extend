import { NoticeHost } from '@/components/NoticeHost';
import type { ReactNode } from 'react';

/** Notices reserve space instead of covering controls on any panel surface. */
export function SidepanelFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <NoticeHost />
    </div>
  );
}
