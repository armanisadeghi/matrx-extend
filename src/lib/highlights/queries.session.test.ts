import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  organization: vi.fn(),
  insert: vi.fn(),
}));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: m.organization }));
vi.mock('@/lib/auth/flow', () => ({ getAccessToken: vi.fn().mockResolvedValue('test-token') }));
vi.mock('@/lib/auth/verify-claims', () => ({
  verifyBearerClaims: vi.fn().mockResolvedValue({ status: 'verified' }),
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    schema: () => ({ from: () => ({ insert: m.insert }) }),
  }),
}));
vi.mock('@/lib/supabase/db-failure', () => ({
  failDbCall: () => {
    throw new Error('database refused');
  },
}));

import { createHighlight } from './queries';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  m.organization.mockReset();
  m.insert.mockReset();
  m.insert.mockImplementation((payload: unknown) => ({
    select: () => ({
      single: async () => ({
        data: {
          ...(payload as object),
          id: '550e8400-e29b-41d4-a716-446655440000',
          created_by: null,
          created_at: '',
          updated_at: '',
          error: null,
        },
        error: null,
      }),
    }),
  }));
});

it.each([
  ['https://example.com/a', 'old session'],
  ['https://example.com/b', 'old document'],
])('refuses a stale %s capture after organization selection resolves', async (url) => {
  const pending = deferred<string>();
  m.organization.mockReturnValueOnce(pending.promise);
  let current = true;
  const saving = createHighlight(
    {
      mode: 'text',
      url,
      domain: 'example.com',
      page_title: null,
      text: 'Selected passage',
      color: 'yellow',
      anchor: {},
    },
    () => current,
  );
  current = false;
  pending.resolve('org-one');
  await expect(saving).rejects.toThrow('no longer being highlighted');
  expect(m.insert).not.toHaveBeenCalled();
});

it('inserts a capture when the represented session stays current', async () => {
  m.organization.mockResolvedValueOnce('org-one');
  const saved = await createHighlight(
    {
      mode: 'text',
      url: 'https://example.com/current',
      domain: 'example.com',
      page_title: null,
      text: 'Current passage',
      color: 'yellow',
      anchor: {},
    },
    () => true,
  );
  expect(saved.url).toBe('https://example.com/current');
  expect(m.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      organization_id: 'org-one',
      url: 'https://example.com/current',
      text: 'Current passage',
    }),
  );
});
