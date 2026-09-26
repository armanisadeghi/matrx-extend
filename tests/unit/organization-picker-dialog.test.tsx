/**
 * The screen that answers a held request.
 *
 * A held request is useless if nothing draws the question. These tests run the
 * real dialog against the real `src/lib/org/active-org.ts` over a real storage
 * seam: the durable flag alone must open it (the service worker held a request
 * while the panel was shut), a broadcast must open it (the panel was already
 * open), and choosing must write the selection that unblocks the hold.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '33333333-3333-4333-8333-333333333333';

const harness = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const watchers = new Set<(key: string, value: unknown) => void>();
  const listeners = new Set<() => void>();
  return { store, watchers, listeners, memberships: [] as string[] };
});

vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    rpc: async () => ({
      data: harness.memberships.map((id) => ({ container_id: id })),
      error: null,
    }),
  }),
}));
vi.mock('@/lib/supabase/schemas', () => ({
  iamDb: () => ({
    from: () => ({
      select: () => ({
        in: async () => ({
          data: harness.memberships.map((id) => ({
            id,
            name: id === ORG_A ? 'Acme Recycling' : 'Data Destruction Inc',
          })),
          error: null,
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/storage/chrome-local', () => ({
  getOne: async (key: string) => harness.store.get(key) ?? null,
  setOne: async (key: string, value: unknown) => {
    harness.store.set(key, value);
    for (const watcher of [...harness.watchers]) watcher(key, value);
  },
  onChange: (key: string, cb: (next: unknown) => void) => {
    const watcher = (changed: string, value: unknown) => {
      if (changed === key) cb(value ?? null);
    };
    harness.watchers.add(watcher);
    return () => harness.watchers.delete(watcher);
  },
}));
vi.mock('@/lib/messaging/native', () => ({
  broadcast: (_kind: string) => {
    for (const listener of [...harness.listeners]) listener();
  },
  on: (_kind: string, handler: () => void) => {
    harness.listeners.add(handler);
    return () => harness.listeners.delete(handler);
  },
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { OrganizationPickerDialog } from '@/features/org/OrganizationPickerDialog';
import { requestOrganizationPicker } from '@/lib/org/active-org';

const QUESTION = /which organization are you working in/i;

beforeEach(() => {
  // No auto-cleanup in this config: a Radix portal from the previous test
  // would still be in document.body and every "not asked yet" assertion
  // would be meaningless.
  cleanup();
  harness.store.clear();
  harness.watchers.clear();
  harness.listeners.clear();
  harness.memberships = [ORG_A, ORG_B];
});

describe('the organization question', () => {
  it('stays out of the way when nobody has asked', () => {
    render(<OrganizationPickerDialog />);
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it('asks on the durable flag alone — the panel was shut when the request was held', async () => {
    harness.store.set('matrx.org.picker-pending', true);
    render(<OrganizationPickerDialog />);
    expect(await screen.findByText(QUESTION)).toBeTruthy();
    // The real memberships, by name — not a placeholder list.
    expect(await screen.findByText('Data Destruction Inc')).toBeTruthy();
  });

  it('asks on the broadcast when the panel is already open, and never says "default"', async () => {
    render(<OrganizationPickerDialog />);
    expect(screen.queryByText(QUESTION)).toBeNull();

    await requestOrganizationPicker();

    expect(await screen.findByText(QUESTION)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/default/i);
  });

  it('writes the chosen organization, which is what releases the held request', async () => {
    harness.store.set('matrx.org.picker-pending', true);
    render(<OrganizationPickerDialog />);

    const row = await screen.findByText('Data Destruction Inc');
    (row.closest('button') ?? row).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await waitFor(() => {
      expect(harness.store.get('matrx.org.active')).toMatchObject({ id: ORG_B });
    });
    // Answered — and it stops asking.
    await waitFor(() => expect(harness.store.get('matrx.org.picker-pending')).toBeNull());
  });

  it('says what happened instead of showing an empty list when there is nothing to join', async () => {
    harness.memberships = [];
    harness.store.set('matrx.org.picker-pending', true);
    render(<OrganizationPickerDialog />);
    expect(await screen.findByText(/not a member of any organization yet/i)).toBeTruthy();
  });
});
