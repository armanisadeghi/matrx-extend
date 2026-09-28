import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const activePage = vi.hoisted(() => ({
  id: 77,
  url: 'https://electronic.vegas/vegas-edm-event-calendar/',
  executeScript: vi.fn(),
}));
const listeners = vi.hoisted(
  () => new Map<string, (payload: Record<string, unknown>) => unknown>(),
);
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({
    id: activePage.id,
    url: activePage.url,
    title: 'Vegas EDM Event Calendar',
    documentId: 'document-a',
    pageKey: 'document-a',
  }),
  isCurrentPageIdentity: (key: string) => key === 'document-a',
}));
vi.mock('@/lib/storage/zustand-adapter', () => ({
  chromeLocalStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (channel: string, handler: (payload: Record<string, unknown>) => unknown) => {
    listeners.set(channel, handler);
    return () => listeners.delete(channel);
  },
}));
vi.mock('@/components/CopyMenu', () => ({ CopyMenu: () => null, CopyButton: () => null }));
vi.mock('@/features/showcase/components/SaveAsPattern', () => ({
  SaveAsPattern: ({ config }: { config: unknown }) => (
    <pre data-testid="saved-config">{JSON.stringify(config)}</pre>
  ),
}));
vi.mock('@/features/showcase/components/ResultPreview', () => ({
  ResultPreview: ({ rows }: { rows: Record<string, unknown>[] }) => (
    <pre data-testid="rows">{JSON.stringify(rows)}</pre>
  ),
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

import { ListPatternTab } from '@/features/showcase/tabs/ListPatternTab';
import { mountListPicker, unmountListPicker } from '@/lib/data-pattern/list-picker';
import { useShowcaseTabStore } from '@/state/showcase-tab';

const titles = [
  'Neon Nights at Area15',
  'Desert Pulse at Downtown Events',
  'Skyline Sessions at The Roof',
  'Afterhours at The Warehouse',
  'Sunrise Set at Eastside Hall',
];
const urls = [
  '/events/neon-nights',
  '/events/desert-pulse',
  '/events/skyline-sessions',
  '/events/afterhours',
  '/events/sunrise-set',
];

beforeEach(() => {
  document.body.innerHTML = `<section id="wideeventsList">${titles
    .map(
      (
        title,
        index,
      ) => `<div class="wideeventwrapper"><li itemtype="Event"><ul class="briefDetails">
      <li><span class="eventTitle" itemprop="name">${title}</span><a class="eventUrl" href="${urls[index]}">Details</a></li>
      <li>Las Vegas</li><li>Saturday</li>
    </ul></li></div>`,
    )
    .join('')}</section>`;
  Object.assign(window, { __matrxListPickerStart: mountListPicker });
  activePage.id = 77;
  activePage.url = 'https://electronic.vegas/vegas-edm-event-calendar/';
  activePage.executeScript.mockReset().mockImplementation(
    async (request: {
      files?: string[];
      func?: (...args: unknown[]) => unknown;
      args?: unknown[];
    }) => (request.files ? [] : [{ result: request.func?.(...(request.args ?? [])) }]),
  );
  Object.assign(chrome, {
    scripting: { executeScript: activePage.executeScript },
    runtime: {
      sendMessage: vi.fn(async (message: { kind: string; payload: Record<string, unknown> }) => {
        listeners.get(message.kind)?.({ ...message.payload, tab_id: activePage.id, document_id: 'document-a' });
        return { ack: true };
      }),
    },
    tabs: {
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  useShowcaseTabStore.setState({ subTab: 'list_pattern', listRecommendation: null });
  useShowcaseTabStore.getState().offerListRecommendation({
    tabId: 77,
    url: activePage.url,
    pageKey: 'document-a',
    listRoot: '#wideeventsList',
    itemSelector: 'div.wideeventwrapper',
  });
});
afterEach(() => {
  cleanup();
  unmountListPicker();
  document.body.innerHTML = '';
  listeners.clear();
  vi.clearAllMocks();
});

describe('D43 Pick more fields user entry', () => {
  it('passes the seed through session start, appends a title field, and extracts five title/URL rows', async () => {
    render(<ListPatternTab />);
    expect(await screen.findByText('#wideeventsList')).toBeTruthy();
    const urlSuggestion = await screen.findByRole('button', {
      name: /link_url Link.*Details.*neon-nights/i,
    });
    fireEvent.click(urlSuggestion);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: /Pick more fields/i })),
    );
    const host = document.getElementById('matrx-list-picker-host');
    expect(host?.shadowRoot?.textContent).toMatch(/Click a field inside any highlighted item/);
    await act(async () => {
      document
        .querySelector('.wideeventwrapper:first-child .eventTitle')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host?.shadowRoot?.querySelectorAll('[data-scope-choice]')).toHaveLength(0);
    await act(async () => {
      host?.shadowRoot
        ?.querySelector('#done')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(screen.getByText('#wideeventsList')).toBeTruthy();
    expect(screen.getByText('div.wideeventwrapper')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Extract$/i }));
    const rows = JSON.parse((await screen.findByTestId('rows')).textContent ?? '[]') as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.field_1)).toEqual(titles);
    expect(rows.map((row) => row.link_url)).toEqual(urls);
    const saved = JSON.parse((await screen.findByTestId('saved-config')).textContent ?? '{}') as {
      list_root: string;
      item_selector: string;
      field_paths: Array<{ name: string }>;
    };
    expect(saved.list_root).toBe('#wideeventsList');
    expect(saved.item_selector).toBe('div.wideeventwrapper');
    expect(saved.field_paths.map((field) => field.name)).toEqual(['link_url', 'field_1']);
  });

  it('rejects a stale seeded picker completion after page change', async () => {
    const view = render(<ListPatternTab />);
    await screen.findByText('#wideeventsList');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: /Pick more fields/i })),
    );
    activePage.url = 'https://example.com/';
    view.rerender(<ListPatternTab />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Pick an example item/i })).toBeTruthy(),
    );
    await act(async () => {
      document
        .querySelector('.wideeventwrapper:first-child .eventTitle')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(screen.queryByText('#wideeventsList')).toBeNull();
  });
});
