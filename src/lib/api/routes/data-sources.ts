/**
 * Live data — `GET /data-sources` and `POST /data-sources/fetch` (NDJSON stream).
 * aidream `aidream/services/data_fetch/FEATURE.md`. Carries the active organization through the
 * one header path (`buildHeaders`); a call with no organization is refused, never guessed.
 */

import { ORGANIZATION_CONTEXT_HEADER, apiGet, buildHeaders, getApiBaseUrl } from '@/lib/api/client';
import {
  type DataFetchProgress,
  DataFetchRefusal,
  type DataFetchResult,
  type DataSourceCatalog,
  consumeDataFetch,
  parseCatalog,
  refusalOf,
} from '@/lib/data-sources/contract';
import { sendMatrxRequest } from '@ai-matrx/agents/matrx';

export async function getDataSources(signal?: AbortSignal): Promise<DataSourceCatalog> {
  const res = await apiGet<unknown>('/data-sources', signal);
  if (!res.ok) throw new DataFetchRefusal(`http_${res.status}`, res.error);
  return parseCatalog(res.data);
}

async function* ndjson(response: Response): AsyncGenerator<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
      nl = buffer.indexOf('\n');
    }
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

export interface FetchDataRequest {
  sourceKey: string;
  url: string;
  maxRecords: number;
}

/** Runs one paid fetch. Call only from an explicit click. */
export async function fetchData(
  req: FetchDataRequest,
  opts: { signal?: AbortSignal; onProgress?: (p: DataFetchProgress) => void } = {},
): Promise<DataFetchResult> {
  const headers = await buildHeaders({ Accept: 'application/x-ndjson' });
  if (!headers[ORGANIZATION_CONTEXT_HEADER]) {
    throw new DataFetchRefusal(
      'organization_required',
      'No organization is active, so the table has nowhere to be saved. Choose an organization in Settings.',
    );
  }
  const base = await getApiBaseUrl();
  const response = await sendMatrxRequest(`${base}/data-sources/fetch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source_key: req.sourceKey,
      url: req.url,
      max_records: req.maxRecords,
    }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      /* fall through to the status line */
    }
    const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const detail =
      o.detail && typeof o.detail === 'object' ? (o.detail as Record<string, unknown>) : o;
    if (typeof detail.user_message === 'string' || typeof detail.code === 'string') {
      throw refusalOf(detail);
    }
    throw new DataFetchRefusal(
      `http_${response.status}`,
      typeof o.detail === 'string' ? o.detail : `The server answered ${response.status}.`,
    );
  }
  return consumeDataFetch(ndjson(response), opts.onProgress);
}
