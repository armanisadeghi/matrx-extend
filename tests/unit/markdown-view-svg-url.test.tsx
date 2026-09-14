import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownView } from '@/components/MarkdownView';

describe('MarkdownView SVG data image URL boundary', () => {
  it('renders the sanitized SVG image data URL while blocking other data and script URLs', () => {
    const safeSvg =
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    render(
      <MarkdownView
        content={`![safe](${safeSvg})\n\n![text](data:text/html;base64,PHNjcmlwdD4=)\n\n![bad svg](data:image/svg+xml,%3Csvg%2F%3E)\n\n![script](javascript:alert(1))`}
      />,
    );

    expect(screen.getByRole('img', { name: 'safe' }).getAttribute('src')).toBe(safeSvg);
    expect(screen.getByRole('img', { name: 'text' }).getAttribute('src')).toBeNull();
    expect(screen.getByRole('img', { name: 'bad svg' }).getAttribute('src')).toBeNull();
    expect(screen.getByRole('img', { name: 'script' }).getAttribute('src')).toBeNull();
  });
});
