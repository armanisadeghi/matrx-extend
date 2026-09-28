// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({ pageKey: 'page-b', copied: '' }));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ pageKey: page.pageKey }),
  isCurrentPageIdentity: (pageKey: string | null) => pageKey !== null && pageKey === page.pageKey,
}));
vi.mock('@/components/CopyMenu', () => ({
  CopyMenu: ({ options }: { options: Array<{ label: string; getContent: () => string }> }) => (
    <button onClick={() => { page.copied = options.find((option) => option.label === 'For AI agent')!.getContent(); }}>
      Copy for AI
    </button>
  ),
}));

import { DiagnoseCard } from '@/features/scrape/DiagnoseCard';
import { useScrapeStore } from '@/state/scrape';

const url = 'https://harbor-dental.test/intake';
function pick(pageKey: string, text: string) {
  return {
    pageKey, mode: 'missing' as const, capturedAt: 1_800_000_000_000,
    pickedAtUrl: url, pickedAtTitle: 'New patient intake',
    selectorChain: ['#insurance'], leafTag: 'div', leafHtml: `<div id="insurance">${text}</div>`,
    leafTextPreview: text, leafTruncated: false, parentHtml: null, parentTruncated: false,
    siblingHtml: null, siblingTruncated: false, siblingCount: 0, anchorCandidates: [text],
  };
}
afterEach(() => {
  cleanup();
  useScrapeStore.getState().setCurrent(null);
  useScrapeStore.getState().clearDiagnose();
  page.copied = '';
});

it('copies B picker without retained A scrape after same-URL reload', () => {
  useScrapeStore.getState().setCurrent({ url, article: { content_markdown: 'A dental benefits deadline', extractor: 'readability' } } as never, 'page-a');
  useScrapeStore.getState().setDiagnoseResult(pick('page-b', 'Insurance consent'));
  render(<DiagnoseCard />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect(page.copied).toContain('Insurance consent');
  expect(page.copied).toContain('no markdown captured');
  expect(page.copied).not.toContain('A dental benefits deadline');
  expect(page.copied).not.toContain('readability');
});

it('copies B scrape comparison when B was captured', () => {
  useScrapeStore.getState().setCurrent({ url, article: { content_markdown: 'Insurance consent received from patient', extractor: 'defuddle' } } as never, 'page-b');
  useScrapeStore.getState().setDiagnoseResult(pick('page-b', 'Insurance consent'));
  render(<DiagnoseCard />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect(page.copied).toContain('Insurance consent received from patient');
  expect(page.copied).toContain('defuddle');
  expect(page.copied).not.toContain('no markdown captured');
});
