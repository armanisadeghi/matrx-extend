import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, LogIn } from 'lucide-react';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, status, error, signIn } = useAuth();

  if (user) return <>{children}</>;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="space-y-2">
        <div className="text-2xl font-semibold tracking-tight">Welcome to Matrx Extend</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          Sign in with your Matrx account to start chatting with agents, capturing pages, and
          syncing your work across devices.
        </p>
      </div>
      <Button
        onClick={signIn}
        disabled={status === 'signing-in'}
        size="lg"
        className="rounded-full"
      >
        {status === 'signing-in' ? (
          <>
            <Loader2 className="animate-spin" /> Opening sign-in…
          </>
        ) : (
          <>
            <LogIn /> Sign in with Matrx
          </>
        )}
      </Button>
      {error && (
        <div className="max-w-sm rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
