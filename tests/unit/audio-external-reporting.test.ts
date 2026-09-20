import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  mayReportExternalTelemetry: vi.fn(),
}));

vi.mock('@/lib/auth/flow', () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock('@/lib/telemetry/external-reporting', () => ({
  mayReportExternalTelemetry: mocks.mayReportExternalTelemetry,
}));

import { AUDIO_API_ROUTES } from '@/lib/audio/constants';
import { logAudioClientError } from '@/lib/audio/useChunkedRecordAndTranscribe';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  mocks.getAccessToken.mockResolvedValue('audio-token');
  mocks.mayReportExternalTelemetry.mockResolvedValue(true);
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audio error telemetry consent', () => {
  it('exports an audio error when external diagnostics are allowed', async () => {
    await logAudioClientError({ errorCode: 'CHUNK_FAILED', errorMessage: 'timed out' });

    expect(mocks.mayReportExternalTelemetry).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      AUDIO_API_ROUTES.LOG_ERROR,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it.each(['revoked', 'denied', 'missing permission API', 'permission lookup error'])(
    'does not export an audio error when Firefox diagnostics are %s',
    async () => {
      mocks.mayReportExternalTelemetry.mockResolvedValue(false);

      await logAudioClientError({ errorCode: 'CHUNK_FAILED', errorMessage: 'timed out' });

      expect(mocks.getAccessToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
