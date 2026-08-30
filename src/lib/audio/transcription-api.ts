/**
 * Authenticated multipart transport for aidream speech-to-text.
 *
 * The old matrx-frontend `/api/audio/transcribe` proxy was removed when
 * speech utilities moved into aidream. Keep URL selection and 401 repair
 * aligned with the extension's canonical API clients, while retaining a
 * multipart body (the JSON client cannot send FormData).
 */

import { getBackendUrl } from '@/config/backend';
import { getAccessToken, refreshAccessToken } from '@/lib/auth/flow';
import { AUDIO_API_ROUTES } from './constants';
import { requireActiveOrganizationId } from '@/lib/org/active-org';

export type TranscriptionResponseBody = Record<string, unknown>;

export interface TranscriptionHttpResult {
  response: Response;
  body: TranscriptionResponseBody;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function parseResponseBody(response: Response): Promise<TranscriptionResponseBody> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const raw = await response.text();

  // A reverse-proxy/not-found page used to return HTML with status 200.
  // Never feed it to JSON.parse: that leaks an engine-level "Unexpected
  // token '<'" into the UI and misdiagnoses every recorded chunk.
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Transcription service returned an unexpected response (HTTP ${response.status}).`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Transcription service returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Transcription service returned an invalid payload (HTTP ${response.status}).`);
  }
  if (response.ok && (parsed.success !== true || typeof parsed.text !== 'string')) {
    throw new Error('Transcription service returned an incomplete payload.');
  }
  return parsed;
}

async function send(
  url: string,
  form: FormData,
  token: string,
  organizationId: string,
): Promise<TranscriptionHttpResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Organization-Id': organizationId,
    },
    body: form,
  });
  return { response, body: await parseResponseBody(response) };
}

/**
 * POST one transcription body, refreshing an expired user session once.
 * Transcription deliberately requires a real user token (no guest fallback).
 */
export async function postTranscriptionForm(form: FormData): Promise<TranscriptionHttpResult> {
  let token = await getAccessToken();
  if (!token) {
    throw new Error('Not signed in. Please sign in to use voice input.');
  }

  // Same law as every other sink: identity and organization travel together.
  const organizationId = await requireActiveOrganizationId();
  const url = `${await getBackendUrl()}${AUDIO_API_ROUTES.TRANSCRIBE}`;
  const result = await send(url, form, token, organizationId);
  if (result.response.status !== 401) return result;

  const refreshed = await refreshAccessToken();
  if (!refreshed) return result;
  token = await getAccessToken();
  if (!token) return result;
  return send(url, form, token, organizationId);
}

export function transcriptionErrorMessage(body: TranscriptionResponseBody, status: number): string {
  for (const key of ['error', 'details', 'detail'] as const) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (isRecord(value) && typeof value.error === 'string' && value.error.trim()) {
      return value.error;
    }
  }
  if (status === 401) return 'Your session expired. Please sign in again.';
  return `Transcription failed (HTTP ${status}).`;
}
