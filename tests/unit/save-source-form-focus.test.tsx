import { SaveSourceForm } from '@/features/scrape/SaveSourceForm';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(cleanup);

it('keeps keyboard focus in the Save dialog when tabbing past either end', () => {
  render(
    <>
      <button type="button">Underlying page control</button>
      <SaveSourceForm
        initialName="Article"
        organizationId={null}
        saving={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    </>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Save Source' });
  const first = screen.getByRole('button', { name: 'Close Save Source' });
  const last = screen.getByRole('button', { name: /^Save Source$/ });
  const underlying = screen.getByRole('button', { name: 'Underlying page control' });

  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).not.toBe(underlying);

  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  expect(dialog.contains(document.activeElement)).toBe(true);
});
