/**
 * PDF processing endpoints. Used by the canonical `read_pdf` tool to
 * extract text from a PDF the agent has either downloaded (file_id) or
 * has open in a tab (we upload the bytes first).
 *
 *   POST /pdf/extract-text  body: { media: { file_id }, force_ocr?, ... }
 */

import { apiPost } from '@/lib/api/client';

export interface ExtractTextResponse {
  text: string;
  page_count?: number;
  pages?: Array<{ page: number; text: string }>;
  /** Present when persist=true was passed. */
  file_id?: string;
}

export interface ExtractTextOptions {
  fileId?: string;
  url?: string;
  forceOcr?: boolean;
  includePageMarkers?: boolean;
  pageStart?: number;
  pageEnd?: number;
}

export async function extractPdfText(opts: ExtractTextOptions) {
  if (!opts.fileId && !opts.url) {
    throw new Error('extractPdfText: provide fileId or url');
  }
  const body: Record<string, unknown> = {
    media: opts.fileId ? { file_id: opts.fileId } : { url: opts.url },
    force_ocr: opts.forceOcr ?? false,
    include_page_markers: opts.includePageMarkers ?? true,
  };
  if (opts.pageStart != null) body.page_start = opts.pageStart;
  if (opts.pageEnd != null) body.page_end = opts.pageEnd;
  return apiPost<ExtractTextResponse>('/pdf/extract-text', body);
}
