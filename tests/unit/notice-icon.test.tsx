/** An info notice ("Source filed") wears the info icon and is a polite status; errors and warnings keep the triangle. */
import { NoticeHost } from '@/components/NoticeHost';
import { pushNotice, useNoticeStore } from '@/state/notices';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => null,
  onActiveOrganizationChange: () => () => undefined,
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => undefined }));

beforeEach(() => useNoticeStore.setState({ notices: [] } as never));
afterEach(cleanup);

describe('NoticeHost icons follow the tone', () => {
  it('info → info icon, role status', () => {
    render(<NoticeHost />);
    act(() => {
      pushNotice({ tone: 'info', title: 'Source filed', message: 'Filed in Launch plan.' });
    });
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('Source filed');
    expect(notice.querySelector('[data-icon="info"]')).not.toBeNull();
    expect(notice.querySelector('[data-icon="warning"]')).toBeNull();
  });

  it('error and warning keep the triangle and role alert', () => {
    render(<NoticeHost />);
    act(() => {
      pushNotice({ tone: 'error', title: 'Not filed', message: 'Refused.' });
      pushNotice({ tone: 'warning', title: 'Heads up', message: 'Careful.' });
    });
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    for (const a of alerts) expect(a.querySelector('[data-icon="warning"]')).not.toBeNull();
  });
});
