/** Safari OAuth tab transport. Apple does not implement the identity API. */

import { ALARMS, ENV, STORAGE_KEYS } from '@/config/env';
import { completeSignInFromCallback, signInWithOpener } from '@/lib/auth/flow';
import type { UserProfile } from '@/lib/auth/types';
import { BROWSER } from '@/lib/browser/detect';
import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { checkIsAdmin } from '@/lib/supabase/queries';

const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

interface SafariAttempt {
  attemptId: string;
  state: string;
  tabId: number;
  redirectUri: string;
  createdAt: number;
  claimed?: boolean;
}

/**
 * Callback waiters for the sign-in running in THIS background context, keyed by state. The OAuth
 * client (`@ai-matrx/auth/matrx-oauth`) owns the verifier, state check and token exchange; this
 * file owns only the tab: it hands the client the callback URL once the tab lands on it. If the
 * background context is torn down mid-sign-in the waiter is gone and the callback fails the
 * attempt with a retryable message (see handleCallback).
 */
const waiters = new Map<string, { resolve: (url: string) => void; reject: (e: Error) => void }>();

function authorizeUrl(): string {
  return `${ENV.SUPABASE_URL}/auth/v1/oauth/authorize`;
}

async function readAttempt(): Promise<SafariAttempt | null> {
  const row = await chrome.storage.session.get([STORAGE_KEYS.SAFARI_AUTH_ATTEMPT]);
  const attempt = row[STORAGE_KEYS.SAFARI_AUTH_ATTEMPT] as SafariAttempt | undefined;
  return attempt && typeof attempt.tabId === 'number' ? attempt : null;
}

async function clearAttempt(attempt: SafariAttempt, failure?: string): Promise<void> {
  const current = await readAttempt();
  if (!current || current.attemptId !== attempt.attemptId) return;
  await chrome.alarms.clear(ALARMS.SAFARI_AUTH_TIMEOUT).catch(() => undefined);
  await chrome.storage.session.remove([STORAGE_KEYS.SAFARI_AUTH_ATTEMPT]);
  waiters.get(attempt.state)?.reject(new Error(failure ?? 'Sign-in was cancelled.'));
  waiters.delete(attempt.state);
  if (failure) {
    await chrome.storage.session.set({ [STORAGE_KEYS.SAFARI_AUTH_FAILURE]: failure });
    broadcast(CHANNELS.AUTH_SAFARI_FAILED, { message: failure });
  }
}

async function closeOwnedAuthTab(attempt: SafariAttempt): Promise<void> {
  try {
    const tab = await chrome.tabs.get(attempt.tabId);
    if (!tab.url) return;
    const current = new URL(tab.url);
    const authorize = new URL(authorizeUrl());
    const callback = new URL(attempt.redirectUri);
    if (
      (current.origin === authorize.origin && current.pathname.startsWith('/auth/v1/oauth/')) ||
      (current.origin === callback.origin && current.pathname === callback.pathname)
    ) {
      await chrome.tabs.remove(attempt.tabId);
    }
  } catch {
    // The tab may have been closed or moved before cancellation completed.
  }
}

async function failAttempt(
  attempt: SafariAttempt,
  message: string,
  closeTab = false,
): Promise<void> {
  await clearAttempt(attempt, message);
  if (closeTab) await chrome.tabs.remove(attempt.tabId).catch(() => undefined);
}

