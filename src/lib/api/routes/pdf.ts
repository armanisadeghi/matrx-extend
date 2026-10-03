/**
 * PDF text extraction for the canonical `read_pdf` tool.
 *
 *   POST /utilities/pdf/extract-text-remote
 *   body: { media: { file_id }, page_start?, page_end?, force_ocr, include_page_markers }
 *
 * The door answers an NDJSON event stream (anything over a second streams).
 * The terminal `data` event `pdf_extract_complete` carries the text; a stream
 * `error` event carries the server's own sentence. page_start / page_end are
 * 1-based and inclusive — the server reads only that slice (aidream ac1ac282e3).
 */

import { type ApiResult, STATUS_INVALID_BODY, apiPost } from '@/lib/api/client';
import { streamErrorText } from '@ai-matrx/agents/matrx';
import { createMatrxNdjsonFramer } from '@ai-matrx/agents/stream/ndjson';

export const PDF_EXTRACT_TEXT_PATH = '/utilities/pdf/extract-text-remote';

export interface ExtractTextResult {
  text: string;
  /** Pages actually read — the requested slice, or the whole document. */
  page_count: number;
  /** The document's full page count. */
  total_pages: number | null;
  page_start: number | null;
  page_end: number | null;
  file_id: string | null;
}

export interface ExtractTextOptions {
  fileId: string;
  forceOcr?: boolean;
  includePageMarkers?: boolean;
  pageStart?: number;
  pageEnd?: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Read the extraction stream body (buffered by the shared request sender). */
export function readExtractTextStream(body: unknown): ApiResult<ExtractTextResult> {
  if (typeof body !== 'string') {
    return {
      ok: false,
      status: STATUS_INVALID_BODY,
      error: 'PDF extraction answered without an event stream.',
    };
  }
  const framer = createMatrxNdjsonFramer();
  const events = [...framer.pushText(body), ...framer.finish()];
  for (const ev of events) {
    if (ev.event === 'error') {
      return {
        ok: false,
        status: STATUS_INVALID_BODY,
        error: streamErrorText(ev) ?? 'PDF extraction failed on the server.',
      };
    }
    const data = ev.data as Record<string, unknown> | null;
    if (ev.event === 'data' && data?.type === 'pdf_extract_complete') {
      return {
        ok: true,
        data: {
          text: typeof data.text_content === 'string' ? data.text_content : '',
          page_count: num(data.page_count) ?? 0,
          total_pages: num(data.total_pages),
          page_start: num(data.page_start),
          page_end: num(data.page_end),
          file_id: typeof data.file_id === 'string' ? data.file_id : null,
        },
      };
    }
  }
  return {
    ok: false,
    status: STATUS_INVALID_BODY,
    error: 'PDF extraction ended without a result.',
  };
}

export async function extractPdfText(
  opts: ExtractTextOptions,
): Promise<ApiResult<ExtractTextResult>> {
  const body: Record<string, unknown> = {
    media: { file_id: opts.fileId },
    force_ocr: opts.forceOcr ?? false,
    include_page_markers: opts.includePageMarkers ?? true,
  };
  if (opts.pageStart != null) body.page_start = opts.pageStart;
  if (opts.pageEnd != null) body.page_end = opts.pageEnd;
  const r = await apiPost<unknown>(PDF_EXTRACT_TEXT_PATH, body);
  return r.ok ? readExtractTextStream(r.data) : r;
}
