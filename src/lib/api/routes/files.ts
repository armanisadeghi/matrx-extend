/**
 * cld_files HTTP client — used by tools that produce or consume file bytes
 * via the canonical `file_id` contract (see browser_tools_canonical.json
 * `_meta.cloud_files_contract`).
 *
 *   POST /files/upload        (multipart) → { file_id, url, ... }
 *   GET  /files/{id}/download                → bytes
 *
 * Why a separate file from client.ts: `apiPost` JSON-stringifies the body.
 * Multipart form uploads need raw FormData, so we build the request by hand
 * but reuse buildHeaders (auth + 401 retry are handled inline).
 */

import { runOp } from '@/lib/api/matrx-api';
import { log } from '@/lib/debug/log';
import { requireActiveOrganizationId } from '@/lib/org/active-org';
import { downloadFile, uploadFile as uploadFileOp } from '@ai-matrx/api/files';

export interface FileUploadResponse {
  file_id: string;
  file_path: string;
  version_number: number;
  size_bytes: number | null;
  checksum: string | null;
  /** Fetchable now: durable CDN for public files, expiring signed URL otherwise. */
  url: string | null;
  is_new: boolean;
  cdn_url: string | null;
}

/**
 * Anything the user did not explicitly choose a folder for lives under this
 * prefix. `system-files/` is the canonical hidden namespace shared by every
 * Matrx surface; `system-files/matrx-extend/` is this extension's slice. Future user-picked
 * folders should bypass this via `userSelected: true`.
 */
export const SYSTEM_AUTO_PATH_PREFIX = 'system-files/matrx-extend/';

export interface UploadFileOptions {
  /** Logical path under the user's tree, e.g. "browser-agent/screenshots/foo.png". Defaults to "browser-agent/uploads/<filename>". Automatically prefixed with `system-files/matrx-extend/` unless `userSelected` is true. */
  path?: string;
  /** Set to true when the path was explicitly chosen by the user via a folder picker — bypasses the `system-files/matrx-extend/` auto-prefix. */
  userSelected?: boolean;
  metadata?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fileTransferError(operation: 'upload' | 'download', status: number): Error {
  const remedy =
    status === 401 || status === 403
      ? 'Sign in again; if access is still denied, ask an administrator.'
      : status === 429
        ? 'Wait a moment and try again.'
        : 'Try again; if it keeps failing, report this HTTP status to support.';
  return new Error(`File ${operation} failed (${status}). ${remedy}`);
}

export function parseFileUploadResponse(value: unknown): FileUploadResponse {
  if (!isRecord(value)) throw new Error('File upload returned an invalid response.');
  const requiredString = (key: string): string => {
    const field = value[key];
    if (typeof field !== 'string' || !field) {
      throw new Error(`File upload returned invalid ${key}.`);
    }
    return field;
  };
  const nullableString = (key: string): string | null => {
    const field = value[key];
    if (field === null || field === undefined) return null;
    if (typeof field !== 'string') throw new Error(`File upload returned invalid ${key}.`);
    return field;
  };
  if (typeof value.version_number !== 'number' || !Number.isInteger(value.version_number)) {
    throw new Error('File upload returned invalid version_number.');
  }
  if (
    value.size_bytes !== null &&
    (typeof value.size_bytes !== 'number' || !Number.isFinite(value.size_bytes))
  ) {
    throw new Error('File upload returned invalid size_bytes.');
  }
  if (typeof value.is_new !== 'boolean') {
    throw new Error('File upload returned invalid is_new.');
  }
  return {
    file_id: requiredString('file_id'),
    file_path: requiredString('file_path'),
    version_number: value.version_number,
    size_bytes: value.size_bytes,
    checksum: nullableString('checksum'),
    url: nullableString('url'),
    is_new: value.is_new,
    cdn_url: nullableString('cdn_url'),
  };
}

/** Upload a Blob/File to cld_files. Returns the file_id the server expects in canonical tools. */
export async function uploadFile(
  blob: Blob,
  filename: string,
  opts: UploadFileOptions = {},
): Promise<FileUploadResponse> {
  // Multipart is a request like any other: it carries the organization or it
  // does not go out. `requireActiveOrganizationId` returns the load ladder's
  // organization and throws a remediable error only for a person with no
  // memberships — never uploads into nowhere.
  const organizationId = await requireActiveOrganizationId();

  const rawPath = opts.path ?? `browser-agent/uploads/${filename}`;
  const filePath = opts.userSelected
    ? rawPath
    : rawPath.startsWith(SYSTEM_AUTO_PATH_PREFIX)
      ? rawPath
      : `${SYSTEM_AUTO_PATH_PREFIX}${rawPath.replace(/^\/+/, '')}`;

  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append('file_path', filePath);
  if (opts.metadata) fd.append('metadata_json', JSON.stringify(opts.metadata));

  const start = performance.now();
  log.info('api', '→ POST /files/upload (multipart)', { filename, size: blob.size });
  // `silent`: a rejected upload's body may echo what was sent; only the status is logged.
  const res = await runOp((api, o) => uploadFileOp(api, { body: fd }, o), {
    organizationId,
    silent: true,
  });
  const ms = Math.round(performance.now() - start);
  if (!res.ok) {
    log.error('api', `✗ POST /files/upload ${res.status} (${ms}ms)`);
    throw fileTransferError('upload', res.status);
  }
  const data = parseFileUploadResponse(res.data);
  log.success('api', `← /files/upload ${ms}ms`, { file_id: data.file_id });
  return data;
}

/**
 * Fetch the bytes for an existing cld_files row. Used by tools that consume
 * a `file_id` (upload_file, drop_file): server resolves the MediaRef
 * normally, but the *extension* surface needs to materialize bytes inside the
 * page sandbox (DataTransfer requires a real File object).
 */
export async function downloadFileBytes(
  fileId: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const organizationId = await requireActiveOrganizationId();
  const result = await runOp((api, o) => downloadFile(api, { path: { file_id: fileId } }, o), {
    organizationId,
    silent: true,
    signal,
  });
  if (!result.ok) {
    // Caller cancellation is the caller's own AbortError, not a transfer failure.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw fileTransferError('download', result.status);
  }
  const res = result.data;
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = m?.[1] ? decodeURIComponent(m[1]) : fileId;
  const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
  return { blob, filename, mimeType };
}
