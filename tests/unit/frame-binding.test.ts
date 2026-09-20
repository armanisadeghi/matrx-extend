import { beforeEach, describe, expect, it } from 'vitest';

const frames = new Map<number, { documentId: string; url: string; parentFrameId: number }>();
const allowed = new Set<string>();

beforeEach(() => {
  frames.clear();
  allowed.clear();
  frames.set(0, { documentId: 'top-a', url: 'https://app.example.test/', parentFrameId: -1 });
  frames.set(4, { documentId: 'child-a', url: 'https://login.example.test/embed', parentFrameId: 0 });
  allowed.add('https://app.example.test/*');
  allowed.add('https://login.example.test/*');
  (globalThis as unknown as { chrome: unknown }).chrome = {
    webNavigation: { getFrame: async ({ frameId }: chrome.webNavigation.GetFrameDetails) => frames.get(frameId) ?? null },
    permissions: { contains: async ({ origins }: chrome.permissions.Permissions) => origins?.every((origin) => allowed.has(origin)) === true },
  };
});

describe('credential frame binding', () => {
  it('freezes permitted cross-origin ancestry and rejects changed ancestor identity or parent chain', async () => {
    const { credentialFrameBindingCurrent, readCredentialFrameBinding } = await import('@/lib/credentials/frame-binding');
    const binding = await readCredentialFrameBinding(7, 4, 'child-a');
    expect(binding?.chain.map((link) => [link.frameId, link.documentId, link.origin])).toEqual([
      [4, 'child-a', 'https://login.example.test'], [0, 'top-a', 'https://app.example.test'],
    ]);
    expect(await credentialFrameBindingCurrent(binding!)).toBe(true);
    frames.set(0, { documentId: 'top-b', url: 'https://app.example.test/', parentFrameId: -1 });
    expect(await credentialFrameBindingCurrent(binding!)).toBe(false);
    frames.set(0, { documentId: 'top-a', url: 'https://app.example.test/', parentFrameId: -1 });
    frames.set(4, { documentId: 'child-a', url: 'https://login.example.test/embed', parentFrameId: 9 });
    expect(await credentialFrameBindingCurrent(binding!)).toBe(false);
  });

  it.each([
    ['denied permission', () => allowed.delete('https://login.example.test/*')],
    ['opaque child URL', () => frames.set(4, { documentId: 'child-a', url: 'about:blank', parentFrameId: 0 })],
  ])('refuses %s before creating a binding', async (_label, alter) => {
    alter();
    const { readCredentialFrameBinding } = await import('@/lib/credentials/frame-binding');
    await expect(readCredentialFrameBinding(7, 4, 'child-a')).resolves.toBeNull();
  });
});
