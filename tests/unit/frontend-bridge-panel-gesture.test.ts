/**
 * THE ORDERING LAW that makes the extension's panel open by itself.
 *
 * Chrome hands an inbound extension message a user-gesture token and spends it
 * at the FIRST `await` of the listener's turn. So `chrome.sidePanel.open()`
 * must be invoked before the handler reads anything — the signed-in user, the
 * person's organizations, chrome.storage — or Chrome refuses with
 * *"`sidePanel.open()` may only be called in response to a user gesture."*
 *
 * That refusal was shipped for a day as a platform limit and written into three
 * repos' comments. It was our own ordering. This guard is the thing that stops
 * it coming back, because the mistake is invisible: the handler still returns
 * `ok: true`, the hand-off still happens, and only the panel silently does not
 * appear.
 *
 * 🚨 THE FAKE CHROME BELOW ENFORCES THE REAL RULE, not a convenient one. It
 * refuses `sidePanel.open()` the moment any other chrome API has been awaited
 * in the same turn, exactly as Chrome 153 does (measured sixteen ways in
 * `tests/browser/side-panel-gesture-spike.mjs`). Move the `open()` call back
 * below the reads and these tests fail, which is what happened when the guard
 * was written against the pre-fix handler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/is-admin', () => ({ readIsAdminFromStorage: vi.fn() }));
vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/settings/persisted', () => ({ readDefaultPermissionMode: vi.fn() }));
vi.mock('@/lib/tools/descriptions', () => ({ ensureToolDescriptions: vi.fn() }));
vi.mock('@/lib/tools/dispatch', () => ({ handleWebmcpCall: vi.fn() }));
vi.mock('@/lib/tools/registry', () => ({ listAllHandlers: vi.fn() }));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: vi.fn(),
  listMemberOrganizations: vi.fn(),
  selectActiveOrganization: vi.fn(),
}));
vi.mock('@/lib/capture-ladder/queue', () => ({ countNeedsYou: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/flow';
import { countNeedsYou } from '@/lib/capture-ladder/queue';
import { FRONTEND_RPC_CHANNEL, handleFrontendRpc } from '@/lib/frontend-bridge/handler';
import {
  GESTURE_PANEL_ACTIONS,
  openPanelInGesture,
  settlePanelOpen,
} from '@/lib/frontend-bridge/panel-gesture';
import {
  getActiveOrganizationId,
  listMemberOrganizations,
  selectActiveOrganization,
} from '@/lib/org/active-org';

const AI_MATRX = '5dc930e9-bd65-44a1-8369-af773f6e1a5b';
const WORKSPACE = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';

/** Chrome's own words, so a diff in the message is a diff in the test. */
const GESTURE_REFUSAL = '`sidePanel.open()` may only be called in response to a user gesture.';

/** What the real listener passes down from `sender.tab`. */
const gestureSender = {
  url: 'https://aimatrx.com/capture/needs-you',
  origin: 'https://aimatrx.com',
  tabId: 41,
  windowId: 7,
};

/** Every chrome call, in the order it happened. */
let callOrder: string[] = [];
/** Flipped by the first awaited chrome API, exactly like Chrome spends the token. */
let gestureSpent = false;

function installFakeChrome(): void {
  callOrder = [];
  gestureSpent = false;
  const spend = async <T>(name: string, value: T): Promise<T> => {
    callOrder.push(name);
    await Promise.resolve();
    gestureSpent = true;
    return value;
  };
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '9.8.7' }),
      sendMessage: (msg: unknown) => {
        callOrder.push('runtime.sendMessage');
        void msg;
        return Promise.resolve();
      },
    },
    tabs: {
      query: () => spend('tabs.query', [{ id: 41, windowId: 7 }]),
    },
    sidePanel: {
      open: (opts: { windowId?: number; tabId?: number }) => {
        callOrder.push(`sidePanel.open(${opts.windowId !== undefined ? 'window' : 'tab'})`);
        // THE RULE. Chrome does not care how long ago the click was; it cares
        // whether this turn has already yielded.
        if (gestureSpent) return Promise.reject(new Error(GESTURE_REFUSAL));
        return Promise.resolve();
      },
    },
    storage: {
      local: {
        get: () => spend('storage.get', {}),
        set: () => spend('storage.set', undefined),
      },
    },
  } as unknown as typeof chrome;
}

