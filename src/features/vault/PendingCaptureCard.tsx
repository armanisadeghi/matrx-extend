/**
 * "Save this login?" — the side-panel twin of the in-page toast.
 *
 * Shows the pending capture candidate for the CURRENT tab (metadata only:
 * host, username, existing saved logins) and posts the same value-free
 * decisions to the service worker host (`capture-candidates.ts`). The
 * password never reaches this surface — the SW writes it to the Vault.
 */

import type {
  CaptureDecision,
  CaptureDecisionResult,
  CapturePromptMeta,
  CaptureStatusQuery,
} from '@/lib/credentials/capture-types';
import { filterCaptureUpdateTargets } from '@/lib/credentials/capture-update-targets';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { Button, BasicInput as Input } from '@ai-matrx/design-system';
import { Loader2, ShieldPlus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  const [targetQuery, setTargetQuery] = useState('');
  const currentCandidateId = useRef<string | null>(null);
  const refreshEpoch = useRef(0);
  currentCandidateId.current = meta?.candidateId ?? null;
  const updateTargets = useMemo(
    () => (meta ? filterCaptureUpdateTargets(meta.existing, targetQuery) : []),
    [meta, targetQuery],
  );

  const refresh = useCallback(async () => {
    if (tabId === null) {
      refreshEpoch.current++;
      currentCandidateId.current = null;
      setMeta(null);
      setBusy(false);
      setNotice(null);
      setTargetQuery('');
      return;
    }
    const requestEpoch = ++refreshEpoch.current;
    try {
      const next = await send<CaptureStatusQuery, CapturePromptMeta | null>(
        CHANNELS.CREDENTIAL_CAPTURE_STATUS,
        { tabId },
      );
      if (requestEpoch !== refreshEpoch.current) return;
      if (currentCandidateId.current !== (next?.candidateId ?? null)) {
        currentCandidateId.current = next?.candidateId ?? null;
        setBusy(false);
        setNotice(null);
        setTargetQuery('');
      }
      setMeta(next ?? null);
    } catch {
      if (requestEpoch !== refreshEpoch.current) return;
      currentCandidateId.current = null;
      setMeta(null);
      setBusy(false);
      setNotice(null);
      setTargetQuery('');
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
      const candidateId = meta.candidateId;
      setBusy(true);
      setNotice(null);
      try {
        const r = await send<CaptureDecision, CaptureDecisionResult>(
          CHANNELS.CREDENTIAL_CAPTURE_DECISION,
          { candidateId, ...decision },
        );
        if (currentCandidateId.current !== candidateId) return;
        setNotice(r.message);
        if (r.status === 'saved' || r.status === 'updated') onSaved();
        if (r.ok || r.status === 'expired') setTimeout(() => setNotice(null), 2500);
      } catch {
        if (currentCandidateId.current !== candidateId) return;
        setNotice('Matrx did not answer. Try again.');
      } finally {
        if (currentCandidateId.current === candidateId) setBusy(false);
      }
    },
    [meta, onSaved],
  );

  if (!meta && !notice) return null;

  return (
    <div className="mx-2 mb-2 rounded-md border border-primary/30 bg-primary/5 p-2">
      {meta ? (
        meta.unavailable ? (
          <p className="text-[11px] text-muted-foreground">
            Temporary browser memory is unavailable. Reopen the extension, then save this login from
            the Vault.
          </p>
        ) : (
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
            {meta.existing.length > 0 && (
              <div className="mb-1.5 space-y-1">
                {meta.existing.length > 1 && (
                  <Input
                    aria-label="Search saved logins to update"
                    className="h-7 text-[11px]"
                    value={targetQuery}
                    onChange={(event) => setTargetQuery(event.target.value)}
                    placeholder="Search saved logins"
                  />
                )}
                <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                  {updateTargets.map((item) => (
                    <Button
                      key={item.item_id}
                      size="sm"
                      className="h-auto min-h-6 w-full justify-start px-2 py-1 text-left text-[11px]"
                      disabled={busy}
                      onClick={() => void decide({ action: 'update', itemId: item.item_id })}
                    >
                      {busy ? <Loader2 className="size-3 animate-spin" /> : 'Update'}
                      <span className="ml-1 min-w-0 truncate">{item.display_name}</span>
                      {item.username && (
                        <span className="ml-1 min-w-0 truncate text-muted-foreground">
                          · {item.username}
                        </span>
                      )}
                    </Button>
                  ))}
                  {updateTargets.length === 0 && (
                    <p className="px-1 text-[11px] text-muted-foreground">No saved logins match.</p>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1">
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
        )
      ) : null}
      {notice && <p className="mt-1 text-[11px] text-muted-foreground">{notice}</p>}
    </div>
  );
}
