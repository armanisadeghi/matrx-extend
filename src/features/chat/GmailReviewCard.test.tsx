import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const respondToAsk = vi.fn();
const sendReviewedGmail = vi.fn();
const removeAsk = vi.fn();

vi.mock('@/hooks/use-tool-inbox', () => ({ respondToAsk: (...a: unknown[]) => respondToAsk(...a) }));
vi.mock('@/lib/api/routes/google-workspace', () => ({
  sendReviewedGmail: (...a: unknown[]) => sendReviewedGmail(...a),
}));
vi.mock('@/state/tool-inbox', () => ({
  useToolInbox: { getState: () => ({ removeAsk }) },
}));

import type { PendingAskUserRequest } from '@/lib/tools/types';
import { GmailReviewCard } from './GmailReviewCard';

let seq = 0;
// The package remembers sent receipts per callId, so every test gets its own.
const req = (over: Partial<PendingAskUserRequest> = {}): PendingAskUserRequest =>
  ({
    callId: `call-${++seq}`,
    kind: 'email_review',
    email: {
      connectionId: 'conn-1',
      fromEmail: 'me@example.com',
      to: 'a@example.com',
      cc: ['c@example.com'],
      subject: 'Hello',
      body: 'Body text',
    },
    ...over,
  }) as PendingAskUserRequest;

beforeEach(() => {
  respondToAsk.mockReset();
  sendReviewedGmail.mockReset();
  removeAsk.mockReset();
});
afterEach(cleanup);

describe('GmailReviewCard (door to @ai-matrx/chat)', () => {
  it('sends nothing, and resolves nothing, until a click', async () => {
    render(<GmailReviewCard req={req()} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(sendReviewedGmail).not.toHaveBeenCalled();
    expect(respondToAsk).not.toHaveBeenCalled();
  });

  it('Send: posts the edited bytes, then resolves with the exact legacy payload', async () => {
    sendReviewedGmail.mockResolvedValue({ ok: true, status: 200, data: { message_id: 'm-9' } });
    render(<GmailReviewCard req={req()} />);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Hello edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(respondToAsk).toHaveBeenCalledTimes(1));
    expect(sendReviewedGmail).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      to: 'a@example.com',
      cc: ['c@example.com'],
      subject: 'Hello edited',
      body: 'Body text',
    });
    expect(respondToAsk.mock.calls[0]![0]).toMatch(/^call-\d+$/);
    expect(JSON.stringify(respondToAsk.mock.calls[0]![1])).toBe(
      JSON.stringify({
        confirmed: true,
        sent_email: {
          message_id: 'm-9',
          to: 'a@example.com',
          cc: ['c@example.com'],
          subject: 'Hello edited',
          edited: true,
        },
      }),
    );
  });

  it('Send unedited reports edited:false', async () => {
    sendReviewedGmail.mockResolvedValue({ ok: true, status: 200, data: { message_id: 'm-1' } });
    render(<GmailReviewCard req={req()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(respondToAsk).toHaveBeenCalledTimes(1));
    expect((respondToAsk.mock.calls[0]![1] as { sent_email: { edited: boolean } }).sent_email.edited).toBe(false);
  });

  it("Don't send resolves exactly { confirmed: false } and never sends", () => {
    render(<GmailReviewCard req={req()} />);
    fireEvent.click(screen.getByRole('button', { name: "Don't send" }));
    expect(JSON.stringify(respondToAsk.mock.calls[0]![1])).toBe(JSON.stringify({ confirmed: false }));
    expect(respondToAsk).toHaveBeenCalledTimes(1);
    expect(sendReviewedGmail).not.toHaveBeenCalled();
  });

  it('Dismiss resolves exactly { cancelled: true } and never sends', () => {
    render(<GmailReviewCard req={req()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(JSON.stringify(respondToAsk.mock.calls[0]![1])).toBe(JSON.stringify({ cancelled: true }));
    expect(respondToAsk).toHaveBeenCalledTimes(1);
    expect(sendReviewedGmail).not.toHaveBeenCalled();
  });

  it('a failed send keeps the card open, says nothing was sent, and does not resolve', async () => {
    sendReviewedGmail.mockResolvedValue({ ok: false, status: 500, error: 'boom' });
    render(<GmailReviewCard req={req()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Send failed \(500\)\. boom/);
    expect(screen.getByText(/Nothing was sent/)).toBeTruthy();
    expect(respondToAsk).not.toHaveBeenCalled();
  });

  it('401 shows the sign-in text', async () => {
    sendReviewedGmail.mockResolvedValue({ ok: false, status: 401, error: 'x' });
    render(<GmailReviewCard req={req()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Sign in to AI Matrx to send from your connected Google account\./);
    expect(respondToAsk).not.toHaveBeenCalled();
  });

  it('an expired ask is removed from the inbox, not sent', async () => {
    const r = req({ expires_at_ms: Date.now() - 1 });
    render(<GmailReviewCard req={r} />);
    await waitFor(() => expect(removeAsk).toHaveBeenCalledWith(r.callId));
    expect(sendReviewedGmail).not.toHaveBeenCalled();
    expect(respondToAsk).not.toHaveBeenCalled();
  });

  it('renders nothing without a draft', () => {
    const { container } = render(<GmailReviewCard req={req({ email: undefined })} />);
    expect(container.innerHTML).toBe('');
  });
});
