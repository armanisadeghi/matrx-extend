import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({
  id: 77,
  url: 'https://electronic.vegas/vegas-edm-event-calendar/',
  executeScript: vi.fn(),
}));

vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: page.id, url: page.url, title: 'Vegas EDM Event Calendar' }),
}));
vi.mock('@/lib/storage/zustand-adapter', () => ({
  chromeLocalStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => {} }));
vi.mock('@/components/CopyMenu', () => ({ CopyMenu: () => null, CopyButton: () => null }));
vi.mock('@/features/showcase/components/SaveAsPattern', () => ({ SaveAsPattern: () => null }));
vi.mock('@/features/showcase/components/ResultPreview', () => ({
  ResultPreview: ({ rows }: { rows: Record<string, unknown>[] }) => (
    <pre>{JSON.stringify(rows)}</pre>
  ),
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

import { DoctorTab } from '@/features/showcase/tabs/DoctorTab';
import { ListPatternTab } from '@/features/showcase/tabs/ListPatternTab';
import { useShowcaseTabStore } from '@/state/showcase-tab';

const detectedRoot = 'main > div.event-list';
const detectedItem = 'div.wideeventwrapper';
const diagnostic = {
  url: page.url,
  host: 'electronic.vegas',
  title: 'Vegas EDM Event Calendar',
  lang: 'en',
  meta_count: 0,
  sources: {
    json_ld: { count: 0, types: [], total_size_bytes: 0 },
    microdata: { count: 0, types: [] },
    tables: { count: 0, usable_count: 0 },
    next_data: { present: false, size_bytes: 0 },
    nuxt_data: { present: false, size_bytes: 0 },
    apollo_dom: { present: false, size_bytes: 0 },
    apollo_inline: { present: false },
    bpr_guid: { count: 0, total_size_bytes: 0 },
    window_assignments: [],
    repeating_groups: [
      {
        parent_selector: detectedRoot,
        item_selector: detectedItem,
        count: 5,
        sample_text: 'Events at several Las Vegas venues',
      },
    ],
  },
  recommendations: [
    {
      mode: 'list_pattern',
      reason: '5 repeating cards detected. List Pattern will pre-seed.',
      config: { list_root: detectedRoot, item_selector: detectedItem },
    },
  ],
  body_sample: 'Events at several Las Vegas venues',
  body_total_bytes: 39,
};

function TestSurface() {
  const subTab = useShowcaseTabStore((state) => state.subTab);
  return <>{subTab === 'doctor' ? <DoctorTab /> : <ListPatternTab />}</>;
}

beforeEach(() => {
  const fixture = document.createElement('main');
  fixture.dataset.showcaseHandoffFixture = 'true';
  fixture.innerHTML = `<div class="event-list">
    <div class="wideeventwrapper"><span itemprop="name">Neon Nights at Area15</span></div>
    <div class="wideeventwrapper"><span itemprop="name">Desert Pulse at Downtown Events</span></div>
    <div class="wideeventwrapper"><span itemprop="name">Skyline Sessions at The Roof</span></div>
    <div class="wideeventwrapper"><span itemprop="name">Afterhours at The Warehouse</span></div>
    <div class="wideeventwrapper"><span itemprop="name">Sunrise Set at Eastside Hall</span></div>
  </div>`;
  document.body.appendChild(fixture);
  page.id = 77;
  page.url = 'https://electronic.vegas/vegas-edm-event-calendar/';
  page.executeScript
    .mockReset()
    .mockImplementation(
      async ({ func, args }: { func: (...values: unknown[]) => unknown; args?: unknown[] }) => {
        if (func.name === 'pageDiagnosticInPage') return [{ result: diagnostic }];
        return [{ result: func(...(args ?? [])) }];
      },
    );
  Object.assign(chrome, {
    scripting: { executeScript: page.executeScript },
    tabs: {
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  useShowcaseTabStore.setState({ subTab: 'doctor', listRecommendation: null });
});

afterEach(() => {
  cleanup();
  document.querySelector('[data-showcase-handoff-fixture]')?.remove();
  vi.clearAllMocks();
});

describe('Showcase Doctor recommendation handoff', () => {
  it('carries detected list selectors into the builder while still requiring field selection', async () => {
    render(<TestSurface />);
    fireEvent.click(await screen.findByRole('button', { name: /5 repeating cards detected/i }));

    expect(await screen.findByText(detectedRoot)).toBeTruthy();
    expect(screen.getByText(detectedItem)).toBeTruthy();
    expect(screen.getByRole('button', { name: /pick more fields/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /extract/i }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: /name Neon Nights at Area15/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Extract$/i }));
    expect(await screen.findByText(/\[\{"name":"Neon Nights at Area15"/)).toBeTruthy();
  });

  it('rejects a recommendation after the active page changes', async () => {
    const view = render(<TestSurface />);
    await screen.findByRole('button', { name: /5 repeating cards detected/i });
    page.url = 'https://electronic.vegas/another-calendar/';
    view.rerender(<TestSurface />);
    fireEvent.click(screen.getByRole('button', { name: /5 repeating cards detected/i }));

    await waitFor(() =>
      expect(screen.getByText(/The page changed since Doctor probed it/i)).toBeTruthy(),
    );
    expect(useShowcaseTabStore.getState().subTab).toBe('doctor');
    expect(useShowcaseTabStore.getState().listRecommendation).toBeNull();
  });

  it('accepts another explicit recommendation after returning to Doctor', async () => {
    render(<TestSurface />);
    fireEvent.click(await screen.findByRole('button', { name: /5 repeating cards detected/i }));
    await screen.findByText(detectedRoot);
    await act(async () => useShowcaseTabStore.getState().setSubTab('doctor'));
    fireEvent.click(await screen.findByRole('button', { name: /5 repeating cards detected/i }));
    expect(await screen.findByText(detectedRoot)).toBeTruthy();
  });

  it('rejects a queued handoff for a different active page', async () => {
    useShowcaseTabStore.setState({ subTab: 'list_pattern' });
    page.url = 'https://electronic.vegas/another-calendar/';
    render(<ListPatternTab />);
    act(() =>
      useShowcaseTabStore.getState().offerListRecommendation({
        tabId: 77,
        url: diagnostic.url,
        listRoot: detectedRoot,
        itemSelector: detectedItem,
      }),
    );

    expect(
      await screen.findByText(/page changed before List Pattern could use Doctor/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pick an example item/i })).toBeTruthy();
    expect(screen.queryByText(detectedRoot)).toBeNull();
  });

  it('clears a seeded builder when the active page changes', async () => {
    const view = render(<TestSurface />);
    fireEvent.click(await screen.findByRole('button', { name: /5 repeating cards detected/i }));
    await screen.findByText(detectedRoot);

    page.url = 'https://electronic.vegas/another-calendar/';
    view.rerender(<TestSurface />);

    expect(await screen.findByRole('button', { name: /Pick an example item/i })).toBeTruthy();
    expect(screen.queryByText(detectedRoot)).toBeNull();
  });

  it('explains when detected selectors no longer match the page', async () => {
    render(<TestSurface />);
    await screen.findByRole('button', { name: /5 repeating cards detected/i });
    document.querySelector('[data-showcase-handoff-fixture]')?.remove();
    fireEvent.click(screen.getByRole('button', { name: /5 repeating cards detected/i }));

    expect(await screen.findByText(/detected list is no longer on this page/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Extract/i }).hasAttribute('disabled')).toBe(true);
  });
});
