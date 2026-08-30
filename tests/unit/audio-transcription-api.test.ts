import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getBackendUrlMock = vi.hoisted(() => vi.fn());
const getAccessTokenMock = vi.hoisted(() => vi.fn());
const refreshAccessTokenMock = vi.hoisted(() => vi.fn());
const requireActiveOrganizationIdMock = vi.hoisted(() => vi.fn());

vi.mock('@/config/backend', () => ({ getBackendUrl: getBackendUrlMock }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: getAccessTokenMock,
  refreshAccessToken: refreshAccessTokenMock,
}));
vi.mock('@/lib/org/active-org', () => ({
  requireActiveOrganizationId: requireActiveOrganizationIdMock,
}));

import { postTranscriptionForm, transcriptionErrorMessage } from '@/lib/audio/transcription-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  getBackendUrlMock.mockReset().mockResolvedValue('https://server.example.test');
  getAccessTokenMock.mockReset().mockResolvedValue('token-1');
  refreshAccessTokenMock.mockReset().mockResolvedValue(false);
  requireActiveOrganizationIdMock.mockReset().mockResolvedValue(ORG_ID);
});

const ORG_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audio transcription API', () => {
  it('posts multipart audio to the current aidream route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, text: 'hello' }));
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();
    form.append('file', new Blob(['audio'], { type: 'audio/webm' }), 'chunk.webm');

    const result = await postTranscriptionForm(form);

    expect(result.body.text).toBe('hello');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example.test/audio/transcribe',
      expect.objectContaining({
        method: 'POST',
        body: form,
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token-1',
        }),
      }),
    );
  });

  it('turns an HTML not-found page into an actionable service error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!DOCTYPE html><html>not found</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      ),
    );

    await expect(postTranscriptionForm(new FormData())).rejects.toThrow(
      'Transcription service returned an unexpected response (HTTP 200).',
    );
  });

  it('refreshes an expired token once and retries the same form', async () => {
    getAccessTokenMock.mockResolvedValueOnce('expired').mockResolvedValueOnce('fresh');
    refreshAccessTokenMock.mockResolvedValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ success: true, text: 'recovered' }));
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();

    const result = await postTranscriptionForm(form);

    expect(result.body.text).toBe('recovered');
    expect(refreshAccessTokenMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: form,
        headers: expect.objectContaining({ Authorization: 'Bearer fresh' }),
      }),
    );
  });

  it('carries the organization on the upload, like every other request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, text: 'hi' }));
    vi.stubGlobal('fetch', fetchMock);

    await postTranscriptionForm(new FormData());

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Organization-Id': ORG_ID }),
      }),
    );
  });

  it('does not upload audio at all when no organization is selected', async () => {
    requireActiveOrganizationIdMock.mockRejectedValue(new Error('No organization is selected.'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(postTranscriptionForm(new FormData())).rejects.toThrow('No organization');
    // The point: the recording never leaves the browser to earn a 400.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts FastAPI detail errors', () => {
    expect(transcriptionErrorMessage({ detail: 'An audio file is required' }, 400)).toBe(
      'An audio file is required',
    );
  });
});
