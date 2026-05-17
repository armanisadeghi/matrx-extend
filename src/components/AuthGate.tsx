import { useAuth } from '@/hooks/use-auth';

/**
 * Pass-through wrapper. Kept as a named component so existing call sites
 * (sidepanel App.tsx) don't need to change. As of the guest-mode rollout
 * (2026-05-16) the extension never blocks on sign-in — the SW resolves
 * the caller via X-Fingerprint-ID when there's no Supabase session, so
 * Chat and the always-allowed tabs render for guests too.
 *
 * The actual "you're using Matrx as a guest" UI lives in
 * src/components/GuestBanner.tsx and is mounted by the views that want
 * to surface the upgrade CTA (currently ChatView). Sign-in is still
 * available from the user menu.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  // Eager-boot the auth hook here so the one-time boot (restore Supabase
  // session, refresh admin flag) still runs on cold sidepanel open even if
  // no other early component subscribes. The hook is internally guarded
  // against double boot.
  useAuth();
  return <>{children}</>;
}
