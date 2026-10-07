import { type PersistedRunMeta, loadRunMeta, persistRunMeta } from '@/lib/tools/dispatch-persist';
import { beforeEach, expect, it, vi } from 'vitest';

const RUNS_KEY = 'matrx.dispatch.runs';
let stored: Record<string, unknown>;
const write = vi.fn();

beforeEach(() => {
  stored = {};
  write.mockReset().mockResolvedValue(undefined);
  Object.assign(chrome.storage, {
    session: {
      get: async () => structuredClone(stored),
      set: async (value: Record<string, unknown>) => {
        await write(value);
        stored = { ...stored, ...structuredClone(value) };
      },
    },
  });
});

// A property manager fans out maintenance work to two tabs. A worker restart
// must retain each child's distinct mode, tab, and conversation, plus siblings.
it('retains concurrent child metadata while pruning only expired siblings', async () => {
  const now = Date.now();
  const existing: PersistedRunMeta = {
    conversationId: 'maintenance-parent-chat',
    requestId: 'maintenance-parent-request',
    permissionMode: 'act',
    agentName: 'Maintenance coordinator',
    trustedHosts: ['navigate@app.notion.com'],
    assignedTabId: 46,
    updatedAt: now,
  };
  stored[RUNS_KEY] = {
    'maintenance-parent': existing,
    'expired-inspection': { ...existing, updatedAt: now - 7 * 60 * 60 * 1000 },
  };
  const notion: PersistedRunMeta = {
    conversationId: 'maintenance-notion-chat',
    requestId: 'maintenance-notion-request',
    permissionMode: 'act',
    agentName: 'Maintenance review',
    trustedHosts: [],
    assignedTabId: 47,
    updatedAt: now,
  };
  const calendar: PersistedRunMeta = {
    conversationId: 'maintenance-calendar-chat',
    requestId: 'maintenance-calendar-request',
    permissionMode: 'ask',
    agentName: 'Inspection scheduling',
    trustedHosts: ['navigate@calendar.google.com'],
    assignedTabId: 48,
    updatedAt: now,
  };
  let releaseWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  write.mockImplementation(() => pendingWrite);
  const writes = Promise.all([
    persistRunMeta('maintenance-notion', notion),
    persistRunMeta('maintenance-calendar', calendar),
  ]);
  try {
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
  } finally {
    releaseWrite();
    await writes;
  }
  expect(await loadRunMeta('maintenance-notion')).toEqual(notion);
  expect(await loadRunMeta('maintenance-calendar')).toEqual(calendar);
  expect(await loadRunMeta('maintenance-parent')).toEqual(existing);
  expect(await loadRunMeta('expired-inspection')).toBeNull();
});

it('a lookup waits for an already queued mirror rather than returning unknown', async () => {
  const meta: PersistedRunMeta = {
    conversationId: null,
    requestId: null,
    permissionMode: 'act',
    agentName: 'Maintenance review',
    trustedHosts: [],
    assignedTabId: 47,
    updatedAt: Date.now(),
  };
  let releaseWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  write.mockImplementation(() => pendingWrite);
  const persistence = persistRunMeta('maintenance-notion', meta);
  let lookupFinished = false;
  const lookup = loadRunMeta('maintenance-notion').then((value) => {
    lookupFinished = true;
    return value;
  });
  try {
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    expect(lookupFinished).toBe(false);
  } finally {
    releaseWrite();
    await persistence;
  }
  expect(await lookup).toEqual(meta);
  expect(await loadRunMeta('unknown-maintenance-run')).toBeNull();
});
