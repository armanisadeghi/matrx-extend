import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), org: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/org/active-org', () => ({ requireActiveOrganizationId: mocks.org }));
import { ScreenshotShareLinks } from './ScreenshotShareLinks';
const calls: Array<{
  name: string;
  args: Record<string, unknown>;
  headers: Record<string, string>;
}> = [];
beforeEach(() => {
  calls.length = 0;
  mocks.org.mockReset().mockResolvedValue('selected-org');
  mocks.rpc.mockReset().mockImplementation((name: string, args: Record<string, unknown>) => {
    const call = { name, args, headers: {} as Record<string, string> };
    calls.push(call);
    const data =
      name === 'list_share_links'
        ? [
            {
              id: 'link-id',
              token: 'existing-token',
              is_active: true,
              label: null,
              expires_at: null,
              max_uses: null,
              use_count: 0,
            },
          ]
        : { success: true, token: 'new-token' };
    return Object.assign(Promise.resolve({ data, error: null }), {
      setHeader: (key: string, value: string) => {
        call.headers[key] = value;
        return Promise.resolve({ data, error: null });
      },
    });
  });
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('Screenshot owner link manager', () => {
  it('keeps a failed link read distinct from an empty list and recovers through Refresh', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('Read unavailable') });
    render(<ScreenshotShareLinks fileId="file-id" open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Read unavailable');
    expect(screen.queryByText('No share links')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByDisplayValue(/existing-token/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('creates a viewer grant with chosen expiry and uses, carrying selected organization, then revokes through same grant family', async () => {
    render(<ScreenshotShareLinks fileId="file-id" open onOpenChange={vi.fn()} />);
    expect(await screen.findByDisplayValue(/existing-token/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText('Expiration'), {
      target: { value: '2099-01-01T12:00' },
    });
    fireEvent.change(screen.getByLabelText('Maximum views'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create public link' }));
    expect(await screen.findByLabelText('New public link')).toBeTruthy();
    const created = calls.find((call) => call.name === 'create_share_link');
    expect(created?.args).toEqual({
      p_resource_type: 'file',
      p_resource_id: 'file-id',
      p_permission_level: 'viewer',
      p_label: 'Review',
      p_max_uses: 5,
      p_expires_at: new Date('2099-01-01T12:00').toISOString(),
    });
    expect(created?.headers).toEqual({ 'X-Organization-Id': 'selected-org' });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(calls.find((call) => call.name === 'revoke_share_link')).toEqual({
        name: 'revoke_share_link',
        args: { p_link_id: 'link-id' },
        headers: { 'X-Organization-Id': 'selected-org' },
      }),
    );
  });
  it('retains the created public URL when clipboard access fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Denied'));
    render(<ScreenshotShareLinks fileId="file-id" open onOpenChange={vi.fn()} />);
    await screen.findByDisplayValue(/existing-token/);
    fireEvent.click(screen.getByRole('button', { name: 'Create public link' }));
    const input = await screen.findByLabelText('New public link');
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not copy. Select the link and copy it manually.',
    );
    expect(input.getAttribute('value')).toContain('/s/new-token');
  });
  it('rejects a server refusal without claiming a created link', async () => {
    mocks.rpc.mockImplementation((name: string) =>
      name === 'list_share_links'
        ? Promise.resolve({ data: [], error: null })
        : {
            setHeader: () =>
              Promise.resolve({ data: { success: false, error: 'Owner required' }, error: null }),
          },
    );
    render(<ScreenshotShareLinks fileId="file-id" open onOpenChange={vi.fn()} />);
    await screen.findByText('No share links');
    fireEvent.click(screen.getByRole('button', { name: 'Create public link' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Owner required');
    expect(screen.queryByLabelText('New public link')).toBeNull();
  });
});
