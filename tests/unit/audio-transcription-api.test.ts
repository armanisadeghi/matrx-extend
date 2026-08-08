import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getBackendUrlMock = vi.hoisted(() => vi.fn());
const getAccessTokenMock = vi.hoisted(() => vi.fn());
const refreshAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/config/backend', () => ({ getBackendUrl: getBackendUrlMock }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: getAccessTokenMock,
  refreshAccessToken: refreshAccessTokenMock,
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
});

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

  it('extracts FastAPI detail errors', () => {
    expect(transcriptionErrorMessage({ detail: 'An audio file is required' }, 400)).toBe(
      'An audio file is required',
    );
  });
});
