/**
 * The landing door — `POST /sources/land`, `/sources/{id}/keep`, `/sources/{id}/edit`
 * (aidream `aidream/api/routers/sources.py`; SOURCE-CONVERGENCE §3.1).
 *
 * Every page the person saves becomes a Source: a `docproc.processed_documents`
 * row. Writes go through these routes; READS never do — the Saved captures tab,
 * recognition and `prior_capture` read `processed_documents` directly from
 * Supabase under RLS (`src/lib/supabase/queries.ts`).
 *
 * The shapes mirror aidream's `content_processing/landing_types.py`
 * (`SourceLanding`, `LandedSource`, `LandingNotice`). `types/python-generated/`
 * is gitignored in this repo and no `src/**` module imports it, so this route
 * module declares the wire shape it consumes, like every other file here, and
 * validates the response with Zod rather than trusting it.
 */

import { type ApiResult, apiPost } from '@/lib/api/client';
import type { SectionPortion } from '@/lib/sources/portions';
import { z } from 'zod';

export type OriginClient = 'extension';
export type CaptureMethod = 'own_browser';

export interface SourceOriginal {
  bytes_b64: string;
  mime_type: string;
}

export interface SourceProvenance {
  origin_client: OriginClient;
  capture_method: CaptureMethod;
  captured_at: string;
  final_url: string | null;
  user_id: string;
}

export interface AttachTarget {
  entity_type: string;
  entity_id: string;
  label?: string;
}

/** `SourceLanding` — exactly the fields the extension sends (`extra="forbid"` server-side). */
export interface SourceLandingBody {
  source_kind: 'scrape_parsed_page';
  source_id: null;
  canonical_identity: string;
  name: string;
  mime_type: string;
  portions: SectionPortion[];
  original: SourceOriginal | null;
  structured: Record<string, unknown> | null;
  provenance: SourceProvenance;
  attach_to: AttachTarget[];
  keep: boolean;
  visibility: 'personal' | 'internal';
  organization_id: string;
}

export const LandingNoticeSchema = z.object({
  code: z.string(),
  message: z.string(),
  remedy: z.string().default(''),
});
export type LandingNotice = z.infer<typeof LandingNoticeSchema>;

export const LandedSourceSchema = z.object({
  processed_document_id: z.string().uuid(),
  source_id: z.string(),
  reused_existing: z.boolean(),
  new_version_of: z.string().nullable().optional(),
  kept: z.boolean(),
  intelligence: z.enum(['queued', 'deferred', 'never']),
  original_file_id: z.string().nullable().optional(),
  notices: z.array(LandingNoticeSchema).default([]),
});
export type LandedSource = z.infer<typeof LandedSourceSchema>;

/** Why a landing did not happen, in words a person can act on. */
export interface LandingRefusal {
  /** 0 = the server could not be reached; otherwise the HTTP status. */
  status: number;
  code: string;
  message: string;
  remedy: string;
  /** True when trying again later can succeed (unreachable, 5xx, timeouts). */
  retryable: boolean;
}

export type LandingOutcome =
  | { ok: true; landed: LandedSource }
  | { ok: false; refusal: LandingRefusal };

const UNREACHABLE: Omit<LandingRefusal, 'status'> = {
  code: 'server_unreachable',
  message:
    'The AI Matrx server could not be reached, so this page is not saved yet. It is kept on this device and will be saved when you retry.',
  remedy: 'retry_when_online',
  retryable: true,
};

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Turn a failed `ApiResult` into a refusal with the server's own sentence when it sent one. */
export function refusalFromResult(result: { status: number; error: string }): LandingRefusal {
  if (result.status === 0) return { status: 0, ...UNREACHABLE };
  if (result.status < 0) {
    // Client-side stops (no organization chosen, session not ready, unreadable
    // body): the client already wrote the sentence; carry it and keep the capture.
    return {
      status: result.status,
      code: 'not_sent',
      message: `${sentence(result.error || 'This page could not be sent')} It is kept on this device; retry once that is fixed.`,
      remedy: 'fix_and_retry',
      retryable: true,
    };
  }
  let detail: unknown = null;
  try {
    detail = (JSON.parse(result.error) as { detail?: unknown }).detail;
  } catch {
    detail = null;
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    if (typeof d.message === 'string' && d.message.trim()) {
      return {
        status: result.status,
        code: typeof d.code === 'string' ? d.code : 'refused',
        message: sentence(d.message),
        remedy: typeof d.remedy === 'string' ? d.remedy : '',
        retryable: d.retryable === true || result.status >= 500,
      };
    }
  }
  const retryable = result.status >= 500 || result.status === 408 || result.status === 429;
  return {
    status: result.status,
    code: retryable ? 'server_unavailable' : 'refused',
    message: retryable
      ? `The server could not save this page right now (error ${result.status}). It is kept on this device; retry in a moment.`
      : `The server refused to save this page (error ${result.status}). It is kept on this device so nothing is lost.`,
    remedy: retryable ? 'retry_later' : 'report_this',
    retryable,
  };
}

async function post(path: string, body: unknown): Promise<LandingOutcome> {
  let result: ApiResult<unknown>;
  try {
    result = await apiPost<unknown>(path, body);
  } catch (err) {
    return {
      ok: false,
      refusal: { status: 0, ...UNREACHABLE, message: `${UNREACHABLE.message} (${String(err)})` },
    };
  }
  if (!result.ok) return { ok: false, refusal: refusalFromResult(result) };
  const parsed = LandedSourceSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      ok: false,
      refusal: {
        status: 200,
        code: 'unexpected_response',
        message:
          'The server answered in a shape this version of the extension does not understand, so the save could not be confirmed. It is kept on this device; update the extension and retry.',
        remedy: 'update_the_extension',
        retryable: true,
      },
    };
  }
  return { ok: true, landed: parsed.data };
}

/** Land one capture as a Source. */
export function landSource(body: SourceLandingBody): Promise<LandingOutcome> {
  return post('/sources/land', body);
}

/** Save an edit beside the original (the original capture is never overwritten). */
export function editSource(
  processedDocumentId: string,
  portions: SectionPortion[],
): Promise<LandingOutcome> {
  return post(`/sources/${encodeURIComponent(processedDocumentId)}/edit`, { portions });
}

/** Keep and/or file a Source. */
export function keepSource(
  processedDocumentId: string,
  body: { keep?: boolean; attach_to?: AttachTarget[] } = {},
): Promise<LandingOutcome> {
  return post(`/sources/${encodeURIComponent(processedDocumentId)}/keep`, {
    keep: body.keep ?? true,
    attach_to: body.attach_to ?? [],
  });
}
