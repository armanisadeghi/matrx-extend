/**
 * Composer chip for attaching a registered Google Doc / Sheet to the chat.
 *
 * Lives in the composer toolbar next to the settings chip, and is ALWAYS
 * present — a user with nothing connected still sees the affordance, and
 * opening it explains what it does and links straight to the place that fixes
 * it. An attach feature that hides itself when empty can never be discovered by
 * the person who most needs it.
 *
 * The list is the user's registered resources only (files they picked with the
 * Google Picker on the web app). There is no Drive browse here, because there is
 * no Drive browse anywhere in the platform.
 *
 * Attached files ride as the reserved `__google_files` context key on every
 * send. The SERVER resolves those ids against the user's registered resources,
 * names the files for the agent, and turns on the `google_workspace` tool for
 * that turn — see docs/REQUEST_PAYLOAD_CONTRACT.md §2.
 */

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { log } from '@/lib/debug/log';
import { GOOGLE_WORKSPACE_SETTINGS_URL } from '@/lib/google/connection';
import { listRegisteredGoogleFiles } from '@/lib/google/files';
import { cn } from '@/lib/utils';
import { useGoogleFilesStore } from '@/state/google-files';
import { Check, ExternalLink, FileText, Loader2, Sheet } from 'lucide-react';
import { useCallback, useState } from 'react';

export function GoogleFileAttachmentChip() {
  const items = useGoogleFilesStore((s) => s.items);
  const loaded = useGoogleFilesStore((s) => s.loaded);
  const loading = useGoogleFilesStore((s) => s.loading);
  const attachedIds = useGoogleFilesStore((s) => s.attachedIds);
  const toggle = useGoogleFilesStore((s) => s.toggle);
  const clearAttached = useGoogleFilesStore((s) => s.clearAttached);
  const [open, setOpen] = useState(false);

  // Re-read on every open: the user may have picked a file on the web app
  // seconds ago, and a stale list would read as "AI Matrx lost my file".
  const refresh = useCallback(async () => {
    const store = useGoogleFilesStore.getState();
    store.setLoading(true);
    try {
      store.setItems(await listRegisteredGoogleFiles());
    } catch (err) {
      log.warn('supabase', 'could not read registered Google files', err);
      store.setLoading(false);
    }
  }, []);

  const count = attachedIds.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-accent hover:text-foreground',
            count > 0 ? 'text-foreground' : 'text-muted-foreground',
          )}
          title="Attach a Google Doc or Sheet you've shared with AI Matrx"
        >
          <FileText className="size-3.5" />
          {count > 0 ? `${count} file${count === 1 ? '' : 's'}` : 'Files'}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-95 p-1" align="start">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Google files
          </span>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
          {count > 0 && (
            <button
              type="button"
              onClick={clearAttached}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              Detach all
            </button>
          )}
        </div>

        {items.length > 0 ? (
          <>
            <div className="max-h-64 overflow-y-auto">
              {items.map((file) => {
                const attached = attachedIds.includes(file.fileId);
                return (
                  <button
                    key={file.fileId}
                    type="button"
                    onClick={() => toggle(file.fileId)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent',
                      attached && 'bg-accent',
                    )}
                  >
                    <div
                      className={cn(
                        'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
                        attached
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/40 bg-transparent',
                      )}
                    >
                      {attached && <Check className="size-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {file.isSheet ? (
                          <Sheet className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <FileText className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
                        )}
                        <span className="truncate text-sm font-medium">{file.name}</span>
                      </div>
                      {file.connectionEmail && (
                        <div className="truncate text-[11px] leading-snug text-muted-foreground">
                          {file.connectionEmail}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-muted-foreground">
              Attached files are named for the agent, which can then read and edit them for you.
            </p>
          </>
        ) : (
          <div className="px-2 pb-2 pt-1">
            <p className="text-[11px] leading-snug text-muted-foreground">
              {loaded && !loading
                ? 'Choose a Google Doc or Sheet in AI Matrx and it shows up here. Attach it to a message and the agent can read and edit that one file — nothing else in your Drive.'
                : 'Looking for the Google files you’ve shared with AI Matrx…'}
            </p>
            <a
              href={GOOGLE_WORKSPACE_SETTINGS_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              Choose files in AI Matrx
              <ExternalLink className="size-3" />
            </a>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