export async function startSafariAuthorization(): Promise<{ pending: true }> {
  if (BROWSER !== 'safari') throw new Error('Safari authorization is unavailable in this browser');
  if (!ENV.SAFARI_OAUTH_CLIENT_ID)
    throw new Error('Safari OAuth client configuration is unavailable');

  const previous = await readAttempt();
  if (previous) {
    await clearAttempt(previous);
    await closeOwnedAuthTab(previous);
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  if (tab.id === undefined) throw new Error('Could not create the Safari sign-in tab');
  try {
    void signInWithOpener(async (url, { state, redirectUri }) => {
      const attempt: SafariAttempt = {
        attemptId: `oauth:${state}`,
        state,
        tabId: tab.id as number,
        redirectUri,
        createdAt: Date.now(),
      };
      const callback = new Promise<string>((resolve, reject) => {
        waiters.set(state, { resolve, reject });
      });
      await chrome.storage.session.set({ [STORAGE_KEYS.SAFARI_AUTH_ATTEMPT]: attempt });
      await chrome.storage.session.remove([STORAGE_KEYS.SAFARI_AUTH_FAILURE]);
      chrome.alarms.create(ALARMS.SAFARI_AUTH_TIMEOUT, {
        when: attempt.createdAt + AUTH_TIMEOUT_MS,
      });
      await chrome.tabs.update(attempt.tabId, { url });
      log.info('auth', 'Safari OAuth sign-in tab opened', { callbackOrigin: redirectUri });
      return callback;
    }).then(
      (result) => completeSafariSignIn(tab.id as number, result.user),
      (error) => failCurrentAttempt(tab.id as number, error),
    );
  } catch (error) {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
    throw error;
  }
  return { pending: true };
}

async function handleCallback(tabId: number, callbackUrl: string): Promise<void> {
  const attempt = await readAttempt();
  if (!attempt || attempt.tabId !== tabId || attempt.claimed) return;
  if (Date.now() > attempt.createdAt + AUTH_TIMEOUT_MS) {
    await failAttempt(attempt, 'Sign-in timed out. Please try again.');
    return;
  }
  let received: URL;
  let expected: URL;
  try {
    received = new URL(callbackUrl);
    expected = new URL(attempt.redirectUri);
  } catch {
    return;
  }
  if (received.origin !== expected.origin || received.pathname !== expected.pathname) return;
  const state = received.searchParams.get('state');
  const code = received.searchParams.get('code');
  if (!state || state !== attempt.state) return;
  if (received.searchParams.has('error')) {
    await failAttempt(attempt, 'Sign-in was cancelled or rejected. Please try again.');
    return;
  }
  if (!code) {
    await failAttempt(attempt, 'Sign-in could not verify its callback. Please try again.', true);
    return;
  }
  await chrome.storage.session.set({
    [STORAGE_KEYS.SAFARI_AUTH_ATTEMPT]: { ...attempt, claimed: true },
  });
  const waiter = waiters.get(attempt.state);
  if (waiter) {
    waiter.resolve(callbackUrl);
    return;
  }
  // The background context that started this sign-in was torn down; the package still holds the
  // PKCE verifier for this state in chrome.storage.session, so finish from the captured redirect.
  void completeSignInFromCallback(callbackUrl).then(
    (result) => completeSafariSignIn(attempt.tabId, result.user),
    (error) => failCurrentAttempt(attempt.tabId, error),
  );
}

async function completeSafariSignIn(tabId: number, user: UserProfile): Promise<void> {
  const attempt = await readAttempt();
  if (!attempt || attempt.tabId !== tabId) return;
  waiters.delete(attempt.state);
  await clearAttempt(attempt);
  // A failed role read is unknown, never a confirmed non-admin result. The
  // receiving UI rechecks from canonical storage and shows a retryable role
  // warning if the read is still unavailable.
  const isAdmin = (await checkIsAdmin(user.id)) === true;
  broadcast(CHANNELS.AUTH_STATE_CHANGED, { user, isAdmin, reason: 'safari_sign_in' });
  await chrome.tabs.remove(tabId).catch(() => undefined);
}

async function failCurrentAttempt(tabId: number, error: unknown): Promise<void> {
  log.warn('auth', 'Safari OAuth completion failed', { reason: (error as Error).name });
  const attempt = await readAttempt();
  if (!attempt || attempt.tabId !== tabId) return;
  waiters.delete(attempt.state);
  await failAttempt(attempt, 'Sign-in could not be completed. Please try again.', true);
}

export function registerSafariAuthorizationBackground(): void {
  if (BROWSER !== 'safari') return;
  on<undefined, { pending: true }>(CHANNELS.AUTH_SAFARI_START, () => startSafariAuthorization());
  on<undefined, { ok: true }>(CHANNELS.AUTH_SAFARI_CANCEL, async () => {
    const attempt = await readAttempt();
    if (attempt) {
      await clearAttempt(attempt);
      await closeOwnedAuthTab(attempt);
    }
    return { ok: true };
  });
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) void handleCallback(details.tabId, details.url);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void readAttempt().then((attempt) => {
      if (attempt?.tabId === tabId) void failAttempt(attempt, 'Sign-in was cancelled.');
    });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARMS.SAFARI_AUTH_TIMEOUT) return;
    void readAttempt().then((attempt) => {
      if (attempt) void failAttempt(attempt, 'Sign-in timed out. Please try again.');
    });
  });
}
