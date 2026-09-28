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
import { CHANNELS } from '@/lib/messaging/schemas';
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

function pickerHost(): ShadowRoot {
  const shadow = document.getElementById('matrx-list-picker-host')?.shadowRoot;
  if (!shadow) throw new Error('The page picker did not mount');
  return shadow;
}

async function startWithPreview() {
  render(<ListPatternTab />);
  expect(await screen.findByText('#wideeventsList')).toBeTruthy();
  fireEvent.click(
    await screen.findByRole('button', {
      name: /link_url Link.*Details.*neon-nights/i,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Extract$/i }));
  const priorRows = JSON.parse((await screen.findByTestId('rows')).textContent ?? '[]') as Array<
    Record<string, unknown>
  >;
  expect(priorRows.map((row) => row.link_url)).toEqual(urls);
  expect(screen.getByText(/1 selected field/i)).toBeTruthy();
  return priorRows;
}

async function restartAndChooseNestedScope() {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Pick more fields/i })));
  const overlay = pickerHost();
  await act(async () => {
    overlay.querySelector('#restart')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document
      .querySelector('.wideeventwrapper:first-child .eventTitle')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const nested = Array.from(
    overlay.querySelectorAll<HTMLButtonElement>('[data-scope-choice]'),
  ).find((button) => /3.*li/i.test(button.textContent ?? ''));
  expect(nested, 'nested repeated group should be available as a deliberate choice').toBeDefined();
  await act(async () => nested?.click());
  return overlay;
}

describe('D45 cancel is a picker transaction boundary', () => {
  it('keeps the configured collection, selected field, and prior preview after Restart, B scope, Cancel', async () => {
    const priorRows = await startWithPreview();
    const overlay = await restartAndChooseNestedScope();
    await act(async () => {
      overlay.querySelector('#cancel')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(document.getElementById('matrx-list-picker-host')).toBeNull());
    expect(screen.getByText('#wideeventsList')).toBeTruthy();
    expect(screen.getByText('div.wideeventwrapper')).toBeTruthy();
    expect(screen.getByText(/1 selected field/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Extract$/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(JSON.parse(screen.getByTestId('rows').textContent ?? '[]')).toEqual(priorRows);
  });

  it('commits an explicitly chosen new collection on Done even with zero fields', async () => {
    await startWithPreview();
    const overlay = await restartAndChooseNestedScope();
    await act(async () => {
      overlay.querySelector('#done')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(document.getElementById('matrx-list-picker-host')).toBeNull());
    expect(screen.queryByText('#wideeventsList')).toBeNull();
    expect(screen.getByText(/briefDetails/)).toBeTruthy();
    expect(screen.queryByText(/1 selected field/i)).toBeNull();
    expect((screen.getByRole('button', { name: /^Extract$/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByTestId('rows')).toBeNull();
  });

  it('appends page-picked fields to the staged same-scope definition on Done', async () => {
    await startWithPreview();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: /Pick more fields/i })),
    );
    const overlay = pickerHost();
    await act(async () => {
      document
        .querySelector('.wideeventwrapper:first-child .eventTitle')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      overlay.querySelector('#done')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(screen.getByText('#wideeventsList')).toBeTruthy();
    expect(screen.getByText('div.wideeventwrapper')).toBeTruthy();
    expect(screen.getByText(/2 selected fields/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Extract$/i }));
    const rows = JSON.parse((await screen.findByTestId('rows')).textContent ?? '[]') as Array<
      Record<string, unknown>
    >;
    expect(rows.map((row) => row.link_url)).toEqual(urls);
    expect(rows.map((row) => row.field_1)).toEqual(titles);
  });

  it('ignores a late stamped result from the canceled B session', async () => {
    const priorRows = await startWithPreview();
    const overlay = await restartAndChooseNestedScope();
    const sent = vi.mocked(chrome.runtime.sendMessage).mock.calls.map(
      ([message]) =>
        message as unknown as {
          kind: string;
          payload: { session_id: string };
        },
    );
    const sessionId = sent.find((message) => message.kind === 'data:list-picker-item-detected')
      ?.payload.session_id;
    expect(sessionId).toBeTruthy();
    await act(async () => {
      overlay.querySelector('#cancel')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      listeners.get(CHANNELS.LIST_PICKER_RESULT)?.({
        session_id: sessionId,
        tab_id: 77,
        list_root: '#wideeventsList > div.wideeventwrapper:first-child > li > ul.briefDetails',
        item_selector: 'li',
        field_paths: [{ name: 'wrong_scope', rel_selector: ':scope' }],
      });
    });
    expect(screen.getByText('#wideeventsList')).toBeTruthy();
    expect(screen.getByText('div.wideeventwrapper')).toBeTruthy();
    expect(screen.getByText(/1 selected field/i)).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('rows').textContent ?? '[]')).toEqual(priorRows);
  });
});
