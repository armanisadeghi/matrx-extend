/**
 * Modal that renders a cryptographic run receipt for a tool call
 * (CLAUDE.md roadmap item #8). Looks up the receipt from the local
 * audit log by callId, verifies its signature against the public-key
 * history, and shows the JSON + a Copy-JWS button.
 *
 * The component owns its own data fetch — opening the dialog issues a
 * fresh `getReceiptByCallId` so we never display a stale row.
 *
 * No shadcn dialog primitive exists in this repo; we render a fixed
 * overlay + click-outside-to-close + Esc-to-close. Matches the
 * lightweight pattern used by other modal-ish surfaces (no portal —
 * the side panel root is small enough that fixed-position covers it).
 */

import { Button } from '@/components/ui/button';
import { getReceiptByCallId } from '@/lib/audit/log';
import { type ToolReceipt, exportReceiptJws, verifyReceipt } from '@/lib/audit/receipt';
import { cn } from '@/lib/utils';
import { Check, Copy, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface VerifyState {
  valid: boolean;
  reason?: string;
}

export function ToolReceiptDialog({
  callId,
  toolName,
  onClose,
}: {
  callId: string;
  toolName: string;
  onClose: () => void;
}) {
  const [receipt, setReceipt] = useState<ToolReceipt | null>(null);
  const [verify, setVerify] = useState<VerifyState | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState<'json' | 'jws' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await getReceiptByCallId(callId);
      if (cancelled) return;
      if (!r) {
        setMissing(true);
        return;
      }
      setReceipt(r);
      const v = await verifyReceipt(r);
      if (!cancelled) setVerify(v);
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopyJson = async () => {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(receipt, null, 2));
      setCopied('json');
    } catch (err) {
      console.warn('[audit] clipboard write failed', err);
    }
  };

  const handleCopyJws = async () => {
    if (!receipt) return;
    try {
      const jws = await exportReceiptJws(receipt);
      await navigator.clipboard.writeText(jws);
      setCopied('jws');
    } catch (err) {
      console.warn('[audit] JWS export failed', err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Receipt for ${toolName}`}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-medium">Receipt</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{toolName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="space-y-2.5 px-3.5 py-3">
          {missing && (
            <div className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
              No receipt found for this call. The audit log may have been cleared, or this row
              predates the receipt feature.
            </div>
          )}

          {receipt && verify && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-md border p-2 text-xs',
                verify.valid
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                  : 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400',
              )}
            >
              {verify.valid ? (
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="font-medium">
                  {verify.valid ? 'Signature valid' : 'Invalid signature'}
                </div>
                {!verify.valid && verify.reason && (
                  <div className="mt-0.5 leading-snug opacity-90">{verify.reason}</div>
                )}
                {verify.valid && (
                  <div className="mt-0.5 font-mono text-[10px] opacity-80">
                    key {receipt.publicKeyId}
                  </div>
                )}
              </div>
            </div>
          )}

          {receipt && (
            <pre className="max-h-[40vh] overflow-auto rounded-md border bg-background/60 p-2 text-[10.5px] leading-snug">
              {JSON.stringify(receipt, null, 2)}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-3.5 py-2.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleCopyJson}
            disabled={!receipt}
            className="h-7 gap-1.5 rounded-full px-3 text-xs"
          >
            {copied === 'json' ? <Check className="size-3" /> : <Copy className="size-3" />}
            Copy JSON
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleCopyJws}
            disabled={!receipt}
            className="h-7 gap-1.5 rounded-full px-3 text-xs"
          >
            {copied === 'jws' ? <Check className="size-3" /> : <Copy className="size-3" />}
            Copy JWS
          </Button>
        </div>
      </div>
    </div>
  );
}
