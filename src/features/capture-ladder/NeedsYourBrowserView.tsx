/**
 * "Needs your browser" — rungs 3 and 4 as a person sees them
 * (CONTRACT.md §7.1, §7.3, §7.4).
 *
 * Two kinds of item live here and they are deliberately NOT the same card:
 *
 *  - **waiting** (rung 3): nothing for the person to do. They press "Run these
 *    in my browser" and walk away; the runner opens each page in a background
 *    tab, reads it, closes it.
 *  - **needs_drive** (rung 4): the extension already tried and could not read
 *    it. The card says, in one sentence, why and what to do — then gets out of
 *    the way. It opens the page in a FOCUSED tab and does not touch it again:
 *    no scroll, no script, no capture, until the person presses "I am done,
 *    capture it".
 *
 * The screen never lies about its own freshness: when the realtime socket is
 * not carrying, the header says so and names the refresh interval, rather than
 * showing a possibly-stale list as if it were live (law 4).
 */

import { queueSentences } from '@/features/capture-ladder/queue-sentences';
import { useCapturePickup } from '@/features/capture-ladder/use-capture-pickup';
import { getCapturePolicy } from '@/lib/capture-ladder/api';
import { dismissHandoff } from '@/lib/capture-ladder/api';
import { clearCapturePickup, orderForPickup, pickupMissWhy } from '@/lib/capture-ladder/pickup';
import {
  type ElsewhereWaiting,
  type NeedsYouUpdate,
  subscribeNeedsYou,
} from '@/lib/capture-ladder/queue';
import { type RunPhase, captureDrivenTab, runBatch } from '@/lib/capture-ladder/runner';
import type { Handoff } from '@/lib/capture-ladder/types';
import { listMemberOrganizations, selectActiveOrganization } from '@/lib/org/active-org';
import { Badge, Button, BasicTextarea as Textarea } from '@ai-matrx/design-system';
import { formatDurationSeconds } from '@ai-matrx/kit/format';
import { ArrowRightLeft, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PHASE_LABEL: Record<RunPhase, string> = {
  claiming: 'Taking it…',
  opening: 'Opening the page…',
  settling: 'Waiting for it to load…',
  scrolling: 'Reading down the page…',
  reading: 'Reading it…',
  reporting: 'Saving…',
  done: 'Done',
  refused: 'Stopped',
};

interface ItemStatus {
  phase: RunPhase;
  detail: string;
}

/** A rung-4 item the person is currently driving, and the tab it is open in. */
interface Driving {
  handoffId: string;
  tabId: number | null;
  /** Set when the tab could not be opened — shown instead of a dead button. */
  problem: string | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function NeedsYourBrowserView(): React.JSX.Element {
  const [update, setUpdate] = useState<NeedsYouUpdate | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ItemStatus>>({});
  const [running, setRunning] = useState(false);
  const [policyNote, setPolicyNote] = useState<string | null>(null);
  const [driving, setDriving] = useState<Driving | null>(null);
  const [dismissNote, setDismissNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchProblem, setSwitchProblem] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pickup = useCapturePickup();

  useEffect(() => {
    const off = subscribeNeedsYou(setUpdate);
    return () => {
      off();
      abortRef.current?.abort();
    };
  }, []);

  const rawItems = useMemo(() => update?.items ?? [], [update]);
  // The row the web app pointed at goes first — in its own section, so the
  // ordering rule does not have to fight the waiting/you-drive split.
  const picked = useMemo(() => orderForPickup(rawItems, pickup), [rawItems, pickup]);
  const items = picked.items;
  const pickedId = picked.pickedId;
  const waiting = useMemo(() => items.filter((i) => i.status === 'waiting'), [items]);
  const needsDrive = useMemo(() => items.filter((i) => i.status === 'needs_drive'), [items]);
  const sentences = useMemo(
    () =>
      queueSentences({
        itemCount: items.length,
        organizationName: update?.organizationName ?? null,
        elsewhere: update?.elsewhere ?? [],
        elsewhereError: update?.elsewhereError ?? null,
      }),
    [items.length, update?.organizationName, update?.elsewhere, update?.elsewhereError],
  );
  // A pointer we could not honour is SAID, not swallowed: one line naming the
  // page and the likeliest reason it is gone (law 4).
  const pickupMiss =
    pickup && !picked.matched ? pickupMissWhy(pickup, update?.organizationName ?? null) : null;

  /**
   * Switch to the workspace that actually holds the waiting pages. Goes
   * through `selectActiveOrganization` in the ONE resolver — this view never
   * writes the stored selection itself — and only ever with a row that came
   * out of the person's own membership read.
   */
  const switchTo = useCallback(async (target: ElsewhereWaiting): Promise<void> => {
    setSwitching(true);
    setSwitchProblem(null);
    try {
      const organizations = await listMemberOrganizations();
      const match = organizations.find((o) => o.id === target.organizationId);
      if (!match) {
        setSwitchProblem(
          `You are no longer a member of ${target.organizationName}, so AI Matrx cannot open its list. Ask an admin of that workspace to add you back.`,
        );
        return;
      }
      await selectActiveOrganization(match);
      // The subscription's own poll re-reads under the new organization; this
      // clears the now-meaningless pointer so nothing gets pinned in the
      // workspace we just left.
      await clearCapturePickup();
    } catch (err) {
      setSwitchProblem(
        `AI Matrx could not switch workspaces: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSwitching(false);
    }
  }, []);

  const onProgress = useCallback((handoffId: string, phase: RunPhase, detail?: string): void => {
    setStatuses((cur) => ({
      ...cur,
      [handoffId]: { phase, detail: detail ?? PHASE_LABEL[phase] },
    }));
  }, []);

  const runAll = useCallback(async (): Promise<void> => {
    if (running || waiting.length === 0) return;
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const policy = await getCapturePolicy(controller.signal);
      setPolicyNote(policy.degraded_note);
      const outcomes = await runBatch(waiting, {
        scrollPasses: policy.scroll_passes,
        onProgress,
        signal: controller.signal,
      });
      setStatuses((cur) => {
        const next = { ...cur };
        for (const outcome of outcomes) {
          next[outcome.handoffId] = {
            phase: outcome.ok ? 'done' : 'refused',
            detail: outcome.note,
          };
        }
        return next;
      });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [running, waiting, onProgress]);

  /** Open a rung-4 page for the person — focused — and then leave it alone. */
  const startDriving = useCallback(async (handoff: Handoff): Promise<void> => {
    setDismissNote('');
    if (typeof chrome === 'undefined' || typeof chrome.tabs?.create !== 'function') {
      setDriving({
        handoffId: handoff.id,
        tabId: null,
        problem:
          'AI Matrx cannot open tabs in this browser. Open the link yourself in a new tab, ' +
          'then come back here.',
      });
      return;
    }
    try {
      const tab = await chrome.tabs.create({ url: handoff.url, active: true });
      setDriving({
        handoffId: handoff.id,
        tabId: typeof tab.id === 'number' ? tab.id : null,
        problem:
          typeof tab.id === 'number'
            ? null
            : 'The tab opened but AI Matrx lost track of it. Close it and press Open again.',
      });
    } catch (err) {
      setDriving({
        handoffId: handoff.id,
        tabId: null,
        problem: `The page would not open: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  const finishDriving = useCallback(
    async (handoff: Handoff): Promise<void> => {
      if (!driving || driving.handoffId !== handoff.id || driving.tabId === null) return;
      setBusyId(handoff.id);
      try {
        const outcome = await captureDrivenTab(handoff, driving.tabId);
        setStatuses((cur) => ({
          ...cur,
          [handoff.id]: { phase: outcome.ok ? 'done' : 'refused', detail: outcome.note },
        }));
        if (outcome.ok) setDriving(null);
      } finally {
        setBusyId(null);
      }
    },
    [driving],
  );

  const giveUpOn = useCallback(async (handoff: Handoff, note: string): Promise<void> => {
    setBusyId(handoff.id);
    try {
      const res = await dismissHandoff(handoff.id, note.trim() || undefined);
      setStatuses((cur) => ({
        ...cur,
        [handoff.id]: {
          phase: 'refused',
          detail: res.ok
            ? 'Skipped. It will not be asked for again.'
            : `Could not skip it: ${res.error}`,
        },
      }));
      if (res.ok) {
        setDriving(null);
        setDismissNote('');
      }
    } finally {
      setBusyId(null);
    }
  }, []);

  if (!update) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 size-4 animate-spin" /> Checking what needs your browser…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-semibold">{sentences.headline}</h1>
          {update.health === 'degraded' && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <RefreshCw className="size-3" /> Refreshing on a timer
            </Badge>
          )}
        </div>
        {update.health === 'degraded' && update.note && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{update.note}</p>
        )}
        {update.error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            This list may be out of date: {update.error}
          </p>
        )}
        {policyNote && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{policyNote}</p>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {/* THE EMPTY STATE IS NEVER A BARE "NOTHING". It names the workspace it
          looked in, and when the person's other memberships hold waiting pages
          it says so in one sentence with a real control — the exact lie that
          sent the owner hunting through the wrong tab. */}
        {items.length === 0 && <p className="text-sm text-zinc-500">{sentences.emptyLine}</p>}

        {sentences.elsewhereLine && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
            <p className="text-sm">{sentences.elsewhereLine}</p>
            {sentences.switchTo && sentences.switchLabel && (
              <Button
                size="sm"
                variant="outline"
                disabled={switching}
                onClick={() => {
                  const target = sentences.switchTo;
                  if (target) void switchTo(target);
                }}
              >
                {switching ? (
                  <>
                    <Loader2 className="mr-1 size-3.5 animate-spin" /> Switching…
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="mr-1 size-3.5" /> {sentences.switchLabel}
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        {sentences.elsewhereProblem && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            {sentences.elsewhereProblem}
          </p>
        )}

        {switchProblem && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{switchProblem}</p>
        )}

        {pickupMiss && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{pickupMiss}</p>
        )}

        {waiting.length > 0 && (
          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Your browser can do these on its own
              </h2>
              <Button size="sm" disabled={running} onClick={() => void runAll()}>
                {running ? (
                  <>
                    <Loader2 className="mr-1 size-3.5 animate-spin" /> Running…
                  </>
                ) : (
                  `Run these in my browser (${waiting.length})`
                )}
              </Button>
            </div>
            <ul className="space-y-2">
              {waiting.map((item) => (
                <li
                  key={item.id}
                  className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800"
                >
                  <div className="font-medium">{item.title || hostOf(item.url)}</div>
                  <div className="truncate text-xs text-zinc-500" title={item.url}>
                    {item.url}
                  </div>
                  {item.id === pickedId && (
                    <p className="text-xs text-primary">Sent from AI Matrx just now.</p>
                  )}
                  {item.reason_note && (
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {item.reason_note}
                    </p>
                  )}
                  {statuses[item.id] && (
                    <p
                      className={`mt-1 text-xs ${
                        statuses[item.id]?.phase === 'refused'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-zinc-500'
                      }`}
                    >
                      {statuses[item.id]?.detail}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {needsDrive.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              You drive these
            </h2>
            <ul className="space-y-3">
              {needsDrive.map((item) => {
                const isDriving = driving?.handoffId === item.id;
                const busy = busyId === item.id;
                return (
                  <li
                    key={item.id}
                    className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                  >
                    <div className="font-medium">{item.title || hostOf(item.url)}</div>
                    <div className="truncate text-xs text-zinc-500" title={item.url}>
                      {item.url}
                    </div>
                    {item.id === pickedId && (
                      <p className="text-xs text-primary">Sent from AI Matrx just now.</p>
                    )}
                    {item.reason_note && (
                      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                        {item.reason_note}
                      </p>
                    )}
                    {item.what_to_do && <p className="mt-1 text-sm">{item.what_to_do}</p>}
                    {item.estimated_seconds !== null && (
                      <p className="mt-1 text-xs text-zinc-500">
                        About{' '}
                        {formatDurationSeconds(item.estimated_seconds, {
                          style: 'long',
                          round: 'nearest',
                        })}
                        .
                      </p>
                    )}

                    {!isDriving ? (
                      <Button size="sm" className="mt-2" onClick={() => void startDriving(item)}>
                        <ExternalLink className="mr-1 size-3.5" /> Open it
                      </Button>
                    ) : (
                      <div className="mt-2 rounded bg-zinc-50 p-2 dark:bg-zinc-900">
                        {driving.problem ? (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            {driving.problem}
                          </p>
                        ) : (
                          <p className="text-xs text-zinc-600 dark:text-zinc-400">
                            The page is open in its own tab. Sign in, click through, scroll — AI
                            Matrx will not touch it. Press the button below when what you want saved
                            is on the screen.
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={busy || driving.tabId === null}
                            onClick={() => void finishDriving(item)}
                          >
                            {busy ? (
                              <>
                                <Loader2 className="mr-1 size-3.5 animate-spin" /> Saving…
                              </>
                            ) : (
                              "I'm done, capture it"
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void giveUpOn(item, dismissNote)}
                          >
                            This one won't work
                          </Button>
                        </div>
                        <Textarea
                          className="mt-2 text-xs"
                          rows={2}
                          placeholder="Optional: what stopped you? (saved with the skip)"
                          value={dismissNote}
                          onChange={(e) => setDismissNote(e.target.value)}
                        />
                      </div>
                    )}

                    {statuses[item.id] && (
                      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                        {statuses[item.id]?.detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
