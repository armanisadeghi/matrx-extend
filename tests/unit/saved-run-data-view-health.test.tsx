import { CHANNELS } from '@/lib/messaging/schemas';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  copied: '',
  page: {
    id: 37,
    url: 'https://electronic.vegas/calendar/',
    title: 'Vegas events',
    documentId: 'document-a',
    pageKey: 'page-a',
  },
  fetchPatterns: vi.fn(),
  runSaved: vi.fn(),
  bumpRun: vi.fn(),
  savePattern: vi.fn(),
  pickerListeners: new Map<string, (payload: unknown) => unknown>(),
  retryIdentity: vi.fn(),
  listHighlights: vi.fn(),
  requireOrg: vi.fn(),
}));

vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ ...mocks.page }),
  isCurrentPageIdentity: (key: string) => key === mocks.page.pageKey,
  getActiveTabIdentitySnapshot: () => ({
    ...mocks.page,
    identityStatus: mocks.page.pageKey ? 'ready' : 'resolving',
  }),
  refreshActiveTabIdentity: mocks.retryIdentity,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, status: 'signed-in', signIn: vi.fn() }),
}));
vi.mock('@/lib/supabase/queries', () => ({
  fetchPatternsForDomain: mocks.fetchPatterns,
  bumpPatternRun: mocks.bumpRun,
  savePattern: mocks.savePattern,
}));
vi.mock('@/lib/data-pattern/run-interactive', () => ({
  runSavedPattern: mocks.runSaved,
  NetworkNoMatchError: class NetworkNoMatchError extends Error {},
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, callback: (payload: unknown) => unknown) => {
    mocks.pickerListeners.set(kind, callback);
    return () => {
      mocks.pickerListeners.delete(kind);
    };
  },
  send: vi.fn(),
}));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: mocks.requireOrg }));
vi.mock('@/lib/highlights/queries', () => ({
  listMyHighlights: mocks.listHighlights,
  listHighlightsForUrl: vi.fn(),
  deleteHighlight: vi.fn(),
}));
vi.mock('@/lib/highlights/control', () => ({
  startHighlighter: vi.fn(),
  stopHighlighter: vi.fn(),
  setHighlighterMode: vi.fn(),
}));
vi.mock('@/components/CopyMenu', () => ({
  CopyMenu: ({
    title,
    options,
  }: { title?: string; options: { label: string; getContent: () => string }[] }) => (
    <button
      aria-label={title}
      onClick={() => {
        mocks.copied = options.find((o) => o.label === 'For AI agent')!.getContent();
      }}
    >
      Copy agent
    </button>
  ),
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('lucide-react', () => ({
  Crosshair: () => null,
  Loader2: () => null,
  LogIn: () => null,
  Play: () => null,
  Save: () => null,
  XCircle: () => null,
  Zap: () => null,
  Database: () => null,
  Highlighter: () => null,
  Link2: () => null,
  MousePointerSquareDashed: () => null,
  ScanLine: () => null,
  Square: () => null,
  Trash2: () => null,
  Type: () => null,
}));

import { DataView } from '@/features/data/DataView';
import { HighlightView } from '@/features/highlights/HighlightView';
import { useAutoExtractStore } from '@/state/auto-extract';
import { useHighlightStore } from '@/state/highlights';

const pattern = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  created_by: null,
  name: 'Calendar events',
  domain: 'electronic.vegas',
  route_pattern: '/calendar/',
  list_root_selector: '#events',
  fields: [],
  kind: 'list_pattern',
  config: { list_root: '#events', item_selector: '.event', field_paths: [] },
  target_user_table_id: null,
  last_used_at: null,
  last_run_at: null,
  last_status: null,
  last_run_count: null,
  created_at: '2026-09-27T00:00:00Z',
} satisfies ExtractionPattern;

afterEach(() => {
  cleanup();
  mocks.page = {
    id: 37,
    url: 'https://electronic.vegas/calendar/',
    title: 'Vegas events',
    documentId: 'document-a',
    pageKey: 'page-a',
  };
  mocks.copied = '';
  vi.clearAllMocks();
  mocks.bumpRun.mockReset();
  mocks.savePattern.mockReset();
  mocks.retryIdentity.mockReset();
  mocks.requireOrg.mockReset();
  mocks.requireOrg.mockResolvedValue('organization-1');
  mocks.pickerListeners.clear();
  vi.unstubAllGlobals();
  useAutoExtractStore.setState({ records: new Map() });
  useHighlightStore.setState({ items: [], dataHandoff: null });
});

it('shows DataView no-match guidance without writing ok health for zero rows', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([]);
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

  expect(await screen.findByText(/no matching data/i)).toBeTruthy();
  expect(mocks.bumpRun).not.toHaveBeenCalled();
  expect(screen.queryByText(/Extracted rows \(0\)/)).toBeNull();
});

it('still marks DataView healthy after a matching nonempty run', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([{ title: 'Real calendar event' }]);
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

  await waitFor(() => expect(mocks.bumpRun).toHaveBeenCalledWith(pattern.id, 'ok', 1));
  expect(await screen.findByText(/Real calendar event/)).toBeTruthy();
});

