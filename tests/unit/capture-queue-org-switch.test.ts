/**
 * THE DEAD-LOOKING CLICK.
 *
 * A cold walk on 2026-09-19 pressed "Switch to {workspace}" in the Capture
 * panel. It worked: `chrome.storage.local` held the new selection before the
 * finger left the button. And the screen showed the OLD workspace's list for
 * eight seconds and more, until a poll tick happened to come round — so the
 * only thing a person could conclude was that the button is broken, and press
 * it again.
 *
 * A control that has already done its job and shows nothing is worse than a
 * control that is absent (law 4). The fix is not a faster poll: it is the
 * screen hearing about the change.
 *
 * ## Why the guard sits on the QUEUE and not on the button
 *
 * Every organization-scoped surface has this problem the moment anybody
 * switches workspace, and the switch does not always come from a button — the
 * frontend bridge switches it from the service worker when the web app hands
 * over a page. So the notification belongs to the ONE resolver that owns the
 * selection (`onActiveOrganizationChange`), and this test binds the consumer
 * that the walk caught: the capture queue must re-read AND move its live
 * subscription to the new workspace's topic. A subscription left on the old
 * topic is the quieter half of the same bug — it would go silent for good.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: vi.fn(),
  listMemberOrganizations: vi.fn(),
  onActiveOrganizationChange: vi.fn(),
}));
/**
 * A real query chain that answers "no rows" — NOT a stubbed `listNeedsYou`.
 * Stubbing the module's own export would have proved nothing: the subscription
 * calls the module-local function, so the stub would never have been reached
 * and the test would have passed against the broken code.
 */
const selects: string[] = [];
vi.mock('@/lib/supabase/schemas', () => ({
  mediaDb: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'neq']) {
        chain[m] = () => chain;
      }
      chain.order = () => Promise.resolve({ data: [], error: null });
      selects.push('query');
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/db-failure', () => ({ failDbCall: vi.fn() }));

const openedTopics: string[] = [];
const closedTopics: string[] = [];
vi.mock('@ai-matrx/realtime', () => ({
  defineChannelNamespace: () => ({
    topic: ({ organizationId }: { organizationId: string }) => `capture:${organizationId}`,
  }),
  onRealtimeManagerChange: (cb: (manager: unknown) => void) => {
    cb({
      open: ({ topic }: { topic: string }) => {
        openedTopics.push(topic);
        return {
          close: () => {
            closedTopics.push(topic);
          },
        };
      },
    });
    return () => {};
  },
}));

import { subscribeNeedsYou } from '@/lib/capture-ladder/queue';
import {
  getActiveOrganizationId,
  listMemberOrganizations,
  onActiveOrganizationChange,
} from '@/lib/org/active-org';

const OLD_ORG = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
const NEW_ORG = '5dc930e9-bd65-44a1-8369-af773f6e1a5b';

/** The callback the ONE resolver would invoke on a real storage change. */
let fireOrganizationChange: ((id: string | null) => void) | null = null;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe('switching workspace is visible immediately', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openedTopics.length = 0;
    closedTopics.length = 0;
    fireOrganizationChange = null;

    vi.mocked(onActiveOrganizationChange).mockImplementation((cb) => {
      fireOrganizationChange = cb;
      return () => {
        fireOrganizationChange = null;
      };
    });
    selects.length = 0;
    vi.mocked(getActiveOrganizationId).mockResolvedValue(OLD_ORG);
    vi.mocked(listMemberOrganizations).mockResolvedValue([
      { id: OLD_ORG, name: "admin's Workspace" },
      { id: NEW_ORG, name: 'AI Matrx' },
    ]);
  });

  it('re-reads the list the moment the workspace changes, not on the next poll', async () => {
    const seen: number[] = [];
    // A poll floor far beyond any patience — if this test passes on the timer
    // it has proved nothing.
    const stop = subscribeNeedsYou(() => seen.push(Date.now()), { pollMs: 600_000 });
    await flush();
    const readsBefore = selects.length;
    expect(readsBefore).toBeGreaterThan(0);
    expect(fireOrganizationChange, 'the queue never subscribed to the ONE resolver').not.toBeNull();

    vi.mocked(getActiveOrganizationId).mockResolvedValue(NEW_ORG);
    fireOrganizationChange?.(NEW_ORG);
    await flush();

    expect(
      selects.length,
      'the list did not re-read on the switch — the screen keeps showing the workspace you just left',
    ).toBeGreaterThan(readsBefore);
    stop();
  });

  it('moves the live subscription to the new workspace and closes the old one', async () => {
    const stop = subscribeNeedsYou(() => {}, { pollMs: 600_000 });
    await flush();
    expect(openedTopics).toEqual([`capture:${OLD_ORG}`]);

    vi.mocked(getActiveOrganizationId).mockResolvedValue(NEW_ORG);
    fireOrganizationChange?.(NEW_ORG);
    await flush();

    expect(
      openedTopics,
      'the live subscription stayed on the workspace we left — it would never speak again',
    ).toEqual([`capture:${OLD_ORG}`, `capture:${NEW_ORG}`]);
    expect(closedTopics).toContain(`capture:${OLD_ORG}`);
    stop();
  });

  it('stops listening for switches when the panel goes away', async () => {
    const stop = subscribeNeedsYou(() => {}, { pollMs: 600_000 });
    await flush();
    stop();
    expect(
      fireOrganizationChange,
      'the organization subscription outlived the panel — a leak, and a callback into a dead screen',
    ).toBeNull();
  });
});
