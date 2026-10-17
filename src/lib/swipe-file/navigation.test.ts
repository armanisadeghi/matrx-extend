import { parseLinkParam } from '@ai-matrx/summon/url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({ ENV: { FRONTEND_URL: 'https://aimatrx.com' } }));

import { swipePostWebUrl } from './navigation';

describe('swipePostWebUrl', () => {
  it('writes a social_post link the platform parses back to the post and organization', () => {
    const url = new URL(
      swipePostWebUrl(
        '6f0c2a7e-1b2c-4d5e-8f90-a1b2c3d4e5f6',
        '0d9e8c7b-6a5f-4e3d-2c1b-0a9f8e7d6c5b',
      ),
    );
    expect(url.pathname).toBe('/projects');
    const [token] = parseLinkParam(url.searchParams.get('panels'));
    expect(token?.key).toBe('social_post');
    expect(token?.id).toBe('6f0c2a7e-1b2c-4d5e-8f90-a1b2c3d4e5f6');
    expect(token?.args).toEqual({ o: '0d9e8c7b-6a5f-4e3d-2c1b-0a9f8e7d6c5b' });
  });
});
