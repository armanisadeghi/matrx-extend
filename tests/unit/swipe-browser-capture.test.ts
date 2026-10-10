import { fileGuidedCapture } from '@/lib/guided-capture/host';
import type { GuidedTabJob } from '@/lib/guided-capture/protocol';
import { startSwipeBrowserCapture } from '@/lib/swipe-file/browser-capture';
import { writeSwipeReceipt } from '@/lib/swipe-file/receipt';
import { beforeEach, expect, it, vi } from 'vitest';

const { post, getRow, result } = vi.hoisted(() => ({
  post: vi.fn(),
  getRow: vi.fn(),
  result: vi.fn(),
}));
vi.mock('@/lib/api/client', () => ({ apiPost: post }));
vi.mock('@/lib/capture-ladder/queue', () => ({ getHandoff: getRow }));
vi.mock('@/lib/capture-ladder/api', () => ({ postCaptureResult: result }));
const url = 'https://www.instagram.com/p/C9Beaches/';
const job: GuidedTabJob = {
  handoffId: 'handoff',
  organizationId: 'coastal-studio',
  url,
  title: 'Coast walk',
  platform: 'instagram',
  target: 'post',
  rowSteps: '',
  openerTabId: 17,
};
const receipt = {
  postId: 'saved-post',
  organizationId: 'coastal-studio',
  url,
  platform: 'instagram',
  capturedAt: '2026-10-10T11:00:00Z',
  media: [],
  mediaNotes: [],
  transcript: { status: 'none' as const, notes: [] },
  reused: false,
};
beforeEach(async () => {
  vi.clearAllMocks();
  await writeSwipeReceipt(receipt);
  getRow.mockResolvedValue({
    id: 'handoff',
    organization_id: 'coastal-studio',
    url,
    title: 'Coast walk',
    metadata: { social: { platform: 'instagram', target: 'post' } },
    rung: 'human_drive',
    status: 'needs_drive',
    what_to_do: '',
  });
  post.mockResolvedValue({ ok: true, data: { job: { id: 'handoff' } } });
  result.mockResolvedValue({ ok: true, data: { notices: [] } });
  Object.assign(chrome, { tabs: { create: vi.fn(async () => ({ id: 21 })) } });
});
it('opens and files the same existing post in its saved organization after an org switch', async () => {
  expect(
    await startSwipeBrowserCapture({
      postId: receipt.postId,
      organizationId: receipt.organizationId,
      url,
      openerTabId: 17,
    }),
  ).toEqual({ ok: true, tabId: 21 });
  expect(post).toHaveBeenCalledWith(
    '/social/gated-captures',
    {
      platform: 'instagram',
      handle_or_url: url,
      target: 'post',
      path: 'guided',
      post_id: 'saved-post',
    },
    undefined,
    { organizationId: 'coastal-studio' },
  );
  expect(
    await fileGuidedCapture(job, {
      finalUrl: url,
      title: 'Coast walk',
      text: '',
      html: '<article></article>',
      itemCount: 1,
      images: [{ src: 'https://cdn.example/coast.jpg', post_ref: 'C9Beaches' }],
      videos: [{ src: 'https://cdn.example/waves.mp4', post_ref: 'C9Beaches' }],
    }),
  ).toMatchObject({ t: 'filed' });
  expect(result).toHaveBeenCalledWith(
    'handoff',
    expect.objectContaining({
      images: [{ src: 'https://cdn.example/coast.jpg', post_ref: 'C9Beaches' }],
      videos: [{ src: 'https://cdn.example/waves.mp4', post_ref: 'C9Beaches' }],
    }),
    undefined,
    'coastal-studio',
  );
});
it.each([
  { postId: 'missing-post', organizationId: 'coastal-studio', url },
  { postId: 'saved-post', organizationId: 'another-org', url },
  {
    postId: 'saved-post',
    organizationId: 'coastal-studio',
    url: 'https://www.instagram.com/p/C9Related/',
  },
])('refuses stale or mismatched saved post context: %s', async (args) => {
  expect(await startSwipeBrowserCapture({ ...args, openerTabId: null })).toMatchObject({
    ok: false,
  });
  expect(post).not.toHaveBeenCalled();
  expect(chrome.tabs.create).not.toHaveBeenCalled();
});
it('refuses filing a different SPA post or a handoff with changed destination org', async () => {
  const payload = {
    finalUrl: 'https://www.instagram.com/p/C9Related/',
    title: '',
    text: 'Post content',
    html: '',
    itemCount: 1,
    images: [],
  };
  expect(await fileGuidedCapture(job, payload)).toMatchObject({ t: 'failed' });
  getRow.mockResolvedValue({
    organization_id: 'another-org',
    status: 'needs_drive',
    rung: 'human_drive',
  });
  expect(await fileGuidedCapture(job, { ...payload, finalUrl: url })).toMatchObject({
    t: 'failed',
  });
  expect(result).not.toHaveBeenCalled();
});
