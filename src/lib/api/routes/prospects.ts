/**
 * Prospect capture routes — IC-10's browser half.
 *
 * The ONE server contract this extension has with the prospecting pipeline:
 *
 *   POST /api/seo/prospect-capture/preview   — verdict + prior relationship
 *   POST /api/seo/prospect-capture           — commit
 *
 * 🚨 **There is no second door and there must never be one.** The server
 * endpoints are a thin composition over `prospect_import`, so a captured
 * domain gets the SAME blocklist check at ingestion, the SAME party-resolver
 * normalization, the SAME dedupe, and the SAME triage row as a searched or
 * pasted one. This module must never write a prospect table directly through
 * Supabase, and must never carry its own domain normalizer — a second spelling
 * of a domain is a second party for the same company.
 *
 * Rules, matching `vault.ts`:
 *
 * 1. **A real user JWT or nothing.** `client.ts#buildHeaders` falls back to a
 *    guest fingerprint identity when no session exists; a guest has no
 *    organization worth capturing into, so this short-circuits on
 *    `getAccessToken()` and reports `sign_in_required` rather than letting the
 *    request go out and return an opaque 401.
 * 2. **No second HTTP client** — everything goes through `apiPost`, so bearer
 *    injection, 401-refresh-retry, timeouts and the `ApiResult` envelope stay
 *    in one place.
 * 3. **The wire shape is declared here**, same convention as every other route
 *    module in this folder (`types/python-generated/api-types.ts` is gitignored
 *    and no `src/**` module imports it). It mirrors aidream's
 *    `ProspectCapturePreview` / `ProspectCaptureResult`
 *    (aidream/services/seo/prospect_capture.py).
 */

import { type ApiResult, apiPost } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';

const BASE = '/api/seo/prospect-capture';

/** One website the user could file this prospect under. */
export interface CaptureSite {
  site_id: string;
  label: string;
  organization_id: string;
}

/**
 * What the user's CRM already holds for this domain. Present ONLY when a party
 * exists — an object full of zeroes would read as a record we hold and don't.
 */
export interface PriorRelationship {
  party_id: string;
  display_name: string;
  do_not_contact: boolean;
  interaction_count: number;
  last_interaction_at: string | null;
  campaigns: string[];
  confirmed_wins: number;
  last_win_at: string | null;
  summary: string;
}

export type CaptureVerdict = 'new' | 'existing' | 'blocklisted' | 'unusable';

export interface ProspectCapturePreview {
  url: string;
  domain: string | null;
  site_id: string | null;
  site_label: string | null;
  verdict: CaptureVerdict;
  why: string;
  prior_relationship: PriorRelationship | null;
  sites: CaptureSite[];
  site_choice_required: boolean;
}

export interface ProspectCaptureResult {
  url: string;
  domain: string | null;
  site_id: string;
  site_label: string | null;
  outcome: 'created' | 'matched' | 'skipped';
  why: string;
  prior_relationship: PriorRelationship | null;
}

export interface ProspectCaptureBody {
  url: string;
  site_id?: string;
  page_title?: string;
}

function signedOut(): { ok: false; error: string; status: number } {
  return { ok: false, status: 401, error: 'sign_in_required' };
}

export async function previewProspectCapture(
  body: ProspectCaptureBody,
  signal?: AbortSignal,
): Promise<ApiResult<ProspectCapturePreview>> {
  if (!(await getAccessToken())) return signedOut();
  return apiPost<ProspectCapturePreview>(`${BASE}/preview`, body, signal);
}

export async function captureProspect(
  body: ProspectCaptureBody,
  signal?: AbortSignal,
): Promise<ApiResult<ProspectCaptureResult>> {
  if (!(await getAccessToken())) return signedOut();
  return apiPost<ProspectCaptureResult>(BASE, body, signal);
}
