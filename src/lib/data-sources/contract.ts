/**
 * Live-data sources — the pure half. Mirrors matrx-frontend `features/data-sources/contract.ts`
 * (`matchSourceForUrl`, the parsers, `estimateUsd`) so both clients agree on which page belongs to
 * which source. The catalog itself is read from the server (`GET /data-sources`), so a new source
 * appears with no extension release. Wire contract: aidream `services/data_fetch/FEATURE.md`.
 */

/** 20,000 points = $1. */
export const POINTS_PER_USD = 20_000;
export const DEFAULT_FETCH_RECORDS = 25;

export interface DataSource {
  key: string;
  label: string;
  inputKind: 'url' | 'keyword';
  exampleUrl: string | null;
  /** Where the source's pages live — the server's host and path regular expressions; preferred over the example. */
  urlPattern: { host: string; path: string } | null;
  verified: boolean;
  usdPerRecord: number | null;
  /** The server's own points quote per record; wins over a local conversion. */
  pointsPerRecord: number | null;
}

export interface DataLimit {
  value: number;
  setting: string;
}

export interface DataSourceCatalog {
  sources: DataSource[];
  maxRecordsPerFetch: DataLimit | null;
}

export interface DataFetchResult {
  jobId: string;
  tableId: string;
  tableName: string;
  rowsCreated: number;
  rowsUpdated: number;
  recordsBilled: number;
  costUsd: number;
  limitApplied: DataLimit | null;
}

export interface DataFetchProgress {
  label: string;
  current: number | null;
  total: number | null;
}

/** A refusal the server said in words (HTTP error or in-stream `error` event). */
export class DataFetchRefusal extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly limit: DataLimit | null;
  constructor(code: string, userMessage: string, limit: DataLimit | null = null) {
    super(userMessage || code);
    this.name = 'DataFetchRefusal';
    this.code = code;
    this.userMessage = userMessage;
    this.limit = limit;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

function limitOf(v: unknown): DataLimit | null {
  const o = obj(v);
  const value = num(o.value);
  const setting = str(o.setting);
  return value != null && setting ? { value, setting } : null;
}

function patternOf(v: unknown): { host: string; path: string } | null {
  const o = obj(v);
  const host = str(o.host);
  return host ? { host, path: str(o.path) ?? '' } : null;
}

export function parseCatalog(raw: unknown): DataSourceCatalog {
  const o = obj(raw);
  const sources: DataSource[] = [];
  for (const item of Array.isArray(o.sources) ? o.sources : []) {
    const s = obj(item);
    const key = str(s.key);
    const label = str(s.label);
    if (!key || !label) continue;
    sources.push({
      key,
      label,
      inputKind: obj(s.input).kind === 'keyword' ? 'keyword' : 'url',
      exampleUrl: str(s.example_url),
      urlPattern: patternOf(s.url_pattern),
      verified: s.verified === true,
      usdPerRecord: num(s.usd_per_record),
      pointsPerRecord: num(s.points_per_record),
    });
  }
  return { sources, maxRecordsPerFetch: limitOf(obj(o.limits).max_records_per_fetch) };
}

function parseResult(raw: unknown): DataFetchResult | null {
  const r = obj(raw);
  const tableId = str(r.table_id);
  if (!tableId) return null;
  return {
    jobId: str(r.job_id) ?? '',
    tableId,
    tableName: str(r.table_name) ?? 'Table',
    rowsCreated: num(r.rows_created) ?? 0,
    rowsUpdated: num(r.rows_updated) ?? 0,
    recordsBilled: num(r.records_billed) ?? 0,
    costUsd: num(r.cost_usd) ?? 0,
    limitApplied: limitOf(r.limit_applied),
  };
}

export function refusalOf(d: Record<string, unknown>): DataFetchRefusal {
  const details = obj(d.details);
  return new DataFetchRefusal(
    str(d.code) ?? str(details.code) ?? 'data_fetch_failed',
    str(d.user_message) ??
      str(details.user_message) ??
      str(d.message) ??
      'The data could not be fetched.',
    limitOf(d.limit) ?? limitOf(details.limit),
  );
}

export type DataFetchEvent =
  | { kind: 'progress'; progress: DataFetchProgress }
  | { kind: 'result'; result: DataFetchResult }
  | { kind: 'refusal'; refusal: DataFetchRefusal }
  | null;

/** One NDJSON line (already JSON-parsed) → progress, result, refusal, or nothing. */
export function readEvent(evt: unknown): DataFetchEvent {
  const e = obj(evt);
  const d = obj(e.data);
  if (e.event === 'error') return { kind: 'refusal', refusal: refusalOf(d) };
  if (e.event !== 'data') return null;
  if (d.type === 'data_fetch_stage') {
    const current = num(d.current);
    const total = num(d.total);
    return {
      kind: 'progress',
      progress: {
        label: str(d.label) ?? str(d.stage) ?? 'Working',
        current: current && current > 0 ? current : null,
        total: total && total > 0 ? total : null,
      },
    };
  }
  if (d.type === 'data_fetch_result') {
    const result = parseResult(d.result);
    return result ? { kind: 'result', result } : null;
  }
  return null;
}

/** Folds parsed stream events into the one result, or throws the refusal. */
export async function consumeDataFetch(
  events: AsyncIterable<unknown>,
  onProgress?: (p: DataFetchProgress) => void,
): Promise<DataFetchResult> {
  let result: DataFetchResult | null = null;
  let refusal: DataFetchRefusal | null = null;
  for await (const evt of events) {
    const read = readEvent(evt);
    if (!read) continue;
    if (read.kind === 'progress') onProgress?.(read.progress);
    else if (read.kind === 'result') result = read.result;
    else refusal = read.refusal;
  }
  if (refusal) throw refusal;
  if (!result)
    throw new DataFetchRefusal('data_fetch_no_result', 'The fetch ended without a table.');
  return result;
}

const bareHost = (h: string) =>
  h
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '');

