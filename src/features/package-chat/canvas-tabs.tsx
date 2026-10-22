/**
 * The side panel's answer to the package's canvas tabs.
 *
 * The package opens a value's details (the composer chip's rows, a sent message's
 * "N sent" badge) by toggling a NAMED canvas tab. The panel has no canvas column, so the
 * default port refused every press and nothing opened. This port gives the two tabs that
 * carry the person's values a home inside the panel: one full-panel layer over the chat,
 * rendering the package's own bodies (`ContextRulesPanel`, `MessageContextReceiptView`) —
 * the same components the web's canvas tabs render. Any other tab kind still refuses and
 * says so (the package's unhosted port).
 */

import { ContextRulesPanel } from '@ai-matrx/chat/agents/components/context-policies-display/ContextRulesPanel';
import { MessageContextReceiptView } from '@ai-matrx/chat/agents/components/context-policies-display/MessageContextReceipt';
import {
  type ChatCanvasPort,
  type ChatCanvasTab,
  type ChatCanvasTabOpen,
  type ChatCanvasTabRef,
  type ChatDiagnosticsPort,
  createUnhostedCanvas,
} from '@ai-matrx/chat/host';
import {
  CONVERSATION_CONTEXT_KIND,
  MESSAGE_CONTEXT_RECEIPT_KIND,
} from '@ai-matrx/chat/host/canvas-tabs';
import { Button } from '@ai-matrx/design-system';
import { X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/** The tab kinds the panel can show. */
const HOSTED_KINDS: ReadonlySet<string> = new Set([
  CONVERSATION_CONTEXT_KIND,
  MESSAGE_CONTEXT_RECEIPT_KIND,
]);

interface OpenTab {
  kind: string;
  key: string;
  title: string;
  data: Readonly<Record<string, unknown>>;
  selected: string | null;
}

let current: OpenTab | null = null;
const listeners = new Set<() => void>();
function setCurrent(next: OpenTab | null) {
  current = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
const read = () => current;

const isHere = (tab: OpenTab | null, ref: ChatCanvasTabRef): tab is OpenTab =>
  tab !== null && tab.kind === ref.kind && tab.key === ref.key;

/** The package's press semantics: no `selected` → open/close; with it → in front on it closes, else open on it. */
export function toggleTab(ref: ChatCanvasTabRef, open: ChatCanvasTabOpen): void {
  const here = isHere(current, ref) ? current : null;
  const selected = open.selected ?? null;
  if (here && (open.selected === undefined || here.selected === selected)) {
    setCurrent(null);
    return;
  }
  setCurrent({
    kind: ref.kind,
    key: ref.key,
    title: open.title,
    data: here && open.replaceData !== true ? { ...here.data, ...open.data } : open.data,
    selected,
  });
}

/** Test seam: the layer's state. */
export function resetTabLayer(): void {
  setCurrent(null);
}

export function createExtensionCanvas(diagnostics: () => ChatDiagnosticsPort): ChatCanvasPort {
  const unhosted = createUnhostedCanvas(diagnostics);
  return {
    ...unhosted,
    useTab(ref: ChatCanvasTabRef): ChatCanvasTab {
      const open = useSyncExternalStore(subscribe, read, read);
      // Hooks are called in the same order for every kind: the unhosted tab is a constant.
      const fallback = unhosted.useTab(ref);
      if (!HOSTED_KINDS.has(ref.kind)) return fallback;
      const here = isHere(open, ref) ? open : null;
      return {
        isAvailable: true,
        isVisible: here !== null,
        selected: here?.selected ?? null,
        toggle: (request) => toggleTab(ref, request),
      };
    },
  };
}

const text = (data: Readonly<Record<string, unknown>>, field: string): string | null => {
  const value = data[field];
  return typeof value === 'string' && value ? value : null;
};

/** The full-panel layer over the chat: the open tab's body with a close button. Renders nothing when closed. */
export function ExtensionTabLayer() {
  const tab = useSyncExternalStore(subscribe, read, read);
  if (!tab) return null;
  const conversationId = text(tab.data, 'conversationId');
  let body = null;
  if (conversationId && tab.kind === CONVERSATION_CONTEXT_KIND) {
    body = (
      <ContextRulesPanel
        conversationId={conversationId}
        agentId={text(tab.data, 'agentId')}
        selectedKey={tab.selected}
        narrow
        onSelectedKeyChange={(key) => setCurrent({ ...tab, selected: key })}
      />
    );
  } else if (conversationId && tab.kind === MESSAGE_CONTEXT_RECEIPT_KIND) {
    const messageId = text(tab.data, 'messageId');
    if (messageId)
      body = <MessageContextReceiptView conversationId={conversationId} messageId={messageId} />;
  }
  // Portaled to the page body above the composer's value popover (itself a portal) so a press
  // on a popover row shows its details over it; `pointer-events-auto` because a modal popover
  // switches the rest of the body off.
  return createPortal(
    <div
      data-extension-tab-layer={tab.kind}
      className="pointer-events-auto fixed inset-0 z-[100] flex min-h-0 flex-col bg-background"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1">
        <span className="truncate text-sm font-medium">{tab.title}</span>
        <Button variant="ghost" size="sm" aria-label="Close" onClick={() => setCurrent(null)}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>,
    document.body,
  );
}
