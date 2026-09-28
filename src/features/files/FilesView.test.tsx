import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  files: vi.fn(),
  captures: vi.fn(),
  user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock('@/state/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: { selectedConversationId: null }) => unknown) =>
      selector({ selectedConversationId: null }),
    { getState: () => ({ selectedConversationId: null }) },
  ),
}));
vi.mock('./data', () => ({
  fetchRecentFiles: mocks.files,
  fetchRecentExtensionCaptures: mocks.captures,
}));

import { FilesView } from './FilesView';

beforeEach(() => {
  mocks.files.mockReset().mockResolvedValue([]);
  mocks.captures.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe('FilesView inventory reads', () => {
  it.each([
    ['library', 'Library', 'No library files yet'],
    ['captures', 'Screenshots', 'No captures yet'],
  ] as const)('shows a %s read failure without claiming an empty collection, then recovers', async (source, tab, emptyText) => {
    const failedRead = source === 'library' ? mocks.files : mocks.captures;
    failedRead.mockRejectedValueOnce(new Error('Inventory read unavailable.'));
    render(<FilesView />);

    const tabTrigger = screen.getByRole('tab', { name: new RegExp(tab) });
    fireEvent.mouseDown(tabTrigger, { button: 0, ctrlKey: false });
    expect(tabTrigger.getAttribute('data-state')).toBe('active');
    expect(await screen.findByText('Files could not be loaded')).toBeTruthy();
    expect(screen.getByText('Inventory read unavailable.')).toBeTruthy();
    expect(screen.queryByText(emptyText)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry files' }));
    expect(await screen.findByText(emptyText)).toBeTruthy();
    await waitFor(() => expect(failedRead).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Files could not be loaded')).toBeNull();
  });
});
