import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const copied = vi.hoisted(() => ({ text: '' }));

vi.mock('@/components/CopyMenu', () => ({
  CopyMenu: ({ options }: { options: { label: string; description?: string; getContent: () => string }[] }) => (
    <>
      <button
        type="button"
        onClick={() => {
          copied.text = options.find((option) => option.label === 'Copy for AI')!.getContent();
        }}
      >
        Copy for AI
      </button>
      <span>{options.find((option) => option.label === 'Copy for AI')?.description}</span>
    </>
  ),
}));
vi.mock('@/state/chat', () => ({
  useChatStore: (selector: (state: { draft: string; setDraft: () => void }) => unknown) =>
    selector({ draft: '', setDraft: vi.fn() }),
}));
vi.mock('@/state/sidepanel-tab', () => ({
  useSidepanelTabStore: (selector: (state: { setTab: () => void }) => unknown) =>
    selector({ setTab: vi.fn() }),
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

import { ResultPreview } from '@/features/showcase/components/ResultPreview';

afterEach(() => {
  cleanup();
  copied.text = '';
});

it('copies each extraction source with ordinary query identity while masking credential values', async () => {
  const rows = [{ title: 'Friday night concert' }];
  const first = render(
    <ResultPreview
      rows={rows}
      source={{ url: 'https://electronic.vegas/calendar?date=2026-09-28&token=PRIVATE-ONE' }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect(copied.text).toContain('Source URL: https://electronic.vegas/calendar?date=2026-09-28&token=[credential]');
  expect(copied.text).not.toContain('PRIVATE-ONE');
  expect(copied.text).toContain('Friday night concert');

  first.rerender(
    <ResultPreview
      rows={[{ title: 'Saturday night concert' }]}
      source={{ url: 'https://electronic.vegas/calendar?date=2026-09-29&token=PRIVATE-TWO' }}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect(copied.text).toContain('Source URL: https://electronic.vegas/calendar?date=2026-09-29&token=[credential]');
  expect(copied.text).not.toContain('PRIVATE-TWO');
  expect(copied.text).toContain('Saturday night concert');
  expect(copied.text).not.toContain('Friday night concert');
});

it('states when an extraction has no source URL', async () => {
  render(<ResultPreview rows={[{ title: 'Friday night concert' }]} />);
  expect(screen.getByText(/source URL unavailable/i)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect(copied.text).not.toContain('Source URL:');
});
