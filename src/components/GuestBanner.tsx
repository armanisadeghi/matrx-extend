import { Button } from '@/components/ui/button';
import { ENV } from '@/config/env';
import { useAuth } from '@/hooks/use-auth';
import { LogIn, Sparkles } from 'lucide-react';

/**
 * Slim banner shown to guests. Mounts at the top of ChatView (and any
 * other guest-visible surface). Two CTAs:
 *   - Sign in — runs the standard OAuth flow in-place.
 *   - Sign up free — opens aimatrx.com in a new tab.
 *
 * Renders nothing while the auth status is still resolving, and once the
 * user is signed in.
 */
export function GuestBanner() {
  const { user, status, signIn } = useAuth();
  if (user) return null;
  if (status === 'unknown') return null;

  const openSignup = () => {
    void chrome.tabs.create({ url: ENV.FRONTEND_URL });
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
      <Sparkles className="size-3.5 text-amber-500" />
      <span className="flex-1 text-muted-foreground">
        You're using Matrx as a guest.{' '}
        <span className="hidden sm:inline">
          Sign up free to unlock everything.
        </span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={signIn}
        disabled={status === 'signing-in'}
      >
        <LogIn className="size-3" /> Sign in
      </Button>
      <Button size="sm" className="h-6 px-2 text-xs" onClick={openSignup}>
        Sign up free
      </Button>
    </div>
  );
}
