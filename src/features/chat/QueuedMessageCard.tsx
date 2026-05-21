/**
 * Turn-boundary inbox UI — the "waiting its turn" cards that hover above the
 * composer when the user queues a message into a still-running agent.
 *
 * One {@link QueuedMessageCard} per pending injection. The stack matches the
 * composer's horizontal padding so the cards read as floating just above the
 * input. A soft drifting gradient + pulsing dot give it a calm, dreamy "I'm
 * waiting" feel; a live timer shows how long it's been queued. When the
 * running agent drains the item (`injection_consumed` on the stream) the card
 * flips to a brief "Delivered" state and then removes itself — the message has
 * by then been inserted into the transcript as a real user bubble.
 */

import { cancelInboxMessage, editInboxMessage } from "@/lib/api/routes/ai";
import { cn } from "@/lib/utils";
import { type QueuedInjection, useTurnInboxStore } from "@/state/turn-inbox";
import { AlertTriangle, Check, Clock, Loader2, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";

/** How long a delivered card lingers (ms) before it removes itself. */
const DELIVERED_LINGER_MS = 1600;

function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Floating stack of queued-message cards for the active conversation.
 * Renders nothing when the inbox is empty, so it's free to always mount.
 */
export function QueuedMessageStack({
  conversationId,
}: {
  conversationId: string | null;
}) {
  const items = useTurnInboxStore((s) => s.items);
  const mine = items.filter((i) => i.conversationId === conversationId);

  // One shared ticker re-renders the live timers ~once a second while any item
  // is still waiting. Stops when nothing is pending so we don't spin forever.
  const hasWaiting = mine.some(
    (i) => i.status === "sending" || i.status === "pending",
  );
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasWaiting) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasWaiting]);

  if (mine.length === 0) return null;

  return (
    <div className="px-3 pb-1.5">
      <div className="flex flex-col gap-1.5">
        {mine.map((item) => (
          <QueuedMessageCard key={item.localId} item={item} />
        ))}
      </div>
    </div>
  );
}

function QueuedMessageCard({ item }: { item: QueuedInjection }) {
  const remove = useTurnInboxStore((s) => s.remove);
  const updateText = useTurnInboxStore((s) => s.updateText);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(item.text);
  const [busy, setBusy] = useState(false);

  // Self-dismiss shortly after delivery — the message is now a real bubble.
  useEffect(() => {
    if (item.status !== "delivered") return;
    const id = setTimeout(() => remove(item.localId), DELIVERED_LINGER_MS);
    return () => clearTimeout(id);
  }, [item.status, item.localId, remove]);

  // Retract / edit need the server-assigned injection_id, which only exists
  // once the POST resolved (status 'pending'). 'sending' has no id yet.
  const canMutate = item.status === "pending" && !!item.injectionId;

  const handleCancel = async () => {
    if (!canMutate || !item.injectionId || !item.conversationId) return;
    setBusy(true);
    const res = await cancelInboxMessage(item.conversationId, item.injectionId);
    setBusy(false);
    // 200 (cancelled) or 404 (already gone) → drop the card. 409 means it
    // drained between our click and the request — leave it; the delivered
    // flow will take over.
    if (res.ok || res.status === 404) remove(item.localId);
  };

  const handleSaveEdit = async () => {
    if (!canMutate || !item.injectionId || !item.conversationId) return;
    const next = editDraft.trim();
    if (!next || next === item.text) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const res = await editInboxMessage(
      item.conversationId,
      item.injectionId,
      next,
    );
    setBusy(false);
    setEditing(false);
    // 200 → keep the edited text locally so the card + delivered bubble match.
    // 409 (drained) → leave the original; it's already on its way.
    if (res.ok) updateText(item.localId, next);
  };

  const elapsed = (item.deliveredAt ?? Date.now()) - item.queuedAt;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border px-3 py-2 shadow-md backdrop-blur-sm transition-all",
        "border-violet-300/40 dark:border-violet-400/20",
        item.status === "delivered"
          ? "bg-emerald-50/80 dark:bg-emerald-950/30"
          : item.status === "failed"
            ? "bg-red-50/80 dark:bg-red-950/30"
            : "bg-gradient-to-br from-indigo-50/80 to-violet-50/70 dark:from-indigo-950/40 dark:to-violet-950/30",
      )}
    >
      {/* Dreamy drifting sheen — only while the item is waiting. */}
      {(item.status === "sending" || item.status === "pending") && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-dreamy-drift bg-[linear-gradient(110deg,transparent_20%,rgba(139,92,246,0.10)_50%,transparent_80%)] [background-size:200%_200%]"
        />
      )}

      <div className="relative flex items-center gap-2 text-[11px] font-medium">
        {item.status === "sending" && (
          <>
            <Loader2 className="size-3 animate-spin text-violet-500" />
            <span className="text-violet-700 dark:text-violet-300">Sending…</span>
          </>
        )}
        {item.status === "pending" && (
          <>
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-violet-400/70" />
              <span className="relative inline-flex size-2 rounded-full bg-violet-500" />
            </span>
            <span className="text-violet-700 dark:text-violet-300">
              Queued — waiting its turn
            </span>
            <span className="ml-auto inline-flex items-center gap-1 tabular-nums text-violet-600/80 dark:text-violet-300/70">
              <Clock className="size-3" />
              {elapsedLabel(elapsed)}
            </span>
            {!editing && (
              <span className="ml-1 inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditDraft(item.text);
                    setEditing(true);
                  }}
                  disabled={busy || !canMutate}
                  className="rounded p-0.5 text-violet-600/70 transition-colors hover:bg-violet-500/10 hover:text-violet-700 disabled:opacity-40 dark:text-violet-300/70"
                  title="Edit before it's delivered"
                  aria-label="Edit queued message"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  disabled={busy || !canMutate}
                  className="rounded p-0.5 text-violet-600/70 transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40 dark:text-violet-300/70"
                  title="Retract — remove before it's delivered"
                  aria-label="Retract queued message"
                >
                  {busy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <X className="size-3" />
                  )}
                </button>
              </span>
            )}
          </>
        )}
        {item.status === "delivered" && (
          <>
            <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span className="text-emerald-700 dark:text-emerald-300">
              Delivered to the agent
            </span>
          </>
        )}
        {item.status === "failed" && (
          <>
            <AlertTriangle className="size-3 text-red-600 dark:text-red-400" />
            <span className="text-red-700 dark:text-red-400">Couldn't queue</span>
            <button
              type="button"
              onClick={() => remove(item.localId)}
              className="ml-auto rounded px-1 text-red-600/70 hover:text-red-700 dark:text-red-400/70"
              aria-label="Dismiss"
            >
              <span aria-hidden>×</span>
            </button>
          </>
        )}
      </div>

      {editing ? (
        <div className="relative mt-1">
          <textarea
            // biome-ignore lint/a11y/noAutofocus: focus the editor the user just opened
            autoFocus
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSaveEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            rows={2}
            className="block w-full resize-none rounded-md border border-violet-300/40 bg-background/60 px-2 py-1 text-xs leading-snug focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-violet-400/20"
          />
          <div className="mt-1 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSaveEdit()}
              disabled={busy || !editDraft.trim()}
              className="rounded bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <p
          className={cn(
            "relative mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-snug text-foreground/80",
            item.status === "failed" && "text-red-700/80 dark:text-red-300/80",
          )}
        >
          {item.text}
        </p>
      )}

      {item.status === "failed" && item.error && (
        <p className="relative mt-1 text-[10px] text-red-600/70 dark:text-red-400/70">
          {item.error}
        </p>
      )}
    </div>
  );
}