it.each([
  ['replay-document', true],
  ['unrelated-document', false],
] as const)(
  'shows an owned Network reload only for its attested document (%s)',
  async (currentDocument, accepted) => {
    const replayPattern = {
      ...pattern,
      kind: 'network_capture',
      config: { url_filter: 'https://electronic.vegas/api/events' },
    } satisfies ExtractionPattern;
    let finish!: (rows: Record<string, unknown>[]) => void;
    mocks.fetchPatterns.mockResolvedValue([replayPattern]);
    mocks.runSaved.mockImplementation(
      (_pattern, _tabId, opts) =>
        new Promise((resolve) => {
          finish = (rows) => {
            opts.onReplayDocument('replay-document');
            resolve(rows);
          };
        }),
    );
    const view = render(<DataView />);
    await screen.findAllByText('Calendar events');
    await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
    mocks.page.documentId = '';
    mocks.page.pageKey = '';
    view.rerender(<DataView />);
    mocks.page.documentId = currentDocument;
    mocks.page.pageKey = `page-${currentDocument}`;
    view.rerender(<DataView />);
    await act(async () => finish([{ title: 'Current calendar event' }]));
    expect(Boolean(screen.queryByText(/Current calendar event/))).toBe(accepted);
    expect(mocks.bumpRun).toHaveBeenCalledTimes(accepted ? 1 : 0);
  },
);

it('keeps extracted rows and reports saved history failure in DataView', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([{ title: 'Friday night concert' }]);
  mocks.bumpRun.mockResolvedValue('Database unavailable');
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

  expect(await screen.findByText(/Friday night concert/)).toBeTruthy();
  expect(
    await screen.findByText(/saved run history could not be updated: Database unavailable/i),
  ).toBeTruthy();
});

it('shows the extraction failure and the separate history failure together', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockRejectedValue(new Error('Selector could not execute'));
  mocks.bumpRun.mockResolvedValue('Database unavailable');
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

  expect(
    await screen.findByText(
      /Selector could not execute.*saved run history could not be updated: Database unavailable/i,
    ),
  ).toBeTruthy();
});

it('shows the auto-extract history warning alongside its extracted rows', async () => {
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await act(async () => {
    useAutoExtractStore.getState().setRecord(`page-a|${pattern.id}`, {
      pattern,
      url: 'https://electronic.vegas/calendar/',
      tabId: 37,
      pageKey: 'page-a',
      rows: [{ title: 'Friday night concert' }],
      status: 'ok',
      note: 'Saved run history could not be updated: Database unavailable',
      lastRunAt: Date.now(),
    });
  });

  expect(
    await screen.findByText(/saved run history could not be updated: Database unavailable/i),
  ).toBeTruthy();
  expect(screen.getByText(/Friday night concert/)).toBeTruthy();
});

