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

import { getBackendUrl } from '@/config/backend';
import { getAccessToken, refreshAccessToken } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';

export interface FileUploadResponse {
  file_id: string;
  file_path: string;
  storage_uri: string;
  version_number: number;
  file_size: number | null;
  checksum: string | null;
  /** Always-fetchable URL (CDN if public, signed if private). May be null when neither is configured. */
  url: string | null;
  is_new: boolean;
  cdn_url: string | null;
}

/**
 * Anything the user did not explicitly choose a folder for lives under this
 * prefix. Reserves `system/` as the namespace the host (any Matrx surface)
 * owns; `system/matrx-extend/` is this extension's slice. Future user-picked
 * folders should bypass this via `userSelected: true`.
 */
export const SYSTEM_AUTO_PATH_PREFIX = 'system/matrx-extend/';

export interface UploadFileOptions {
  /** Logical path under the user's tree, e.g. "browser-agent/screenshots/foo.png". Defaults to "browser-agent/uploads/<filename>". Automatically prefixed with `system/matrx-extend/` unless `userSelected` is true. */
  path?: string;
  /** Set to true when the path was explicitly chosen by the user via a folder picker — bypasses the `system/matrx-extend/` auto-prefix. */
  userSelected?: boolean;
  visibility?: 'public' | 'private' | 'shared';
  metadata?: Record<string, unknown>;
}

/** Upload a Blob/File to cld_files. Returns the file_id the server expects in canonical tools. */
export async function uploadFile(
  blob: Blob,
  filename: string,
  opts: UploadFileOptions = {},
): Promise<FileUploadResponse> {
  const baseUrl = await getBackendUrl();
  const token = await getAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const rawPath = opts.path ?? `browser-agent/uploads/${filename}`;
  const filePath = opts.userSelected
    ? rawPath
    : rawPath.startsWith(SYSTEM_AUTO_PATH_PREFIX)
      ? rawPath
      : `${SYSTEM_AUTO_PATH_PREFIX}${rawPath.replace(/^\/+/, '')}`;

  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append('file_path', filePath);
  fd.append('visibility', opts.visibility ?? 'private');
  if (opts.metadata) fd.append('metadata_json', JSON.stringify(opts.metadata));

  const url = `${baseUrl}/files/upload`;
  const start = performance.now();
  log.info('api', '→ POST /files/upload (multipart)', { filename, size: blob.size });
  let res = await fetch(url, { method: 'POST', headers, body: fd });
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const t2 = await getAccessToken();
      const h2: Record<string, string> = t2 ? { Authorization: `Bearer ${t2}` } : {};
      res = await fetch(url, { method: 'POST', headers: h2, body: fd });
    }
  }
  const ms = Math.round(performance.now() - start);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    log.error('api', `✗ POST /files/upload ${res.status} (${ms}ms)`, text);
    throw new Error(`upload failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as FileUploadResponse;
  log.success('api', `← /files/upload ${res.status} (${ms}ms)`, { file_id: data.file_id });
  return data;
}

/**
 * Fetch the bytes for an existing cld_files row. Used by tools that consume
 * a `file_id` (upload_file, drop_file): server resolves the MediaRef
 * normally, but the *extension* surface needs to materialize bytes inside the
 * page sandbox (DataTransfer requires a real File object).
 */
export async function downloadFileBytes(fileId: string): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const baseUrl = await getBackendUrl();
  const token = await getAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const url = `${baseUrl}/files/${encodeURIComponent(fileId)}/download`;
  let res = await fetch(url, { headers });
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const t2 = await getAccessToken();
      res = await fetch(url, {
        headers: t2 ? { Authorization: `Bearer ${t2}` } : {},
      });
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`download failed ${res.status}: ${text}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = m?.[1] ? decodeURIComponent(m[1]) : fileId;
  const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
  return { blob, filename, mimeType };
}
