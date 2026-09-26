/**
 * Save a captured page as a Source — through the landing door, never lost.
 *
 * SOURCE-CONVERGENCE §4.2. A saved page is a Source (`docproc.processed_documents`)
 * landed by `POST /sources/land`:
 *   - `original`   = the full `SoupResult` JSON (the door keeps it in S3),
 *   - `portions`   = the article cut into H1–H3 sections (`portions.ts`),
 *   - `structured` = the collectors (images, videos, audio, links, ld_json,
 *                    metadata, pattern_id) so the Saved captures tab keeps its
 *                    Details / Data / Copy panes,
 *   - provenance `{origin_client:'extension', capture_method:'own_browser'}`,
 *     `keep: true`, `visibility: 'internal'` — a scrape is organization data (Arman, 2026-09-27;
 *     there is no personal option).
 *
 * NEVER LOSE INPUT. A refused or unreachable landing does not drop the capture:
 * it is written to `chrome.storage.local` and shown as an "Not yet a Source" (retry)
 * card until it lands. Only a successful landing removes it.
 */

import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import { type LandedSource, type LandingRefusal, landSource } from '@/lib/api/routes/sources';
import type { SourceLandingBody } from '@/lib/api/routes/sources';
import { getCurrentUser } from '@/lib/auth/flow';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { canonicalUrl } from '@/lib/sources/canonical';
import {
  type CapturePortions,
  buildCapturePortions,
  portionsFromMarkdown,
} from '@/lib/sources/portions';

function portionsFromEditedMarkdown(soup: SoupResult): CapturePortions {
  const portions = portionsFromMarkdown(soup.article.content_markdown);
  return { portions, from: portions.length > 0 ? 'article_markdown' : null };
}

export const UNSAVED_CAPTURES_KEY = 'matrx.sources.unsaved';
const UNSAVED_REVISION_KEY = 'matrx.sources.unsaved_revision';
const UNSAVED_TERMINALS_KEY = 'matrx.sources.unsaved_terminals';

/** A landing body before the send-time fields (organization, person) are stamped on. */
export type PreparedLanding = Omit<SourceLandingBody, 'organization_id' | 'provenance'> & {
  provenance: Omit<SourceLandingBody['provenance'], 'user_id'>;
};

export interface UnsavedCapture {
  id: string;
  url: string;
  title: string;
  /** Organization of the last attempted send, when one was selected. */
  organizationId?: string;
  /** Durable order of the Save/Retry start, independent of response arrival order. */
  revision?: number;
  createdAt: number;
  attempts: number;
  lastRefusal: LandingRefusal;
  prepared: PreparedLanding;
}

export type SaveOutcome =
  | { status: 'landed'; landed: LandedSource; organizationId: string }
  | { status: 'unsaved'; unsaved: UnsavedCapture; persisted?: boolean }
  | { status: 'empty'; message: string };

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function captureName(soup: SoupResult): string {
  const title = soup.article.title?.trim() || soup.metadata.title?.trim();
  if (title) return title;
  try {
    return new URL(soup.url).hostname || soup.url;
  } catch {
    return soup.url;
  }
}

/** The collectors that ride on the Source's `structured_json`. */
export function structuredFromSoup(soup: SoupResult, patternId?: string): Record<string, unknown> {
  return {
    url: soup.url,
    images: soup.images,
    videos: soup.videos,
    audio: soup.audio,
    links: soup.links,
    ld_json: soup.ld_json,
    metadata: soup.metadata,
    pattern_id: patternId ?? null,
    article: {
      title: soup.article.title,
      byline: soup.article.byline,
      excerpt: soup.article.excerpt,
      extractor: soup.article.extractor,
      word_count: soup.article.word_count,
      reading_time_minutes: soup.article.reading_time_minutes,
    },
    raw_html_size: soup.raw_html_size,
  };
}

/** Everything the door needs that is known at capture time. Null = nothing to save. */
export interface CaptureSaveOptions {
  patternId?: string;
  /**
   * The capture as it came off the page, before local edits — kept as the
   * Source's original. Defaults to `soup` when nothing was edited.
   */
  original?: SoupResult;
  /**
   * The person edited the article text: cut the portions from the edited
   * markdown. The captured HTML still carries the pre-edit text, so preferring
   * it would silently save the original words instead of theirs.
   */
  articleEdited?: boolean;
}

export function prepareLanding(
  soup: SoupResult,
  extra: CaptureSaveOptions = {},
): PreparedLanding | null {
  const { portions, from } = extra.articleEdited
    ? portionsFromEditedMarkdown(soup)
    : buildCapturePortions(soup);
  if (portions.length === 0) return null;
  return {
    source_kind: 'scrape_parsed_page',
    source_id: null,
    canonical_identity: canonicalUrl(soup.url),
    name: captureName(soup),
    mime_type: from === 'article_markdown' ? 'text/markdown' : 'text/plain',
    portions,
    original: {
      bytes_b64: utf8ToBase64(JSON.stringify(extra.original ?? soup)),
      mime_type: 'application/json',
    },
    structured: structuredFromSoup(soup, extra.patternId),
    provenance: {
      origin_client: 'extension',
      capture_method: 'own_browser',
      captured_at: new Date(soup.capturedAt || Date.now()).toISOString(),
      final_url: soup.url || null,
    },
    attach_to: [],
    keep: true,
    visibility: 'internal',
  };
}