it('rejects document A picker fields after document B starts a new session on the same URL', async () => {
  mocks.fetchPatterns.mockResolvedValue([]);
  mocks.savePattern.mockResolvedValue(pattern);
  const sessions: string[] = [];
  vi.stubGlobal('chrome', {
    scripting: {
      executeScript: vi.fn(async ({ args }: { args?: unknown[] }) => {
        if (typeof args?.[0] === 'string') sessions.push(args[0]);
        return [];
      }),
    },
  });
  const user = userEvent.setup();
  const view = render(<DataView />);
  await user.click(screen.getByRole('button', { name: /pick fields on this page/i }));
  const sessionA = sessions[0];
  expect(sessionA).toBeTruthy();
  await act(async () => {
    mocks.page = { ...mocks.page, documentId: 'document-b', pageKey: 'page-b' };
    view.rerender(<DataView />);
  });
  await user.click(screen.getByRole('button', { name: /pick fields on this page/i }));
  const sessionB = sessions[1];
  expect(sessionB).toBeTruthy();
  expect(sessionB).not.toBe(sessionA);
  const emit = mocks.pickerListeners.get(CHANNELS.DATA_PICKER_RESULT);
  if (!emit) throw new Error('Data picker result listener was not installed');
  act(() => {
    emit({
      tab_id: 37,
      document_id: 'document-a',
      session_id: sessionA,
      fields: [{ name: 'old', selector: '#old' }],
    });
  });
  expect(screen.queryByRole('button', { name: /save pattern/i })).toBeNull();
  act(() => {
    emit({
      tab_id: 37,
      document_id: 'document-b',
      session_id: sessionB,
      fields: [{ name: 'current', selector: '#current' }],
    });
  });
  await user.click(screen.getByRole('button', { name: /save pattern/i }));
  expect(mocks.savePattern).toHaveBeenCalledOnce();
  expect(mocks.savePattern.mock.calls[0]?.[0]).toMatchObject({
    fields: [{ name: 'current', selector: '#current' }],
  });
});

it('saves a Highlight-to-Data handoff only after its selectors are verified in the exact current document', async () => {
  mocks.fetchPatterns.mockResolvedValue([]);
  mocks.savePattern.mockResolvedValue(pattern);
  mocks.listHighlights.mockResolvedValue([
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      created_by: null,
      conversation_id: null,
      mode: 'element',
      url: mocks.page.url,
      domain: 'electronic.vegas',
      page_title: 'Vegas events',
      color: 'yellow',
      text: 'Event title',
      anchor: { selector: '#event-title' },
      created_at: '',
      updated_at: '',
    },
  ]);
  const injection = vi.fn(async ({ target }: { target: { documentIds: string[] } }) => {
    expect(target.documentIds).toEqual(['document-a']);
    return [{ result: [true] }];
  });
  vi.stubGlobal('chrome', { scripting: { executeScript: injection } });
  const highlight = render(<HighlightView />);
  await screen.findByRole('button', { name: /Data \(1\)/ });
  await userEvent.click(screen.getByRole('button', { name: /Data \(1\)/ }));
  await waitFor(() => expect(useHighlightStore.getState().dataHandoff?.pageKey).toBe('page-a'));
  highlight.unmount();
  render(<DataView />);
  await userEvent.click(screen.getByRole('button', { name: /save pattern/i }));
  expect(injection).toHaveBeenCalledOnce();
  expect(mocks.savePattern).toHaveBeenCalledOnce();
  expect(mocks.savePattern.mock.calls[0]?.[0]).toMatchObject({
    fields: [{ name: 'event_title', selector: '#event-title' }],
  });
});

it('shows recovery for an old Highlight handoff instead of silently saving it on the new document', async () => {
  mocks.fetchPatterns.mockResolvedValue([]);
  useHighlightStore.getState().setDataHandoff({
    fields: [{ name: 'old', selector: '#old' }],
    pageKey: 'page-a',
    tabId: 37,
    documentId: 'document-a',
  });
  mocks.page = { ...mocks.page, pageKey: 'page-b', documentId: 'document-b' };
  render(<DataView />);
  expect(
    await screen.findByText(/highlight fields came from another or unverified page/i),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: /save pattern/i })).toBeNull();
  expect(mocks.savePattern).not.toHaveBeenCalled();
});

