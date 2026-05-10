/**
 * Audio Transcription Constants
 *
 * Single source of truth for audio recording / transcription limits.
 * Ported from matrx-frontend/features/audio/constants.ts.
 *
 * Difference from the source: API routes are absolute URLs, built lazily
 * from ENV.FRONTEND_URL — the extension hits the matrx-frontend Next.js
 * routes directly with a Bearer token.
 */

import { ENV } from '@/config/env';

// ── Groq Developer Plan limits ──────────────────────────────────────────────
export const GROQ_LIMITS = {
  MAX_DIRECT_UPLOAD_BYTES: 25 * 1024 * 1024,
  MAX_URL_UPLOAD_BYTES: 100 * 1024 * 1024,
  RPM: 20,
  RPD: 2_000,
  AUDIO_SECONDS_PER_HOUR: 7_200,
  AUDIO_SECONDS_PER_DAY: 28_800,
  MIN_BILLED_SECONDS: 10,
  OPTIMAL_SEGMENT_SECONDS: 30,
  MODEL: 'whisper-large-v3-turbo' as const,
} as const;

// ── Vercel Pro Plan limits ──────────────────────────────────────────────────
export const VERCEL_LIMITS = {
  MAX_BODY_BYTES: 4.5 * 1024 * 1024,
  MAX_FUNCTION_DURATION_DEFAULT: 300,
  MAX_FUNCTION_DURATION_FLUID: 800,
} as const;

// ── Recording limits (derived from provider constraints) ────────────────────
export const AUDIO_LIMITS = {
  MAX_CHUNK_SIZE_BYTES: 4 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
  MAX_DURATION_SECONDS: 3_600,
  WARN_DURATION_SECONDS: 3_000,
  // Steady-state chunk window after the front-loaded first three chunks.
  // Ported from matrx-frontend (10s = under Vercel's 4.5MB body limit at
  // 16kHz webm/opus, and well within Whisper's ~30s optimal segment).
  CHUNK_DURATION_MS: 10_000,
  ESTIMATED_BYTES_PER_SECOND: 16_000,
  MIN_CHUNK_BYTES: 1_024,
} as const;

// ── Retry configuration ─────────────────────────────────────────────────────
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1_000,
  MAX_DELAY_MS: 8_000,
  RETRYABLE_STATUS_CODES: [429, 500, 502, 503, 504] as readonly number[],
} as const;

// ── API routes (absolute URLs to matrx-frontend) ────────────────────────────
// Lazy getters so module load doesn't crash if FRONTEND_URL is somehow
// unavailable at import time (e.g. tsx catalog script).
export const AUDIO_API_ROUTES = {
  get TRANSCRIBE() {
    return `${ENV.FRONTEND_URL}/api/audio/transcribe`;
  },
  get TRANSCRIBE_URL() {
    return `${ENV.FRONTEND_URL}/api/audio/transcribe-url`;
  },
  get LOG_ERROR() {
    return `${ENV.FRONTEND_URL}/api/audio/log-error`;
  },
  get CARTESIA_TOKEN() {
    return `${ENV.FRONTEND_URL}/api/cartesia`;
  },
} as const;

// ── IndexedDB configuration ─────────────────────────────────────────────────
export const SAFETY_STORE_CONFIG = {
  DB_NAME: 'matrx_audio_safety',
  STORE_NAME: 'recordings',
  DB_VERSION: 1,
} as const;

// ── Allowed MIME types ──────────────────────────────────────────────────────
export const ALLOWED_AUDIO_TYPES = [
  'audio/flac',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/mpga',
  'audio/m4a',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
] as const;

export type RecordingStatus =
  | 'idle'
  | 'requesting-permission'
  | 'recording'
  | 'paused'
  | 'stopped'
  | 'error';

export const RECORDING_ERROR_CODES = {
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NO_MICROPHONE: 'NO_MICROPHONE',
  DURATION_EXCEEDED: 'DURATION_EXCEEDED',
  SIZE_EXCEEDED: 'SIZE_EXCEEDED',
  BROWSER_NOT_SUPPORTED: 'BROWSER_NOT_SUPPORTED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  TRANSCRIPTION_ERROR: 'TRANSCRIPTION_ERROR',
  RATE_LIMIT: 'RATE_LIMIT',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  UNKNOWN: 'UNKNOWN',
} as const;

// ── Supported translation languages (TASK-002, multilingual TTS) ────────────
// Cartesia language codes for the 6 user-required languages.
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'fa', label: 'Persian / Farsi' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ru', label: 'Russian' },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];
