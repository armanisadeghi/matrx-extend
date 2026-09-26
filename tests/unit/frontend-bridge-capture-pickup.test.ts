/**
 * THE WIRE CONTRACT for `captureHandoff.pickUp` — the frontend bridge action
 * the web app's capture tray calls when it wants THIS browser to open the page
 * it is shouting about.
 *
 * The contract is contractual across repos (matrx-frontend calls it), so these
 * assertions are deliberately literal about the result's shape and about what
 * the action REFUSES: an unsigned-in browser, and an organization the signed-in
 * person is not an active member of. The caller's organization id is never
 * trusted on its own.
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
import { readFreshCapturePickup } from '@/lib/capture-ladder/pickup';
import { countNeedsYou } from '@/lib/capture-ladder/queue';
import { FRONTEND_RPC_CHANNEL, handleFrontendRpc } from '@/lib/frontend-bridge/handler';
import {
  getActiveOrganizationId,
  listMemberOrganizations,
  selectActiveOrganization,
} from '@/lib/org/active-org';

const AI_MATRX = '5dc930e9-bd65-44a1-8369-af773f6e1a5b';
const WORKSPACE = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
/**
 * The sender the real listener builds. `tabId`/`windowId` come from
 * `sender.tab` and are GESTURE-CRITICAL: they are what lets the handler call
 * `chrome.sidePanel.open()` before its first `await`. A sender without them is
 * the Broadcast path, which has no gesture — see
 * `tests/unit/frontend-bridge-panel-gesture.test.ts`.
 */
const allowedSender = {
  url: 'https://demos.aimatrx.com/demos/tests/extension-bridge',
  tabId: 41,
  windowId: 7,
};

const sent: unknown[] = [];

function envelope(payload: unknown) {
  return {
    channel: FRONTEND_RPC_CHANNEL,
    action: 'captureHandoff.pickUp',
    payload,
    requestId: 'req-pickup',
  };
}

describe('captureHandoff.pickUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    const chromeGlobal = globalThis.chrome as typeof chrome;
    chromeGlobal.runtime = {
      getManifest: () => ({ version: '9.8.7' }),
      sendMessage: (msg: unknown) => {
        sent.push(msg);
        return Promise.resolve();
      },
    } as unknown as typeof chrome.runtime;
    chromeGlobal.tabs = {
      query: async () => [{ windowId: 7 }],
    } as unknown as typeof chrome.tabs;
    chromeGlobal.sidePanel = { open: async () => undefined } as unknown as typeof chrome.sidePanel;

    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(listMemberOrganizations).mockResolvedValue([
      { id: AI_MATRX, name: 'AI Matrx' },
      { id: WORKSPACE, name: "admin's Workspace" },
    ]);
    vi.mocked(getActiveOrganizationId).mockResolvedValue(WORKSPACE);
    vi.mocked(countNeedsYou).mockResolvedValue(3);
  });

  it('switches the organization, points at the page, and reports the exact result shape', async () => {
    const response = await handleFrontendRpc(
      envelope({
        organizationId: AI_MATRX,
        handoffId: 'handoff-9',
        url: 'https://www.facebook.com/nasa',
      }),
      allowedSender,
    );

    expect(response).toEqual({
      ok: true,
      requestId: 'req-pickup',
      result: {
        organizationSwitched: true,
        organizationName: 'AI Matrx',
        panelOpened: true,
        panelReason: 'opened',
        waitingCount: 3,
      },
    });
    // The stored selection is written through the ONE resolver, never here.
    expect(vi.mocked(selectActiveOrganization)).toHaveBeenCalledWith({
      id: AI_MATRX,
      name: 'AI Matrx',
    });
    // The pointer the panel reads.
    await expect(readFreshCapturePickup()).resolves.toMatchObject({
      handoffId: 'handoff-9',
      url: 'https://www.facebook.com/nasa',
    });
    // A runtime hint an already-open panel actually listens for.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ __matrx: true, kind: 'capture:pick-up' });
  });

  it('says the organization did NOT change when it was already active', async () => {
    const response = await handleFrontendRpc(
      envelope({ organizationId: WORKSPACE }),
      allowedSender,
    );
    expect(response).toMatchObject({
      ok: true,
      result: { organizationSwitched: false, organizationName: "admin's Workspace" },
    });
  });

  it('never pretends the panel opened when Chrome refused', async () => {
    (globalThis.chrome as typeof chrome).sidePanel = {
      open: () =>
        Promise.reject(
          new Error('sidePanel.open() may only be called in response to a user gesture.'),
        ),
    } as unknown as typeof chrome.sidePanel;

    const response = await handleFrontendRpc(envelope({ organizationId: AI_MATRX }), allowedSender);
    expect(response).toMatchObject({
      ok: true,
      result: {
        panelOpened: false,
        panelReason: 'sidePanel.open() may only be called in response to a user gesture.',
      },
    });
  });

  it('refuses in plain English when nobody is signed in to the extension', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await handleFrontendRpc(envelope({ organizationId: AI_MATRX }), allowedSender);
    expect(response.ok).toBe(false);
    const error = (response as { error: string }).error;
    expect(error).toMatch(/signed in/i);
    expect(error).toMatch(/sign in/i);
    expect(vi.mocked(selectActiveOrganization)).not.toHaveBeenCalled();
  });

  it('never trusts the caller: refuses an organization the person is not a member of', async () => {
    const response = await handleFrontendRpc(
      envelope({ organizationId: '11111111-1111-4111-8111-111111111111' }),
      allowedSender,
    );
    expect(response.ok).toBe(false);
    expect((response as { error: string }).error).toMatch(/not an active member/i);
    expect(vi.mocked(selectActiveOrganization)).not.toHaveBeenCalled();
  });

  it('refuses a payload with no organization at all, and says what it needs', async () => {
    const response = await handleFrontendRpc(envelope({ handoffId: 'x' }), allowedSender);
    expect(response.ok).toBe(false);
    expect((response as { error: string }).error).toMatch(/organizationId/);
  });
});
