import type { OpenGuidedResult } from '@/lib/guided-capture/host';
import { recipeForUrl } from '@/lib/guided-capture/recipes';
import type { GuidedStartRequest } from '@/lib/guided-capture/start';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { Button } from '@ai-matrx/design-system';
import { Rows3 } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * "Capture this feed" — starts the guided capture on the profile or feed open in the current tab,
 * from the side panel (Arman, 2026-10-24: it must be easy to open on whatever page we want).
 * Shown only where the guide knows the site and the page is a profile or feed (not a single post).
 */
export function GuidedCaptureBanner({
  tabId,
  url,
  signedIn,
}: {
  tabId: number | null;
  url: string | null;
  signedIn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  // A different page starts fresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change only
  useEffect(() => setSaid(null), [url]);

  const recipe = url ? recipeForUrl(url) : null;
  if (!signedIn || tabId === null || !url || !recipe || recipe.itemKey(url)) return null;

  const start = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const result = await send<GuidedStartRequest, OpenGuidedResult>(
        CHANNELS.GUIDED_CAPTURE_START,
        { tabId, url },
      );
      setSaid(
        result.ok
          ? { ok: true, text: 'The capture guide is open on the page.' }
          : { ok: false, text: result.sentence },
      );
    } catch {
      setSaid({ ok: false, text: 'The capture could not start. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-xl bg-secondary/60 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Rows3 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-foreground">
          Capture posts from this {recipe.label} page
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void start()}>
          {busy ? 'Opening…' : 'Capture feed'}
        </Button>
      </div>
      {said && (
        <div
          role={said.ok ? 'status' : 'alert'}
          className={said.ok ? 'text-muted-foreground' : 'text-destructive'}
        >
          {said.text}
        </div>
      )}
    </div>
  );
}
