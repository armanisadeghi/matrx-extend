import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ broadcast: vi.fn(), on: vi.fn(() => () => undefined) }));

vi.mock('@/lib/messaging/native', () => native);
vi.mock('@/features/chat/AgentApprovalCard', () => ({
  AgentApprovalCard: ({ req }: { req: { callId: string } }) => (
    <div data-testid={`approval-${req.callId}`}>approval</div>
  ),
}));

import { useLocalBrowserApprovals } from '@/state/local-browser-approvals';
import { LocalBrowserApprovalHost } from './LocalBrowserApprovalHost';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  native.broadcast.mockReset();
  native.on.mockClear();
  useLocalBrowserApprovals.getState().clear();
});

describe('LocalBrowserApprovalHost', () => {
  it('removes an expired approval even if the service worker never sends a cancellation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00.000Z'));
    render(<LocalBrowserApprovalHost signedIn />);

    act(() => {
      useLocalBrowserApprovals.getState().show({
        approvalContextId: 'host-expiry',
        operation: 'navigate',
        origin: 'https://example.com',
        tier: 'action',
        deadlineMs: Date.now() + 1_000,
      });
    });
    expect(screen.getByTestId('approval-host-expiry')).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_001));

    expect(screen.queryByTestId('approval-host-expiry')).toBeNull();
    expect(native.broadcast).not.toHaveBeenCalled();
  });
});