it('does not persist A fields after same-URL document B replaces A during organization resolution', async () => {
  mocks.fetchPatterns.mockResolvedValue([]);
  let releaseOrg!: (id: string) => void;
  mocks.requireOrg.mockReturnValue(
    new Promise<string>((resolve) => {
      releaseOrg = resolve;
    }),
  );
  useHighlightStore.getState().setDataHandoff({
    fields: [{ name: 'old', selector: '#old' }],
    pageKey: 'page-a',
    tabId: 37,
    documentId: 'document-a',
  });
  const view = render(<DataView />);
  await userEvent.click(screen.getByRole('button', { name: /save pattern/i }));
  expect(mocks.requireOrg).toHaveBeenCalledOnce();
  await act(async () => {
    mocks.page = { ...mocks.page, pageKey: 'page-b', documentId: 'document-b' };
    view.rerender(<DataView />);
  });
  await act(async () => {
    releaseOrg('organization-1');
  });
  expect(mocks.savePattern).not.toHaveBeenCalled();
  expect(screen.getByText(/Page changed before saving.*Select fields again/i)).toBeTruthy();
});

it('does not let an old save completion clear B fields or finish B save', async () => {
  mocks.fetchPatterns.mockResolvedValue([]);
  mocks.requireOrg.mockResolvedValue('organization-1');
  let finishA!: (value: ExtractionPattern) => void;
  let finishB!: (value: ExtractionPattern) => void;
  mocks.savePattern
    .mockReturnValueOnce(
      new Promise<ExtractionPattern>((resolve) => {
        finishA = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise<ExtractionPattern>((resolve) => {
        finishB = resolve;
      }),
    );
  useHighlightStore.getState().setDataHandoff({
    fields: [{ name: 'old', selector: '#old' }],
    pageKey: 'page-a',
    tabId: 37,
    documentId: 'document-a',
  });
  const view = render(<DataView />);
  await userEvent.click(screen.getByRole('button', { name: /save pattern/i }));
  await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(1));
  await act(async () => {
    mocks.page = { ...mocks.page, pageKey: 'page-b', documentId: 'document-b' };
    view.rerender(<DataView />);
  });
  act(() => {
    useHighlightStore.getState().setDataHandoff({
      fields: [{ name: 'new', selector: '#new' }],
      pageKey: 'page-b',
      tabId: 37,
      documentId: 'document-b',
    });
  });
  await userEvent.click(screen.getByRole('button', { name: /save pattern/i }));
  await waitFor(() => expect(mocks.savePattern).toHaveBeenCalledTimes(2));
  await act(async () => {
    finishA(pattern);
  });
  expect(screen.getByRole('button', { name: /save pattern/i }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/#new/)).toBeTruthy();
  await act(async () => {
    finishB(pattern);
  });
  expect(screen.queryByRole('button', { name: /save pattern/i })).toBeNull();
});

it('keeps B picker live when delayed A injection rejects and shows a retry remedy for a current rejection', async () => {
  mocks.fetchPatterns.mockResolvedValue([]);
  mocks.savePattern.mockResolvedValue(pattern);
  let rejectA!: (error: Error) => void;
  const heldA = new Promise<unknown[]>((_resolve, reject) => {
    rejectA = reject;
  });
  const sessions: string[] = [];
  vi.stubGlobal('chrome', {
    scripting: {
      executeScript: vi.fn(({ args }: { args?: unknown[] }) => {
        if (typeof args?.[0] === 'string') {
          sessions.push(args[0]);
          return sessions.length === 1 ? heldA : Promise.resolve([]);
        }
        return Promise.resolve([]);
      }),
    },
  });
  const view = render(<DataView />);
  await userEvent.click(screen.getByRole('button', { name: /pick fields on this page/i }));
  expect(sessions).toHaveLength(1);
  await act(async () => {
    mocks.page = { ...mocks.page, pageKey: 'page-b', documentId: 'document-b' };
    view.rerender(<DataView />);
  });
  await userEvent.click(screen.getByRole('button', { name: /pick fields on this page/i }));
  expect(sessions).toHaveLength(2);
  await act(async () => {
    rejectA(new Error('A disappeared'));
    await heldA.catch(() => {});
  });
  expect(screen.queryByText(/A disappeared/)).toBeNull();
  const emit = mocks.pickerListeners.get(CHANNELS.DATA_PICKER_RESULT);
  if (!emit) throw new Error('Data picker result listener was not installed');
  act(() => {
    emit({
      tab_id: 37,
      document_id: 'document-b',
      session_id: sessions[1],
      fields: [{ name: 'current', selector: '#current' }],
    });
  });
  await userEvent.click(screen.getByRole('button', { name: /save pattern/i }));
  expect(mocks.savePattern).toHaveBeenCalledOnce();

  // A separate current-session injection failure must be visible and retryable.
  const execute = chrome.scripting.executeScript as ReturnType<typeof vi.fn>;
  execute.mockRejectedValueOnce(new Error('Document unavailable'));
  await userEvent.click(screen.getByRole('button', { name: /pick fields on this page/i }));
  expect(
    await screen.findByText(/Could not start the field picker.*Retry picking fields/i),
  ).toBeTruthy();
});

it('shows a Retry remedy and disables Data picker actions when document identity is unresolved', async () => {
  mocks.page.pageKey = '';
  mocks.page.documentId = '';
  mocks.fetchPatterns.mockResolvedValue([]);
  const user = userEvent.setup();
  render(<DataView />);
  expect((await screen.findByRole('status')).textContent).toMatch(/checking the current page/i);
  expect(
    screen.getByRole('button', { name: /pick fields on this page/i }).hasAttribute('disabled'),
  ).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.retryIdentity).toHaveBeenCalledOnce();
});

// The host contract is persistence and current-page presentation; extraction is the external runner.
it.each(['resolve', 'reject'] as const)(
  'ignores stale DataView %s after a page switch',
  async (outcome) => {
    let resolve!: (rows: Record<string, unknown>[]) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<Record<string, unknown>[]>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    mocks.fetchPatterns.mockResolvedValue([pattern]);
    mocks.runSaved.mockReturnValue(pending);
    const view = render(<DataView />);
    await screen.findAllByText('Calendar events');
    await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
    mocks.page.url = 'https://electronic.vegas/search/';
    mocks.page.pageKey = 'page-search';
    view.rerender(<DataView />);
    await act(async () => {
      if (outcome === 'resolve') resolve([{ title: 'Old calendar result' }]);
      else reject(new Error('Old calendar failure'));
      await pending.catch(() => {});
    });
    expect(document.body.textContent).not.toContain('Old calendar');
    expect(mocks.bumpRun).not.toHaveBeenCalled();
  },
);

it('hides completed DataView rows on the first commit for another tab at the same URL', async () => {
  const commits: string[] = [];
  function Probe({ id }: { id: number }) {
    useLayoutEffect(() => {
      commits.push(document.body.textContent ?? '');
    }, [id]);
    return null;
  }
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockResolvedValue([{ title: 'First tab event' }]);
  const view = render(
    <>
      <DataView />
      <Probe id={mocks.page.id} />
    </>,
  );
  await screen.findAllByText('Calendar events');
  await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
  await screen.findByText(/First tab event/);
  await userEvent.click(screen.getByRole('button', { name: 'Copy rows' }));
  expect(mocks.copied).toContain('https://electronic.vegas/calendar/');
  expect(mocks.copied).toContain('Calendar events');
  mocks.page.id = 38;
  mocks.page.pageKey = 'page-other-tab';
  view.rerender(
    <>
      <DataView />
      <Probe id={mocks.page.id} />
    </>,
  );
  expect(commits.at(-1)).not.toContain('First tab event');
});

it.each([
  ['/calendar/', true],
  ['/search/', false],
] as const)('preserves health for failure outside saved route %s', async (route, broken) => {
  mocks.page.url = `https://electronic.vegas${route}`;
  mocks.fetchPatterns.mockResolvedValue([pattern]);
  mocks.runSaved.mockRejectedValue(new Error('Selector could not execute'));
  render(<DataView />);
  await screen.findAllByText('Calendar events');
  await userEvent.click(
    route === '/calendar/'
      ? screen.getByRole('button', { name: 'Extract' })
      : screen.getByTitle('Run pattern'),
  );
  await screen.findByText(/Selector could not execute/);
  expect(mocks.bumpRun.mock.calls).toEqual(broken ? [[pattern.id, 'broken', 0]] : []);
});
