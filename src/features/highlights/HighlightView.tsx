/**
 * Highlights side-panel tab.
 *
 * Lets the user run the on-page highlighter (text or element mode), then
 * manage everything they've captured: filter by this-page / this-site / all,
 * attach highlights to the chat (they ride along as the `highlights` context
 * key), and hand element/text highlights off to the Data and Scrape tabs.
 *
 * Capture itself happens on the page via the overlay; the write to Supabase
 * is owned by useHighlightBridge() (mounted in App.tsx), so this view just
 * reads the store + issues control commands.
 */

import { Button } from '@/components/ui/button';
import { useActiveTab } from '@/hooks/use-active-tab';
import { setHighlighterMode, startHighlighter, stopHighlighter } from '@/lib/highlights/control';
import { deleteHighlight, listHighlightsForUrl, listMyHighlights } from '@/lib/highlights/queries';
import type { HighlightListItem, HighlightMode } from '@/lib/highlights/types';
import { useHighlightStore } from '@/state/highlights';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import {
  Database,
  Highlighter,
  Link2,
  MousePointerSquareDashed,
  ScanLine,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Scope = 'page' | 'site' | 'all';

export function HighlightView() {
  const tab = useActiveTab();
  const setTab = useSidepanelTabStore((s) => s.setTab);

  const items = useHighlightStore((s) => s.items);
  const setItems = useHighlightStore((s) => s.setItems);
  const overlayActive = useHighlightStore((s) => s.overlayActive);
  const overlayTabId = useHighlightStore((s) => s.overlayTabId);
  const mode = useHighlightStore((s) => s.mode);
  const setMode = useHighlightStore((s) => s.setMode);
  const attachedIds = useHighlightStore((s) => s.attachedIds);
  const attach = useHighlightStore((s) => s.attach);
  const detach = useHighlightStore((s) => s.detach);
  const attachMany = useHighlightStore((s) => s.attachMany);
  const clearAttached = useHighlightStore((s) => s.clearAttached);
  const removeItem = useHighlightStore((s) => s.removeItem);
  const setDataHandoff = useHighlightStore((s) => s.setDataHandoff);
  const setScrapeHandoff = useHighlightStore((s) => s.setScrapeHandoff);

  const [scope, setScope] = useState<Scope>('page');
  const [busy, setBusy] = useState(false);

  const host = useMemo(() => {
    try {
      return tab.url ? new URL(tab.url).host : '';
    } catch {
      return '';
    }
  }, [tab.url]);

  // Initial + refresh load. The bridge keeps the store fresh on changes, but
  // we fetch on mount so the list is populated when the tab first opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await listMyHighlights();
      if (!cancelled) setItems(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [setItems]);

  const visible = useMemo(() => {
    if (scope === 'all') return items;
    if (scope === 'site') return items.filter((h) => h.domain === host);
    return items.filter((h) => h.url === tab.url);
  }, [items, scope, host, tab.url]);

  const isActiveHere = overlayActive && overlayTabId === tab.id;

  const handleToggle = async () => {
    if (!tab.id) return;
    setBusy(true);
    try {
      if (isActiveHere) {
        await stopHighlighter(tab.id);
        useHighlightStore.getState().setOverlay({ active: false });
      } else {
        const existing = tab.url ? await listHighlightsForUrl(tab.url) : [];
        const ok = await startHighlighter(tab.id, existing);
        if (ok) useHighlightStore.getState().setOverlay({ active: true, tabId: tab.id });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleMode = async (m: HighlightMode) => {
    setMode(m);
    if (isActiveHere && tab.id) await setHighlighterMode(tab.id, m);
  };

  const handleDelete = async (h: HighlightListItem) => {
    removeItem(h.id);
    await deleteHighlight(h.id);
  };

  const sendElementsToData = () => {
    const elements = visible.filter((h) => h.mode === 'element' && h.anchor.selector);
    if (elements.length === 0) return;
    setDataHandoff(
      elements.map((h, i) => ({
        name: slugName(h.text) || `highlight_${i + 1}`,
        selector: h.anchor.selector as string,
      })),
    );
    setTab('data');
  };

  const sendToScrape = () => {
    const regions = visible
      .filter((h) => (h.text ?? '').trim().length > 0)
      .map((h) => ({
        title: h.mode === 'element' ? 'Element' : 'Passage',
        text: h.text as string,
      }));
    if (regions.length === 0) return;
    setScrapeHandoff(regions);
    setTab('scrape');
  };

  const elementCount = visible.filter((h) => h.mode === 'element' && h.anchor.selector).length;
  const textCount = visible.filter((h) => (h.text ?? '').trim().length > 0).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Highlights</span>
        <span className="ml-2 truncate text-xs text-muted-foreground">{host || 'no host'}</span>
      </div>

      {/* Highlighter control */}
      <div className="space-y-2 px-3 pb-2">
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void handleToggle()}
            disabled={busy || !tab.id}
            className="flex-1 rounded-full"
            variant={isActiveHere ? 'secondary' : 'default'}
          >
            {isActiveHere ? <Square className="size-3.5" /> : <Highlighter className="size-3.5" />}
            {isActiveHere ? 'Stop highlighting' : 'Highlight this page'}
          </Button>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-secondary/50 p-0.5 text-xs">
          <ModeButton active={mode === 'text'} onClick={() => void handleMode('text')}>
            <Type className="size-3.5" /> Text
          </ModeButton>
          <ModeButton active={mode === 'element'} onClick={() => void handleMode('element')}>
            <MousePointerSquareDashed className="size-3.5" /> Element
          </ModeButton>
        </div>
      </div>

      {/* Attach tray */}
      {attachedIds.length > 0 && (
        <div className="mx-3 mb-2 flex items-center justify-between rounded-xl bg-indigo-500/10 px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-indigo-700 dark:text-indigo-300">
            <Link2 className="size-3.5" />
            {attachedIds.length} attached to chat
          </span>
          <div className="flex items-center gap-2">
            <button
              className="text-indigo-600 hover:underline dark:text-indigo-300"
              onClick={() => setTab('chat')}
            >
              Open chat
            </button>
            <button className="text-muted-foreground hover:underline" onClick={clearAttached}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Scope filter */}
      <div className="flex items-center gap-1 px-3 pb-2 text-xs">
        {(['page', 'site', 'all'] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded-full px-2.5 py-1 ${
              scope === s
                ? 'bg-foreground text-background'
                : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'
            }`}
          >
            {s === 'page' ? 'This page' : s === 'site' ? host || 'This site' : 'All'}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">{visible.length}</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3">
        {visible.length === 0 ? (
          <div className="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground">
            {overlayActive
              ? 'Select text or click elements on the page to capture highlights.'
              : 'Start the highlighter, then select text or click elements to capture.'}
          </div>
        ) : (
          <div className="space-y-1.5 pb-3">
            {visible.map((h) => {
              const isAttached = attachedIds.includes(h.id);
              return (
                <div
                  key={h.id}
                  className="group flex items-start gap-2 rounded-xl bg-secondary/40 px-3 py-2"
                >
                  <span
                    className="mt-0.5 size-3 shrink-0 rounded-sm ring-1 ring-black/10"
                    style={{ background: swatch(h.color) }}
                    title={h.mode}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-xs">
                      {h.text || <span className="italic text-muted-foreground">(element)</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="uppercase tracking-wider">{h.mode}</span>
                      {scope !== 'page' && <span className="truncate">· {h.domain}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => (isAttached ? detach(h.id) : attach(h.id))}
                      title={isAttached ? 'Detach from chat' : 'Attach to chat'}
                      className={`rounded-md p-1 ${
                        isAttached
                          ? 'text-indigo-600 dark:text-indigo-300'
                          : 'text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100'
                      }`}
                    >
                      <Link2 className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void handleDelete(h)}
                      title="Delete highlight"
                      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer actions */}
      {visible.length > 0 && (
        <div className="shrink-0 space-y-1.5 border-t px-3 py-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 rounded-full text-xs"
              onClick={() => attachMany(visible.map((h) => h.id))}
            >
              <Link2 className="size-3.5" /> Attach all to chat
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 rounded-full text-xs"
              disabled={elementCount === 0}
              onClick={sendElementsToData}
              title="Load element highlights as Data-tab fields"
            >
              <Database className="size-3.5" /> Data ({elementCount})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 rounded-full text-xs"
              disabled={textCount === 0}
              onClick={sendToScrape}
              title="Load highlighted text into the Scrape tab"
            >
              <ScanLine className="size-3.5" /> Scrape ({textCount})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 ${
        active ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function slugName(text: string | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

function swatch(color: string): string {
  switch (color) {
    case 'green':
      return 'rgb(134, 239, 172)';
    case 'blue':
      return 'rgb(147, 197, 253)';
    case 'pink':
      return 'rgb(249, 168, 212)';
    default:
      return 'rgb(253, 224, 71)'; // yellow
  }
}
