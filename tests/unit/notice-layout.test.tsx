/** EXT-D-0199: restoring a floating notice tray would cover recovery controls. */
import { SidepanelFrame } from '@/components/SidepanelFrame';
import { pushNotice, useNoticeStore } from '@/state/notices';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => null,
  onActiveOrganizationChange: () => () => undefined,
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => undefined }));

beforeEach(() => useNoticeStore.getState().clear());
afterEach(() => {
  cleanup();
  useNoticeStore.getState().clear();
});

it('reserves a bounded scrolling tray beside flexible content and keeps Dismiss usable', () => {
  render(
    <SidepanelFrame>
      <button type="button">Re-audit</button>
    </SidepanelFrame>,
  );
  const content = screen.getByRole('button', { name: 'Re-audit' }).parentElement;
  if (!content?.parentElement) throw new Error('Panel content has no frame');
  const shell = content.parentElement;
  expect(shell.children).toHaveLength(1);
  act(() => {
    pushNotice({
      tone: 'error',
      title: 'Saved audits unavailable',
      message: 'The database refused the request. Try again.',
    });
    pushNotice({ tone: 'info', title: 'Source filed', message: 'Filed in Launch plan.' });
  });
  const tray = screen.getByRole('alert').parentElement;
  if (!tray) throw new Error('Notice has no tray');
  // This is a layout-contract guard, not a native geometry or pointer verdict.
  expect(tray.parentElement).toBe(shell);
  expect(shell.lastElementChild).toBe(tray);
  expect(shell.classList.contains('flex-col')).toBe(true);
  expect(content.classList.contains('flex-1')).toBe(true);
  expect(content.classList.contains('min-h-0')).toBe(true);
  expect(tray.classList.contains('fixed')).toBe(false);
  expect(tray.classList.contains('absolute')).toBe(false);
  expect(tray.classList.contains('shrink-0')).toBe(true);
  expect(tray.classList.contains('overflow-y-auto')).toBe(true);
  expect(tray.classList.contains('max-h-[40%]')).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('Source filed');
  const errorDismiss = screen.getByRole('alert').querySelector('button');
  if (!errorDismiss) throw new Error('Error notice has no Dismiss');
  fireEvent.click(errorDismiss);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(shell.children).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Re-audit' }).hasAttribute('disabled')).toBe(false);
});
