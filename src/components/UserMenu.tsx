import { useAuth } from '@/hooks/use-auth';
import { useDesktopBridge } from '@/hooks/use-desktop';
import { cn } from '@/lib/utils';

export function UserMenu() {
  const { user } = useAuth();
  const desktop = useDesktopBridge();

  const initial = (user?.full_name?.trim()?.[0] || user?.email?.[0] || '?').toUpperCase();
  const dotClass =
    desktop.transport === 'native'
      ? 'bg-emerald-500'
      : desktop.transport === 'http'
        ? 'bg-sky-500'
        : 'bg-muted-foreground/40';

  return (
    <button
      type="button"
      onClick={() =>
        window.alert(
          `User settings — coming soon\n\nSigned in as ${user?.email ?? 'guest'}\nDesktop: ${desktop.transport}`,
        )
      }
      title={user?.email ?? 'Account'}
      className="relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
    >
      {user?.avatar_url ? (
        <img src={user.avatar_url} alt="" className="size-full object-cover" />
      ) : (
        initial
      )}
      <span
        className={cn(
          'absolute -bottom-0 -right-0 size-2 rounded-full ring-2 ring-card',
          dotClass,
        )}
      />
    </button>
  );
}
