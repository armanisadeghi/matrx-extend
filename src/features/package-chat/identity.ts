import { sessionCredentials } from '@/lib/api/session-credentials';
import type { ChatIdentity, ChatIdentityPort } from '@ai-matrx/chat/host';

/** Carry the extension transport's guest identity into the package's execution gate. */
export async function createExtensionChatIdentity(
  base: ChatIdentityPort,
  onFailure: (error: unknown) => void,
): Promise<ChatIdentityPort> {
  let snapshot = base.current();
  const listeners = new Set<() => void>();
  let pending: Promise<void> | null = null;
  const publish = (next: ChatIdentity) => {
    if (
      Object.keys(next).every(
        (key) => next[key as keyof ChatIdentity] === snapshot[key as keyof ChatIdentity],
      )
    )
      return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const refresh = (): Promise<void> => {
    if (pending) return pending;
    pending = (async () => {
      await sessionCredentials.ready?.();
      await base.getAccessToken();
      const credential = await sessionCredentials.get();
      const identity = base.current();
      if (!credential || (credential.kind !== 'user' && credential.kind !== 'guest'))
        throw new Error('Chat session credentials are unavailable.');
      // Never turn a signed-in session with a missing bearer into a guest.
      // sessionCredentials owns that refusal and the single per-install fingerprint.
      if (identity.accessToken !== (credential.kind === 'user' ? credential.accessToken : null))
        throw new Error('Chat session changed while its identity was being read.');
      publish({
        ...identity,
        fingerprintId: credential.kind === 'guest' ? credential.fingerprintId || null : null,
      });
    })()
      .catch((error: unknown) => {
        publish({ ...snapshot, accessToken: null, fingerprintId: null, authReady: false });
        throw error;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
  await refresh();
  const onChange = () => {
    void refresh().catch(onFailure);
  };
  let stopBase: (() => void) | null = null;
  return {
    current: () => snapshot,
    subscribe(listener) {
      if (listeners.size === 0) {
        stopBase = base.subscribe(onChange);
        chrome.storage.onChanged.addListener(onChange);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopBase?.();
          stopBase = null;
          chrome.storage.onChanged.removeListener(onChange);
        }
      };
    },
    async getAccessToken() {
      await refresh();
      return snapshot.accessToken;
    },
  };
}
