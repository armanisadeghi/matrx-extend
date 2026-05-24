/**
 * File download tools using chrome.downloads.
 *
 *   download_url      (action) — download a file from a URL.
 *   cancel_download   (action) — cancel an in-progress download.
 *
 * Note: the old `notify_user` handler that lived here was consolidated
 * into the unified `user` tool (see handlers/user.ts and
 * USER_TOOL_WIRE_CONTRACT.md in aidream). System notifications now fire
 * automatically as a side effect of `user(type='notify', ...)` so the
 * user sees it when the side panel is hidden.
 */

import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const DownloadUrlArgs = z.object({
  url: z.string().url(),
  /** Suggested filename (without path). Chrome may sanitize it. */
  filename: z.string().optional(),
  /**
   * Behavior on filename conflict.
   *   uniquify   — append a numeric suffix (default).
   *   overwrite  — replace existing file.
   *   prompt     — let the user choose.
   */
  conflict: z.enum(['uniquify', 'overwrite', 'prompt']).optional().default('uniquify'),
  /** Show the "Save as" dialog. Default false. */
  save_as: z.boolean().optional().default(false),
});
type DownloadUrlArgs = z.infer<typeof DownloadUrlArgs>;

export const download_url: ToolHandler<DownloadUrlArgs, unknown> = {
  name: 'download_url',
  tier: 'action',
  argsSchema: DownloadUrlArgs,
  run: async (args) => {
    if (!chrome.downloads) return { ok: false, reason: 'downloads API unavailable' };
    try {
      const id = await chrome.downloads.download({
        url: args.url,
        filename: args.filename,
        conflictAction: args.conflict,
        saveAs: args.save_as,
      });
      // Resolve final filename once the OS has picked one.
      const items = await chrome.downloads.search({ id });
      return {
        ok: true,
        download_id: id,
        filename: items[0]?.filename ?? args.filename ?? null,
        state: items[0]?.state,
      };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const CancelDownloadArgs = z.object({ download_id: z.number().int() });
type CancelDownloadArgs = z.infer<typeof CancelDownloadArgs>;

export const cancel_download: ToolHandler<CancelDownloadArgs, unknown> = {
  name: 'cancel_download',
  tier: 'action',
  argsSchema: CancelDownloadArgs,
  run: async (args) => {
    if (!chrome.downloads) return { ok: false, reason: 'downloads API unavailable' };
    await chrome.downloads.cancel(args.download_id);
    return { ok: true };
  },
};

export const download_handlers = [download_url, cancel_download];
