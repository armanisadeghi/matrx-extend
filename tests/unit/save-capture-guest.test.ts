import { STORAGE_KEYS } from '@/config/env';
import { collectMetadata } from '@/lib/scrape/collectors';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { runAudit } from '@/lib/seo/audit';
import {
  UNSAVED_CAPTURES_KEY,
  listUnsavedCaptures,
  retryUnsavedCapture,
  saveCaptureAsSource,
} from '@/lib/sources/save-capture';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  verified: vi.fn(),
  organization: vi.fn(),
  land: vi.fn(),
}));

vi.mock('@/lib/auth/flow', () => ({
  getCurrentUser: async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USER_PROFILE);
    return stored[STORAGE_KEYS.USER_PROFILE] ?? null;
  },
  getVerifiedCurrentUser: identity.verified,
}));
vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: identity.organization,
}));
vi.mock('@/lib/api/routes/sources', () => ({ landSource: identity.land }));

const personId = '87a6e699-3622-4869-8843-d0867456c0dd';
const organizationId = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
const landed = {
  processed_document_id: '669f3d2c-04b7-4258-bc95-b4204866ba26',
  source_id: 'dental-intake-guide',
  reused_existing: false,
  kept: true,
  intelligence: 'queued',
  notices: [],
};

// A practice manager captures a new-patient intake guide, then corrects it before saving.
async function editedCapture() {
  const page = new DOMParser().parseFromString(
    '<html lang="en"><head><title>New-patient intake</title></head><body><article><h1>New-patient intake</h1><p>Bring your completed intake form.</p></article></body></html>',
    'text/html',
  );
  const original = {
    url: 'https://docs.example.com/intake',
    capturedAt: Date.now(),
    metadata: collectMetadata(page),
    article: {
      title: 'New-patient intake',
      byline: null,
      content_html_safe: '<h1>New-patient intake</h1><p>Bring your completed intake form.</p>',
      content_markdown: '# New-patient intake\n\nBring your completed intake form.',
      excerpt: null,
      extractor: 'fallback',
      word_count: 8,
      reading_time_minutes: 1,
    },
    images: [],
    videos: [],
    audio: [],
    links: [],
    ld_json: [],
    seo: runAudit(page, 'https://docs.example.com/intake'),
    raw_html_size: page.documentElement.outerHTML.length,
  } satisfies SoupResult;
  return {
    original,
    edited: {
      ...original,
      article: {
        ...original.article,
        content_markdown:
          '# New-patient intake\n\nBring your insurance card and completed intake form.',
      },
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  identity.verified.mockResolvedValue(null);
  identity.organization.mockRejectedValue(
    new Error('Could not read your organizations: permission denied for function mbr_for_user'),
  );
  identity.land.mockResolvedValue({ ok: true, landed });
  await chrome.storage.local.clear();
  // use-auth intentionally retains this rendering profile after session restore fails.
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: { id: personId } });
});

describe('capture persistence after sign-in restore failure', () => {
  it('keeps the edited capture with a sign-in remedy before organization lookup', async () => {
    const { edited, original } = await editedCapture();
    const result = await saveCaptureAsSource(edited, { original, articleEdited: true });

    expect(result).toMatchObject({
      status: 'unsaved',
      persisted: true,
      unsaved: {
        lastRefusal: { status: 401, code: 'sign_in_required', remedy: 'sign_in' },
      },
    });
    const [queued] = await listUnsavedCaptures();
    expect(queued?.prepared.portions.map((portion) => portion.text).join('\n')).toBe(
      'New-patient intake\nBring your insurance card and completed intake form.',
    );
    expect(JSON.parse(atob(queued?.prepared.original?.bytes_b64 ?? ''))).toMatchObject({
      article: { content_html_safe: original.article.content_html_safe },
    });
    expect(identity.organization).not.toHaveBeenCalled();
    expect(identity.land).not.toHaveBeenCalled();
  });

  it('retries the retained capture with the same sign-in remedy while still a guest', async () => {
    const { edited, original } = await editedCapture();
    const saved = await saveCaptureAsSource(edited, { original, articleEdited: true });
    if (saved.status !== 'unsaved') throw new Error('Capture was not retained for guest retry');
    const result = await retryUnsavedCapture(saved.unsaved.id);

    expect(result).toMatchObject({
      status: 'unsaved',
      persisted: true,
      unsaved: {
        id: saved.unsaved.id,
        attempts: 2,
        lastRefusal: { code: 'sign_in_required', remedy: 'sign_in' },
      },
    });
    expect(await listUnsavedCaptures()).toHaveLength(1);
    expect(identity.organization).not.toHaveBeenCalled();
    expect(identity.land).not.toHaveBeenCalled();
  });

  it('lands a retained guest capture as the verified person after sign-in', async () => {
    const { edited, original } = await editedCapture();
    const saved = await saveCaptureAsSource(edited, { original, articleEdited: true });
    if (saved.status !== 'unsaved') throw new Error('Capture was not retained for sign-in');
    const verifiedPersonId = '9e110d75-8ecb-49a9-85df-53052ef5423f';
    identity.verified.mockResolvedValue({ id: verifiedPersonId });
    identity.organization.mockResolvedValue(organizationId);

    expect(await retryUnsavedCapture(saved.unsaved.id)).toEqual({
      status: 'landed',
      landed,
      organizationId,
    });
    expect(identity.land).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: organizationId,
        provenance: expect.objectContaining({ user_id: verifiedPersonId }),
        portions: [
          expect.objectContaining({
            text: 'New-patient intake\nBring your insurance card and completed intake form.',
          }),
        ],
      }),
    );
    expect((await chrome.storage.local.get(UNSAVED_CAPTURES_KEY))[UNSAVED_CAPTURES_KEY]).toEqual(
      [],
    );
  });

  it('preserves an organization-read refusal for a verified person', async () => {
    identity.verified.mockResolvedValue({ id: personId });
    const { edited } = await editedCapture();
    expect(await saveCaptureAsSource(edited, { articleEdited: true })).toMatchObject({
      status: 'unsaved',
      persisted: true,
      unsaved: {
        lastRefusal: { code: 'no_organization', remedy: 'choose_a_workspace' },
      },
    });
    expect(identity.organization).toHaveBeenCalledOnce();
    expect(identity.land).not.toHaveBeenCalled();
  });
});