function patternMatches(pattern: { host: string; path: string }, url: URL): boolean {
  try {
    return (
      new RegExp(pattern.host, 'i').test(url.hostname) &&
      // Path plus query, as the server matches it: a Google Maps place link carries its id in `?q=place_id:`.
      new RegExp(pattern.path, 'i').test(url.pathname + url.search)
    );
  } catch {
    return false;
  }
}

/**
 * The catalog source a page belongs to: same host as the source's example address and, when the
 * example has a path, the same first path segment. Url-input sources only; verified wins.
 * Same rule as matrx-frontend `matchSourceForUrl`.
 */
export function matchSourceForUrl(href: string, sources: readonly DataSource[]): DataSource | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = bareHost(url.hostname);
  const first = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  const matches = sources.filter((s) => {
    if (s.inputKind !== 'url') return false;
    if (s.urlPattern) return patternMatches(s.urlPattern, url);
    if (!s.exampleUrl) return false;
    let ex: URL;
    try {
      ex = new URL(s.exampleUrl);
    } catch {
      return false;
    }
    const exHost = bareHost(ex.hostname);
    if (host !== exHost && !host.endsWith(`.${exHost}`)) return false;
    const exFirst = ex.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
    return !exFirst || exFirst === first;
  });
  return matches.find((s) => s.verified) ?? matches[0] ?? null;
}

/** Points for `n` records of `source`; null when the source is unpriced. */
export function estimatePoints(
  source: Pick<DataSource, 'usdPerRecord' | 'pointsPerRecord'>,
  n: number,
): number | null {
  if (n <= 0) return null;
  if (source.pointsPerRecord != null && source.pointsPerRecord >= 0)
    return source.pointsPerRecord * n;
  const unit = source.usdPerRecord;
  if (unit == null || !Number.isFinite(unit) || unit < 0 || n <= 0) return null;
  return Math.ceil(unit * n * POINTS_PER_USD);
}

/** The count actually asked for: whole, ≥1, never above the org's limit. */
export function clampRecords(requested: number, limit: DataLimit | null): number {
  const n = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : DEFAULT_FETCH_RECORDS;
  return limit ? Math.min(n, limit.value) : n;
}

export function tableUrl(frontendUrl: string, tableId: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/data/${encodeURIComponent(tableId)}`;
}