describe('the side panel opens on the gesture the web app hands us', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installFakeChrome();
    // Every read the pickUp handler makes is an await, and each one would have
    // spent the gesture if it ran first.
    vi.mocked(getCurrentUser).mockImplementation(async () => {
      callOrder.push('getCurrentUser');
      await Promise.resolve();
      gestureSpent = true;
      return { id: 'user-1' } as never;
    });
    vi.mocked(listMemberOrganizations).mockImplementation(async () => {
      callOrder.push('listMemberOrganizations');
      await Promise.resolve();
      gestureSpent = true;
      return [
        { id: AI_MATRX, name: 'AI Matrx', isPersonal: false },
        { id: WORKSPACE, name: "admin's Workspace", isPersonal: true },
      ];
    });
    vi.mocked(getActiveOrganizationId).mockResolvedValue(WORKSPACE);
    vi.mocked(selectActiveOrganization).mockResolvedValue(undefined as never);
    vi.mocked(countNeedsYou).mockResolvedValue(2);
  });

  it('opens the panel BEFORE it reads anything, so Chrome still allows it', async () => {
    const response = await handleFrontendRpc(
      {
        channel: FRONTEND_RPC_CHANNEL,
        action: 'captureHandoff.pickUp',
        payload: { organizationId: AI_MATRX, handoffId: 'h-1', url: 'https://example.com/a' },
        requestId: 'req-1',
      },
      gestureSender,
    );

    expect(response).toMatchObject({
      ok: true,
      result: { panelOpened: true, panelReason: 'opened' },
    });

    // The invariant itself: the open is the FIRST thing that happens.
    const opened = callOrder.findIndex((c) => c.startsWith('sidePanel.open'));
    expect(opened).toBe(0);
    for (const read of ['getCurrentUser', 'listMemberOrganizations']) {
      expect(callOrder.indexOf(read)).toBeGreaterThan(opened);
    }
  });

  it('never asks chrome.tabs which window it is — that question was the bug', async () => {
    await handleFrontendRpc(
      {
        channel: FRONTEND_RPC_CHANNEL,
        action: 'captureHandoff.pickUp',
        payload: { organizationId: AI_MATRX },
        requestId: 'req-2',
      },
      gestureSender,
    );
    // `chrome.tabs.query` is an await. Asking it to find the window spent the
    // gesture before `open()` was reached — the whole defect, in one line.
    expect(callOrder).not.toContain('tabs.query');
  });

  it('opens the panel on openPanel too, from the same gesture', async () => {
    const response = await handleFrontendRpc(
      {
        channel: FRONTEND_RPC_CHANNEL,
        action: 'openPanel',
        payload: { panelId: 'capture' },
        requestId: 'req-3',
      },
      gestureSender,
    );
    expect(response).toMatchObject({ ok: true, result: { opened: true, reason: 'opened' } });
    expect(callOrder[0]).toBe('sidePanel.open(window)');
  });

  it('opens nothing for an origin it would have refused', async () => {
    const response = await handleFrontendRpc(
      {
        channel: FRONTEND_RPC_CHANNEL,
        action: 'captureHandoff.pickUp',
        payload: { organizationId: AI_MATRX },
        requestId: 'req-4',
      },
      { ...gestureSender, url: 'https://not-ours.example.com/x' },
    );
    expect(response).toMatchObject({ ok: false, error: 'origin not allowed' });
    expect(callOrder).toEqual([]);
  });

  it('says so honestly when there is no gesture to stand on', async () => {
    // The Supabase Broadcast path: same envelope, no tab, no click.
    const response = await handleFrontendRpc(
      {
        channel: FRONTEND_RPC_CHANNEL,
        action: 'captureHandoff.pickUp',
        payload: { organizationId: AI_MATRX },
        requestId: 'req-5',
      },
      {},
    );
    expect(response).toMatchObject({
      ok: true,
      result: { panelOpened: false, panelReason: 'no-gesture-sender' },
    });
    expect(callOrder.some((c) => c.startsWith('sidePanel.open'))).toBe(false);
  });

  it('reports Chrome’s refusal verbatim rather than inventing one', async () => {
    gestureSpent = true; // as if an await had already happened
    const outcome = await settlePanelOpen(openPanelInGesture({ windowId: 7 }));
    expect(outcome).toEqual({ panelOpened: false, panelReason: GESTURE_REFUSAL });
  });

  it('keeps the gesture-critical action list in step with the handler', () => {
    expect([...GESTURE_PANEL_ACTIONS].sort()).toEqual(['captureHandoff.pickUp', 'openPanel']);
  });
});
