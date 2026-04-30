/**
 * File download tools using chrome.downloads.
 *
 *   download_url      (action) — download a file from a URL.
 *   cancel_download   (action) — cancel an in-progress download.
 *   notify_user       (action) — show a Chrome desktop notification (used as
 *                                a "task done" signal when the agent finishes
 *                                long work and the side panel may be hidden).
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
  description:
    "Download a file from a URL into the user's default downloads folder. Returns { ok, download_id, final_filename }. Use save_as=true to surface the Save dialog (good for ambiguous filenames).",
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
  description: 'Cancel an in-progress download by its download_id.',
  argsSchema: CancelDownloadArgs,
  run: async (args) => {
    if (!chrome.downloads) return { ok: false, reason: 'downloads API unavailable' };
    await chrome.downloads.cancel(args.download_id);
    return { ok: true };
  },
};

const NotifyArgs = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  /**
   * Notification icon. Default = extension icon. May be a chrome-extension URL,
   * a data URL, or one of: "info" | "success" | "warning" | "error" — those
   * resolve to the matching extension icon. Optional.
   */
  icon: z.string().optional(),
  /** Stick the notification until dismissed. Default false. */
  require_interaction: z.boolean().optional().default(false),
});
type NotifyArgs = z.infer<typeof NotifyArgs>;

export const notify_user: ToolHandler<NotifyArgs, unknown> = {
  name: 'notify_user',
  tier: 'action',
  description:
    'Show a system notification to the user. Use after a long-running task finishes (especially useful when the side panel is hidden). The user can click to focus the extension.',
  argsSchema: NotifyArgs,
  run: async (args) => {
    if (!chrome.notifications) return { ok: false, reason: 'notifications API unavailable' };
    const id = await new Promise<string>((resolve) => {
      chrome.notifications.create(
        {
          type: 'basic',
          iconUrl: args.icon ?? chrome.runtime.getURL('icon/128.png'),
          title: args.title,
          message: args.message,
          requireInteraction: args.require_interaction,
        },
        (notificationId) => resolve(notificationId),
      );
    });
    return { ok: true, notification_id: id };
  },
};

export const download_handlers = [download_url, cancel_download, notify_user];
