/**
 * A capture-list read can fail before a workspace is selected. Once the
 * person selects one, that old remedy is complete and must stop covering the
 * live panel. A separate database refusal still needs its own notice.
 */
import { NoticeHost } from '@/components/NoticeHost';
import { failDbCall } from '@/lib/supabase/db-failure';
import { pushNotice, useNoticeStore } from '@/state/notices';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const org = vi.hoisted(() => ({
  selected: null as string | null,
  listeners: new Set<(organizationId: string | null) => void>(),
}));

vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => org.selected,
  onActiveOrganizationChange: (listener: (organizationId: string | null) => void) => {
    org.listeners.add(listener);
    return () => org.listeners.delete(listener);
  },
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => undefined }));
vi.mock('@/lib/debug/log', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/telemetry/external-reporting', () => ({
  mayReportExternalTelemetry: async () => false,
}));

const WORKSPACE_ID = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
const CAPTURE_LIST = {
  table: 'media.capture_handoff',
  operation: 'select' as const,
  what: 'check which pages need your browser',
  title: 'Capture list unavailable',
};

function announceMissingWorkspace() {
  expect(() =>
    failDbCall(CAPTURE_LIST, { code: 'NO_ORGANIZATION', message: 'no organization selected' }),
  ).toThrow();
}

beforeEach(() => {
  org.selected = null;
  org.listeners.clear();
  useNoticeStore.getState().clear();
});

afterEach(() => {
  cleanup();
  org.listeners.clear();
  useNoticeStore.getState().clear();
});

describe('resolved notices', () => {
  it('retires a no-workspace refusal after selection while preserving an unrelated error', async () => {
    announceMissingWorkspace();
    pushNotice({
      tone: 'error',
      title: 'Saved capture unavailable',
      message: 'The saved capture could not be read. Try again later.',
    });
    render(<NoticeHost />);
    expect(
      screen.getByText(/no workspace is selected, so the request was never sent/i),
    ).toBeTruthy();
    expect(screen.getByText('Saved capture unavailable')).toBeTruthy();

    await act(async () => {
      org.selected = WORKSPACE_ID;
      for (const listener of org.listeners) listener(WORKSPACE_ID);
    });

    await waitFor(() =>
      expect(
        screen.queryByText(/no workspace is selected, so the request was never sent/i),
      ).toBeNull(),
    );
    expect(screen.getByText('Saved capture unavailable')).toBeTruthy();
  });

  it('retires a late no-workspace refusal when a workspace is already selected', async () => {
    org.selected = WORKSPACE_ID;
    render(<NoticeHost />);
    act(() => announceMissingWorkspace());

    await waitFor(() =>
      expect(
        screen.queryByText(/no workspace is selected, so the request was never sent/i),
      ).toBeNull(),
    );
    expect(useNoticeStore.getState().notices).toHaveLength(0);
  });
});