type SendResult =
  | { ok: true; landed: LandedSource; organizationId: string }
  | { ok: false; refusal: LandingRefusal; organizationId?: string };

async function send(prepared: PreparedLanding): Promise<SendResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.id) {
    return {
      ok: false,
      refusal: {
        status: 401,
        code: 'sign_in_required',
        message:
          'You are signed out, so this page is not yet a Source. It is kept on this device; sign in and retry.',
        remedy: 'sign_in',
        retryable: true,
      },
    };
  }
  let organizationId: string;
  try {
    organizationId = await requireRequestOrganizationId();
  } catch (err) {
    const why = err instanceof Error ? err.message : 'No workspace is selected.';
    return {
      ok: false,
      refusal: {
        status: -2,
        code: 'no_organization',
        message: `${why.trim().replace(/[.!?]?$/, '.')} This page is kept on this device; choose a workspace and retry.`,
        remedy: 'choose_a_workspace',
        retryable: true,
      },
    };
  }
  const body: SourceLandingBody = {
    ...prepared,
    organization_id: organizationId,
    provenance: { ...prepared.provenance, user_id: user.id },
  };
  const result = await landSource(body);
  return { ...result, organizationId };
}

// ─── The unsaved queue (chrome.storage.local) ──────────────────────────────

export async function listUnsavedCaptures(): Promise<UnsavedCapture[]> {
  const got = await chrome.storage.local.get(UNSAVED_CAPTURES_KEY);
  const rows = got[UNSAVED_CAPTURES_KEY];
  return Array.isArray(rows) ? (rows as UnsavedCapture[]) : [];
}

async function writeUnsaved(rows: UnsavedCapture[]): Promise<void> {
  await chrome.storage.local.set({ [UNSAVED_CAPTURES_KEY]: rows });
}

let localQueueTail: Promise<void> = Promise.resolve();

/** Serialize read/write decisions across extension contexts when Web Locks is available. */
async function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('matrx:sources:unsaved-queue', operation);
  }
  // Local fallback for environments without Web Locks; the extension's Save
  // and Retry callers currently live together in the side panel.
  const prior = localQueueTail;
  let release!: () => void;
  localQueueTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    return await operation();
  } finally {
    release();
  }
}

/** Reserve order before network I/O, so a slow old refusal cannot become newest. */
async function reserveQueueRevision(): Promise<number> {
  return withQueueLock(async () => {
    const stored = await chrome.storage.local.get(UNSAVED_REVISION_KEY);
    const prior = stored[UNSAVED_REVISION_KEY];
    const revision =
      typeof prior === 'number' && Number.isSafeInteger(prior) && prior >= 0 ? prior : 0;
    if (revision === Number.MAX_SAFE_INTEGER) throw new Error('Save order on this device is full.');
    await chrome.storage.local.set({ [UNSAVED_REVISION_KEY]: revision + 1 });
    return revision + 1;
  });
}

/** Durable tombstones survive panel reload and deletion of the queue row. */
async function terminalRevisions(): Promise<Record<string, number>> {
  const stored = await chrome.storage.local.get(UNSAVED_TERMINALS_KEY);
  return stored[UNSAVED_TERMINALS_KEY] ?? {};
}

/**
 * The queue is keyed by the page's canonical URL: one entry per page. A
 * re-save of a page already waiting REPLACES its entry (newest content, same
 * id, attempts counted) — it never adds a second card for the same page.
 */
async function upsertUnsaved(row: UnsavedCapture): Promise<UnsavedCapture | null> {
  return withQueueLock(async () => {
    const rows = await listUnsavedCaptures();
    const key = canonicalUrl(row.url);
    const terminals = await terminalRevisions();
    if ((terminals[key] ?? 0) >= (row.revision ?? 0)) return null;
    const prior = rows.find((r) => r.id === row.id || canonicalUrl(r.url) === key);
    if (prior && (prior.revision ?? 0) > (row.revision ?? 0)) return prior;
    const merged = prior
      ? {
          ...row,
          id: prior.id,
          createdAt: prior.createdAt,
          attempts: prior.attempts + row.attempts,
        }
      : row;
    await writeUnsaved([
      ...rows.filter((r) => r.id !== merged.id && canonicalUrl(r.url) !== key),
      merged,
    ]);
    return merged;
  });
}

