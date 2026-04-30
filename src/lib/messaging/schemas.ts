/**
 * Cross-context message channel schemas.
 *
 * Every webext-bridge channel has a Zod schema for both request and response.
 * Channels live here so SW + side panel + content + offscreen import the same
 * type and get free runtime validation.
 */

import { z } from 'zod';

// ─── auth ───────────────────────────────────────────────────────────────────
export const AuthStateChangedPayloadSchema = z.object({
  type: z.literal('auth:state-changed'),
  user: z
    .object({
      id: z.string(),
      email: z.string().nullable(),
    })
    .nullable(),
});
export type AuthStateChangedPayload = z.infer<typeof AuthStateChangedPayloadSchema>;

// ─── streaming ──────────────────────────────────────────────────────────────
export const StreamStartRequestSchema = z.object({
  runId: z.string().min(1),
  endpoint: z.string().min(1),
  body: z.unknown(),
  parser: z.enum(['text-chunks', 'rich-events']).default('rich-events'),
});
export type StreamStartRequest = z.infer<typeof StreamStartRequestSchema>;

export const StreamCancelRequestSchema = z.object({
  runId: z.string().min(1),
});
export type StreamCancelRequest = z.infer<typeof StreamCancelRequestSchema>;

export const StreamChunkSchema = z.object({
  runId: z.string(),
  type: z.enum(['text', 'event', 'error', 'done']),
  payload: z.unknown(),
});
export type StreamChunk = z.infer<typeof StreamChunkSchema>;

// ─── scrape ─────────────────────────────────────────────────────────────────
export const ScrapeCapturePageRequestSchema = z.object({
  tabId: z.number().int().nonnegative().optional(),
  options: z
    .object({
      includeImages: z.boolean().default(true),
      includeVideos: z.boolean().default(true),
      includeLinks: z.boolean().default(true),
      includeStructured: z.boolean().default(true),
      preferDefuddle: z.boolean().default(true),
    })
    .partial()
    .default({}),
});
export type ScrapeCapturePageRequest = z.infer<typeof ScrapeCapturePageRequestSchema>;

// ─── data picker ────────────────────────────────────────────────────────────
export const DataPickerEnterRequestSchema = z.object({
  patternId: z.string().uuid().optional(),
  domain: z.string().optional(),
});
export type DataPickerEnterRequest = z.infer<typeof DataPickerEnterRequestSchema>;

// ─── desktop bridge ─────────────────────────────────────────────────────────
export const DesktopAvailabilityPayloadSchema = z.object({
  available: z.boolean(),
  transport: z.enum(['native', 'http', 'none']),
  version: z.string().optional(),
  lastChecked: z.number().int().nonnegative(),
});
export type DesktopAvailabilityPayload = z.infer<typeof DesktopAvailabilityPayloadSchema>;

/**
 * Channel name registry. Use these constants instead of string literals.
 */
export const CHANNELS = {
  AUTH_STATE_CHANGED: 'auth:state-changed',
  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',

  STREAM_START: 'stream:start',
  STREAM_CANCEL: 'stream:cancel',
  STREAM_CHUNK: 'stream:chunk',

  SCRAPE_CAPTURE: 'scrape:capture-page',
  SCRAPE_DONE: 'scrape:done',

  DATA_PICKER_ENTER: 'data:picker-enter',
  DATA_PICKER_EXIT: 'data:picker-exit',
  DATA_PICKER_RESULT: 'data:picker-result',

  DESKTOP_AVAILABILITY: 'desktop:availability',
  DESKTOP_RPC: 'desktop:rpc',

  PAGE_NAVIGATED: 'page:navigated',
  PAGE_ALREADY_CAPTURED: 'page:already-captured',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
