/**
 * The capture ladder's server calls — CONTRACT.md §4, prefix `/capture`.
 *
 * WRITES NEVER GO TO SUPABASE FROM HERE. The extension READS
 * `media.capture_handoff` directly (there is no outbound channel from aidream
 * to the extension — CHANNELS.md §2), but every state change rides these
 * endpoints so the ladder law, the rung knobs and the Library landing are
 * enforced in exactly one place. A second write path would be a second
 * spelling of the ladder.
 *
 * Conventions copied from `prospects.ts` / `vault.ts` in this folder:
 *
 *  1. **A real user JWT or nothing.** `client.ts#buildHeaders` falls back to a
 *     guest fingerprint when no session exists; a guest has no organization
 *     and no Library, so this short-circuits rather than burning a round trip
 *     to earn an opaque 401.
 *  2. **No second HTTP client** — everything goes through `apiPost`/`apiGet`,
 *     which is also what attaches `X-Organization-Id`. That header is
 *     mandatory and is never assembled at a call site.
 *  3. **The wire shape is declared here**, mirroring aidream's `/capture/*`
 *     handlers, same as every other route module in this folder.
 */

import { type ApiResult, STATUS_INVALID_BODY, apiGet, apiPost } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';
import {
  DEFAULT_OWN_BROWSER_SCROLL_PASSES,
  type Handoff,
  type HandoffStatus,
  handoffSchema,
} from '@/lib/capture-ladder/types';

const BASE = '/capture/handoffs';

function signedOut(): { ok: false; error: string; status: number } {
  return { ok: false, status: 401, error: 'sign_in_required' };
}

/** `POST …/claim` — one browser at a time; the claim expires server-side. */
export interface ClaimBody {
  client: 'chrome-extension';
  ttl_seconds?: number;
}

/** One timed caption line, for a `youtube_captions` hand-off. */
export interface CaptionLineBody {
  start: number;
  end: number;
  text: string;
}

/**
 * The caption track a `youtube_captions` hand-off comes back with.
 *
 * `available_languages` is every language this browser could SEE a track for.
 * It becomes `research.youtube_video.caption_languages`, which outranks
 * YouTube's own `has_captions` claim for every later decision about this video
 * — so it is what a browser YouTube trusts was actually shown, never a guess.
 */
export interface CaptionTrackBody {
  language: string;
  is_auto_generated: boolean;
  available_languages: string[];
  segments: CaptionLineBody[];
}

/** `POST …/result` — THE one door a capture enters the platform through. */
export interface ResultBody {
  ok: boolean;
  captured_by_rung: 'own_browser' | 'human_drive';
  chars?: number;
  title?: string;
  text?: string;
  html?: string;
  final_url?: string;
  note?: string;
  /**
   * Present for a `youtube_captions` hand-off, absent for a page. WHICH ONE the
   * server expects is the ROW's own kind, not this field's presence — sending
   * the wrong one is refused rather than quietly converted.
   */
  caption_track?: CaptionTrackBody;
}

export interface ResultResponse {
  handoff: unknown;
  library_item_id: string;
  library_id: string;
}

/** `POST …/needs-drive` — rung 3 failed; ask the person. */
export interface NeedsDriveBody {
  reason: string;
  /** ONE plain sentence. The person reads this, so it is never a code. */
  note: string;
}

export interface HandoffListResponse {
  items: unknown[];
  counts: Partial<Record<HandoffStatus, number>>;
}

export async function claimHandoff(
  id: string,
  body: ClaimBody = { client: 'chrome-extension' },
  signal?: AbortSignal,
): Promise<ApiResult<Handoff>> {
  if (!(await getAccessToken())) return signedOut();
  const res = await apiPost<unknown>(`${BASE}/${id}/claim`, body, signal);
  return parseHandoff(res);
}

export async function postCaptureResult(
  id: string,
  body: ResultBody,
  signal?: AbortSignal,
): Promise<ApiResult<ResultResponse>> {
  if (!(await getAccessToken())) return signedOut();
  return apiPost<ResultResponse>(`${BASE}/${id}/result`, body, signal);
}

export async function postNeedsDrive(
  id: string,
  body: NeedsDriveBody,
  signal?: AbortSignal,
): Promise<ApiResult<Handoff>> {
  if (!(await getAccessToken())) return signedOut();
  const res = await apiPost<unknown>(`${BASE}/${id}/needs-drive`, body, signal);
  return parseHandoff(res);
}

export async function dismissHandoff(
  id: string,
  note?: string,
  signal?: AbortSignal,
): Promise<ApiResult<Handoff>> {
  if (!(await getAccessToken())) return signedOut();
  const res = await apiPost<unknown>(
    `${BASE}/${id}/dismiss`,
    note !== undefined ? { note } : {},
    signal,
  );
  return parseHandoff(res);
}

/**
 * The rung knobs (CONTRACT.md §6) — read from the EXISTING media-catalog knob
 * registry, never from a constant here. This is a fifth call beyond §4's four
 * because §6 names `GET /media/settings` as where these live; the ladder adds
 * no settings substrate of its own.
 *
 * When the knobs cannot be read the caller gets the documented defaults AND a
 * sentence saying so, because a silently-assumed limit is exactly the
 * hardcoded taste the knob exists to remove.
 */
export interface CapturePolicy {
  scroll_passes: number;
  human_drive_minutes: number;
  /** Null when the knobs were read. A sentence when they were not. */
  degraded_note: string | null;
}

export const DEFAULT_CAPTURE_POLICY: CapturePolicy = {
  scroll_passes: DEFAULT_OWN_BROWSER_SCROLL_PASSES,
  human_drive_minutes: 10,
  degraded_note: null,
};

interface MediaSettingsResponse {
  values?: Record<string, unknown> | null;
}

function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

export async function getCapturePolicy(signal?: AbortSignal): Promise<CapturePolicy> {
  if (!(await getAccessToken())) {
    return {
      ...DEFAULT_CAPTURE_POLICY,
      degraded_note:
        'Not signed in, so your organization’s capture settings could not be read — the ' +
        'standard defaults were used. Sign in and run these again to use your own settings.',
    };
  }
  const res = await apiGet<MediaSettingsResponse>('/media/settings', signal);
  if (!res.ok) {
    return {
      ...DEFAULT_CAPTURE_POLICY,
      degraded_note:
        'Your organization’s capture settings could not be read just now, so the standard ' +
        `defaults were used (${DEFAULT_OWN_BROWSER_SCROLL_PASSES} scroll passes).`,
    };
  }
  const values = res.data?.values ?? {};
  return {
    scroll_passes: asPositiveInt(
      values.own_browser_scroll_passes,
      DEFAULT_CAPTURE_POLICY.scroll_passes,
    ),
    human_drive_minutes: asPositiveInt(
      values.human_drive_minutes,
      DEFAULT_CAPTURE_POLICY.human_drive_minutes,
    ),
    degraded_note: null,
  };
}

/**
 * The server's envelope is validated here rather than trusted. A body that
 * does not parse is a server-shape bug, and `STATUS_INVALID_BODY` exists in
 * `client.ts` precisely so it is not misreported as the user's network.
 */
function parseHandoff(res: ApiResult<unknown>): ApiResult<Handoff> {
  if (!res.ok) return res;
  const parsed = handoffSchema.safeParse(res.data);
  if (!parsed.success) {
    return {
      ok: false,
      status: STATUS_INVALID_BODY,
      error: `capture handoff response did not match the contract: ${parsed.error.message}`,
    };
  }
  return { ok: true, data: parsed.data };
}