/** A page that landed leaves the queue, whichever control landed it. */
async function dropUnsavedForUrl(
  url: string,
  revision: number,
  organizationId: string,
  retryRowId?: string,
): Promise<void> {
  await withQueueLock(async () => {
    const rows = await listUnsavedCaptures();
    const key = canonicalUrl(url);
    const queued = rows.find((r) => canonicalUrl(r.url) === key);
    const terminals = await terminalRevisions();
    const completed = { ...terminals, [key]: Math.max(terminals[key] ?? 0, revision) };
    if (
      queued &&
      (queued.revision ?? 0) <= revision &&
      (!queued.organizationId ||
        queued.organizationId === organizationId ||
        queued.id === retryRowId)
    ) {
      await chrome.storage.local.set({
        [UNSAVED_CAPTURES_KEY]: rows.filter((r) => r.id !== queued.id),
        [UNSAVED_TERMINALS_KEY]: completed,
      });
    } else {
      await chrome.storage.local.set({ [UNSAVED_TERMINALS_KEY]: completed });
    }
  }).catch((err) => {
    throw new Error(`The Source landed, but its retry state could not be updated on this device (${String(err)}). Keep this panel open and retry once device storage is available.`);
  });
}

export async function discardUnsavedCapture(id: string): Promise<void> {
  await withQueueLock(async () => {
    const rows = await listUnsavedCaptures();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const stored = await chrome.storage.local.get(UNSAVED_REVISION_KEY);
    const terminals = await terminalRevisions();
    const key = canonicalUrl(row.url);
    await chrome.storage.local.set({
      [UNSAVED_CAPTURES_KEY]: rows.filter((r) => r.id !== id),
      [UNSAVED_TERMINALS_KEY]: {
        ...terminals,
        [key]: Math.max(terminals[key] ?? 0, stored[UNSAVED_REVISION_KEY] ?? 0, row.revision ?? 0),
      },
    });
  });
}

export function onUnsavedCapturesChange(cb: (rows: UnsavedCapture[]) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(UNSAVED_CAPTURES_KEY in changes)) return;
    const next = changes[UNSAVED_CAPTURES_KEY]?.newValue;
    cb(Array.isArray(next) ? (next as UnsavedCapture[]) : []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `unsaved-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Save a capture. Lands it, or keeps it on this device under "Not yet a Source" (retry).
 * Never throws for a refusal or an outage: the outcome says what happened.
 */
export async function saveCaptureAsSource(
  soup: SoupResult,
  extra: CaptureSaveOptions = {},
): Promise<SaveOutcome> {
  const prepared = prepareLanding(soup, extra);
  if (!prepared) {
    return {
      status: 'empty',
      message:
        'This capture has no article text, so there is nothing to save. Try "Scroll & capture" to load the page fully, then save again.',
    };
  }
  let revision: number;
  try {
    revision = await reserveQueueRevision();
  } catch (err) {
    return {
      status: 'unsaved', persisted: false,
      unsaved: {
        id: newId(), url: soup.url, title: prepared.name, prepared,
        createdAt: Date.now(), attempts: 0,
        lastRefusal: {
          status: -3, code: 'device_storage_unavailable', retryable: true,
          remedy: 'keep_panel_open_and_retry',
          message: `This page was not sent or saved on this device because device storage is unavailable (${String(err)}). Keep this panel open and retry; your editable capture is still here.`,
        },
      },
    };
  }
  const result = await send(prepared);
  if (result.ok) {
    await dropUnsavedForUrl(soup.url, revision, result.organizationId);
    return { status: 'landed', landed: result.landed, organizationId: result.organizationId };
  }
  let unsaved: UnsavedCapture = {
    id: newId(),
    url: soup.url,
    title: prepared.name,
    ...(result.organizationId && { organizationId: result.organizationId }),
    revision,
    createdAt: Date.now(),
    attempts: 1,
    lastRefusal: result.refusal,
    prepared,
  };
  try {
    const queued = await upsertUnsaved(unsaved);
    if (!queued) return { status: 'empty', message: 'A newer save or discard already completed for this page.' };
    unsaved = queued;
  } catch (err) {
    // The device store refused too (quota, storage disabled). The capture is
    // still open in the panel and the unsaved-edits guard stays armed; say so.
    unsaved.lastRefusal = {
      ...result.refusal,
      message: `${result.refusal.message} It could not be kept on this device either (${String(err)}), so keep this panel open and retry.`,
    };
    return { status: 'unsaved', unsaved, persisted: false };
  }
  return { status: 'unsaved', unsaved, persisted: true };
}

/** Retry one unsaved capture. It leaves the queue only when it lands. */
export async function retryUnsavedCapture(id: string): Promise<SaveOutcome> {
  const row = (await listUnsavedCaptures()).find((r) => r.id === id);
  if (!row) {
    return { status: 'empty', message: 'That unsaved capture is no longer on this device.' };
  }
  const revision = await reserveQueueRevision();
  const result = await send(row.prepared);
  if (result.ok) {
    await dropUnsavedForUrl(row.url, revision, result.organizationId, id);
    return { status: 'landed', landed: result.landed, organizationId: result.organizationId };
  }
  const next: UnsavedCapture = {
    ...row,
    ...(result.organizationId && { organizationId: result.organizationId }),
    revision,
    attempts: 1,
    lastRefusal: result.refusal,
  };
  const queued = await upsertUnsaved(next);
  return queued
    ? { status: 'unsaved', unsaved: queued, persisted: true }
    : { status: 'empty', message: 'A newer save or discard already completed for this page.' };
}
