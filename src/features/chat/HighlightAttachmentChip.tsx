/**
 * Composer chip that surfaces highlights attached to the chat.
 *
 * Renders nothing when the attach tray is empty. When highlights are attached,
 * shows a count + a preview of the first one, a button to open the Highlight
 * tab, and a clear button. The attached highlights ride along as the
 * `highlights` context key on every send (see use-chat-stream).
 */

import { useHighlightStore } from '@/state/highlights';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { Highlighter, X } from 'lucide-react';
import { useMemo } from 'react';

export function HighlightAttachmentChip() {
  const attachedIds = useHighlightStore((s) => s.attachedIds);
  const items = useHighlightStore((s) => s.items);
  const clearAttached = useHighlightStore((s) => s.clearAttached);
  const setTab = useSidepanelTabStore((s) => s.setTab);

  const preview = useMemo(() => {
    const first = items.find((i) => attachedIds.includes(i.id));
    const text = first?.text?.trim();
    if (!text) return null;
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }, [attachedIds, items]);

  if (attachedIds.length === 0) return null;

  return (
    <div className="mx-3 mb-1.5 flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs">
      <Highlighter className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <button
        onClick={() => setTab('highlight')}
        className="font-medium text-amber-700 hover:underline dark:text-amber-300"
        title="Open the Highlight tab"
      >
        {attachedIds.length} highlight{attachedIds.length === 1 ? '' : 's'} attached
      </button>
      {preview && (
        <span className="min-w-0 flex-1 truncate text-amber-700/70 dark:text-amber-300/70">
          “{preview}”
        </span>
      )}
      <button
        onClick={clearAttached}
        className="ml-auto shrink-0 rounded-md p-0.5 text-amber-600/70 hover:bg-amber-400/20 hover:text-amber-700 dark:text-amber-400/70"
        title="Detach all"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
