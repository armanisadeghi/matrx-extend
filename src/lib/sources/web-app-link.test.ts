import { describe, expect, it } from 'vitest';
import { sourceWebAppUrl } from './web-app-link';

describe('sourceWebAppUrl', () => {
  it('opens the one Source screen, never the redirecting viewer route', () => {
    const url = sourceWebAppUrl('6b8c38dd-6d68-4824-b664-a380b7611627');
    expect(url).toMatch(/\/knowledge\/sources\/6b8c38dd-6d68-4824-b664-a380b7611627$/);
    expect(url).not.toContain('/knowledge/viewer/');
  });
});
