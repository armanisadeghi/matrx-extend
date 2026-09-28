/**
 * The mapped-only offered values of the `extend.page_capture` provision
 * (aidream `client_mandates.py`), built from facts a launch already holds.
 *
 * Sent by name beside the existing variables and ONLY on the Mandate door
 * (`/ai/mandates/{key}`), where the server drops mapped-only values unless a
 * binding's consumption map names one — so no current Holder's payload
 * changes. On the agent door a person may have picked any agent, whose
 * template could already use one of these names, so callers send nothing new
 * there. Absent facts are omitted, never sent empty.
 */
export type PageCaptureOfferedValues = Partial<{
  page_description: string;
  page_author: string;
  page_lang: string;
  page_text_truncated: boolean;
  extraction_description: string;
  extracted_row_count: number;
  extracted_field_names: string[];
  tab_id: string;
}>;

export interface PageCaptureFacts {
  /** The `page_metadata` object `aiExtractCapturePage` returns, when held. */
  pageMetadata?: Record<string, unknown> | null | undefined;
  /** The extraction's description (what the person asked to extract). */
  extractionDescription?: string | null | undefined;
  /** Rows already extracted, when the launch works from them. */
  extractedRows?: readonly Record<string, unknown>[] | null | undefined;
  tabId?: number | null | undefined;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function pageCaptureOfferedValues(facts: PageCaptureFacts): PageCaptureOfferedValues {
  const out: PageCaptureOfferedValues = {};
  const meta = facts.pageMetadata ?? null;
  if (meta) {
    if (nonEmpty(meta.description)) out.page_description = meta.description;
    if (nonEmpty(meta.author)) out.page_author = meta.author;
    if (nonEmpty(meta.lang)) out.page_lang = meta.lang;
    if (typeof meta.truncated === 'boolean') out.page_text_truncated = meta.truncated;
  }
  if (nonEmpty(facts.extractionDescription)) {
    out.extraction_description = facts.extractionDescription;
  }
  if (facts.extractedRows) {
    out.extracted_row_count = facts.extractedRows.length;
    const names = new Set<string>();
    for (const row of facts.extractedRows) for (const key of Object.keys(row)) names.add(key);
    if (names.size > 0) out.extracted_field_names = [...names];
  }
  if (typeof facts.tabId === 'number') out.tab_id = String(facts.tabId);
  return out;
}
