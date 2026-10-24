/**
 * Every place a screenshot can be opened from the extension — the ONE home
 * for these URLs so the gallery, the viewer and the editor never drift.
 *
 *   - Files page on the website (the file's record: share, versions, move)
 *   - Website image editor (filters, resize, background removal, AI edits)
 *   - Website annotator
 *   - The extension's own full-tab editor (crop + markup, instant)
 */

import { ENV } from '@/config/env';
import type { Tool } from '@/features/screenshots/editor/model';
import { withReferral } from '@ai-matrx/kit/outbound';

const enc = encodeURIComponent;

export function fileWebUrl(fileId: string): string {
  return `${ENV.FRONTEND_URL}/files/f/${enc(fileId)}`;
}

export function webImageEditorUrl(fileId: string): string {
  return `${ENV.FRONTEND_URL}/images/edit/${enc(fileId)}`;
}

export function webAnnotateUrl(fileId: string): string {
  return `${ENV.FRONTEND_URL}/images/annotate?cloudFileId=${enc(fileId)}`;
}

export interface EditorTarget {
  fileId: string;
  /** The gallery row the file belongs to; a save lands next to it on the same page. */
  screenshotId?: string | null;
  /** Tool selected when the editor opens (Area capture opens on crop). */
  tool?: Tool;
}

export const EDITOR_PAGE_PATH = '/screenshot-editor.html';

export function editorQuery(target: EditorTarget): string {
  const params = new URLSearchParams({ file: target.fileId });
  if (target.screenshotId) params.set('shot', target.screenshotId);
  if (target.tool) params.set('tool', target.tool);
  return params.toString();
}

export function parseEditorQuery(search: string): EditorTarget | null {
  const params = new URLSearchParams(search);
  const fileId = params.get('file');
  if (!fileId) return null;
  const tool = params.get('tool') as Tool | null;
  return {
    fileId,
    screenshotId: params.get('shot'),
    ...(tool ? { tool } : {}),
  };
}

export function openScreenshotEditor(target: EditorTarget): void {
  void chrome.tabs.create({
    url: `${chrome.runtime.getURL(EDITOR_PAGE_PATH)}?${editorQuery(target)}`,
  });
}

export function openOnWebsite(url: string): void {
  void chrome.tabs.create({ url: withReferral(url) });
}
