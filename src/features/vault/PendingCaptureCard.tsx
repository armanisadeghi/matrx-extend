/**
 * "Save this login?" — the side-panel twin of the in-page toast.
 *
 * Shows the pending capture candidate for the CURRENT tab (metadata only:
 * host, username, existing saved logins) and posts the same value-free
 * decisions to the service worker host (`capture-candidates.ts`). The
 * password never reaches this surface — the SW writes it to the Vault.
 */

import { Button } from '@/components/ui/button';
import type {
  CaptureDecision,
  CaptureDecisionResult,
  CapturePromptMeta,
  CaptureStatusQuery,
} from '@/lib/credentials/capture-types';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { Loader2, ShieldPlus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export function PendingCaptureCard({
  tabId,
  onSaved,
}: {
  tabId: number | null;
  /** The Vault list should refresh after a save / update. */
  onSaved: () => void;
}) {
  const [meta, setMeta] = useState<CapturePromptMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (tabId === null) {
      setMeta(null);
      return;
    }
    try {
      const next = await send<CaptureStatusQuery, CapturePromptMeta | null>(
        CHANNELS.CREDENTIAL_CAPTURE_STATUS,
        { tabId },
      );
      setMeta(next ?? null);
    } catch {
      setMeta(null);
    }
  }, [tabId]);

  useEffect(() => {
    void refresh();
    return on<{ tabId: number }, void>(CHANNELS.CREDENTIAL_CAPTURE_CHANGED, (p) => {
      if (p?.tabId === tabId) void refresh();
    });
  }, [refresh, tabId]);

  const decide = useCallback(
    async (decision: Omit<CaptureDecision, 'candidateId'>) => {
      if (!meta) return;
      setBusy(true);
      setNotice(null);
      try {
        const r = await send<CaptureDecision, CaptureDecisionResult>(
          CHANNELS.CREDENTIAL_CAPTURE_DECISION,
          { candidateId: meta.candidateId, ...decision },
        );
        setNotice(r.message);
        if (r.status === 'saved' || r.status === 'updated') onSaved();
        if (r.ok || r.status === 'expired') setTimeout(() => setNotice(null), 2500);
      } catch {
        setNotice('Matrx did not answer. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [meta, onSaved],
  );

  if (!meta && !notice) return null;

  return (
    <div className="mx-2 mb-2 rounded-md border border-primary/30 bg-primary/5 p-2">
      {meta ? (
        <>
          <div className="mb-1 flex items-start gap-1.5">
            <ShieldPlus className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Save this login to your Vault?</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {meta.username ? `${meta.host} · ${meta.username}` : meta.host}
              </p>
            </div>
            <button
              type="button"
              title="Not now"
              className="text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={() => void decide({ action: 'dismiss' })}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {meta.existing.slice(0, 3).map((item) => (
              <Button
                key={item.item_id}
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={busy}
                onClick={() => void decide({ action: 'update', itemId: item.item_id })}
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : `Update ${item.display_name}`}
              </Button>
            ))}
            <Button
              size="sm"
              variant={meta.existing.length > 0 ? 'outline' : 'default'}
              className="h-6 px-2 text-[11px]"
              disabled={busy}
              onClick={() => void decide({ action: 'save' })}
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : meta.existing.length > 0 ? (
                'Save as new'
              ) : (
                'Save'
              )}
            </Button>
            <button
              type="button"
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={() => void decide({ action: 'never' })}
            >
              Never for this site
            </button>
          </div>
        </>
      ) : null}
      {notice && <p className="mt-1 text-[11px] text-muted-foreground">{notice}</p>}
    </div>
  );
}
