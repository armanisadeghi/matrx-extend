import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ callbacks: new Map<string, (p: any) => unknown>(), broadcast: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/messaging/native', () => ({ on: (kind: string, callback: (p: any) => unknown) => { h.callbacks.set(kind, callback); return () => h.callbacks.delete(kind); }, broadcast: (...args: unknown[]) => h.broadcast(...args) }));
vi.mock('@/lib/tools/dispatch-persist', () => ({ listPendingConfirms: () => h.list() }));
import { SavedReplayApprovalHost } from '@/features/showcase/SavedReplayApprovalHost';
import { CHANNELS } from '@/lib/messaging/schemas';
afterEach(() => { cleanup(); vi.clearAllMocks(); h.callbacks.clear(); });
it('remount restores a pending local request and can send a terminal answer', async () => {
  h.list.mockResolvedValue([{ callId: 'restored', toolName: 'data_patterns', args: { action: 'run', pattern_id: 'saved' }, effectiveTier: 'privileged', expiresAt: Date.now() + 1000, preparedOperation: { delivery: 'local' } }]);
  render(<SavedReplayApprovalHost signedIn />);
  await screen.findByText('data_patterns');
  await userEvent.click(screen.getByRole('button', { name: /deny/i }));
  await waitFor(() => expect(h.broadcast).toHaveBeenCalledWith(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: 'restored', decision: 'deny' }));
});
it('worker restart expiry is visible and removes the recovered card', async () => {
  h.list.mockResolvedValue([{ callId: 'restored', toolName: 'data_patterns', args: {}, effectiveTier: 'privileged', expiresAt: Date.now() + 1000, preparedOperation: { delivery: 'local' } }]);
  render(<SavedReplayApprovalHost signedIn />); await screen.findByText('data_patterns');
  const { act } = await import('@testing-library/react');
  await act(async () => { h.callbacks.get(CHANNELS.TOOL_CONFIRM_EXPIRED)?.({ callId: 'restored', reason: 'The replay connection ended. Run again.' }); });
  expect((await screen.findByRole('status')).textContent).toContain('connection ended');
  expect(screen.queryByText('data_patterns')).toBeNull();
});
