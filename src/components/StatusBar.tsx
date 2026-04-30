import { useAuth } from '@/hooks/use-auth';
import { useDesktopBridge } from '@/hooks/use-desktop';
import { cn } from '@/lib/utils';
import { Cpu, Server, Wifi, WifiOff } from 'lucide-react';

export function StatusBar() {
  const { user } = useAuth();
  const desktop = useDesktopBridge();

  return (
    <div className="flex h-7 items-center justify-between border-t bg-card px-3 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-2">
        <Server className="size-3" />
        <span className="truncate max-w-[120px]">{user?.email ?? 'guest'}</span>
      </div>
      <div className="flex items-center gap-2">
        <DesktopBadge transport={desktop.transport} />
      </div>
    </div>
  );
}

function DesktopBadge({ transport }: { transport: 'native' | 'http' | 'none' }) {
  if (transport === 'none')
    return (
      <span className="flex items-center gap-1 text-muted-foreground/60">
        <WifiOff className="size-3" /> desktop offline
      </span>
    );
  return (
    <span className={cn('flex items-center gap-1', transport === 'native' && 'text-emerald-500')}>
      {transport === 'native' ? <Cpu className="size-3" /> : <Wifi className="size-3" />}
      desktop {transport}
    </span>
  );
}
