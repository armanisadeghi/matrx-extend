/**
 * Audit-key card (CLAUDE.md roadmap item #8). Lives inside the admin-only
 * Advanced agent capabilities section. Four sections:
 *
 *   1. Display the active publicKeyId + creation time + a count of
 *      retained receipts.
 *   2. "Re-key" — rotates the device keypair after explicit confirmation.
 *      Old receipts continue to verify because the previous public key is
 *      retained in `matrx.audit.publicKeyHistory`.
 *   3. "Export public key" — copies the active public-key JWK to the
 *      clipboard so an external auditor can verify exported receipts.
 *   4. Recent receipts panel — last 20 entries with an origin filter
 *      (agent / pilot / parallel / webmcp) so admins can confirm
 *      coverage across every tool-execution path.
 *
 * No backend round-trip — every operation reads / writes
 * `chrome.storage.local` directly via `lib/audit/device-key` /
 * `lib/audit/log`.
 */

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MAX_RECEIPTS, getReceiptCount, getRecentReceipts } from '@/lib/audit/log';
import type { ReceiptOrigin, ToolReceipt } from '@/lib/audit/receipt';
import {
  exportPublicKeyJwk,
  rotateDeviceKey,
} from '@/lib/audit/device-key';
import { cn } from '@/lib/utils';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const RECENT_LIMIT = 20;
const ORIGIN_FILTERS: Array<ReceiptOrigin | 'all'> = ['all', 'agent', 'pilot', 'parallel', 'webmcp'];

/** Treat receipts that pre-date schema v2 (no `origin` field) as 'agent'. */
function originOf(r: ToolReceipt): ReceiptOrigin {
  return r.origin ?? 'agent';
}

export function AuditKeyCard() {
  const [publicKeyId, setPublicKeyId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'rotate' | 'export' | null>(null);
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<ToolReceipt[] | null>(null);
  const [originFilter, setOriginFilter] = useState<ReceiptOrigin | 'all'>('all');
  const [rotateOpen, setRotateOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [pk, c, r] = await Promise.all([
      exportPublicKeyJwk(),
      getReceiptCount(),
      getRecentReceipts(RECENT_LIMIT),
    ]);
    setPublicKeyId(pk.publicKeyId);
    setCreatedAt(pk.createdAt);
    setCount(c);
    setRecent(r);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const handleRotateConfirmed = async () => {
    setRotateOpen(false);
    setBusy('rotate');
    try {
      await rotateDeviceKey();
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async () => {
    setBusy('export');
    try {
      const pk = await exportPublicKeyJwk();
      await navigator.clipboard.writeText(JSON.stringify(pk.publicKeyJwk, null, 2));
      setCopied(true);
    } catch (err) {
      console.warn('[audit] export public key failed', err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <KeyRound className="size-3" />
        Audit key
      </div>
      <div className="text-[11px] text-muted-foreground">
        Every tool call is signed with a device-bound Ed25519 key and stored in a
        local audit log. Cap: {MAX_RECEIPTS} receipts (FIFO).
      </div>

      <div className="space-y-1 pt-1">
        <Row label="Public key ID" value={publicKeyId ?? '—'} mono />
        <Row
          label="Generated"
          value={createdAt ? new Date(createdAt).toLocaleString() : '—'}
        />
        <Row label="Receipts on file" value={count !== null ? String(count) : '—'} />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void handleExport()}
          disabled={busy !== null}
          className="h-7 gap-1.5 rounded-full px-3 text-xs"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          Export public key
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRotateOpen(true)}
          disabled={busy !== null}
          className="h-7 rounded-full px-3 text-xs"
        >
          {busy === 'rotate' ? 'Rotating…' : 'Re-key'}
        </Button>
      </div>

      <RecentReceiptsPanel
        receipts={recent}
        originFilter={originFilter}
        onOriginFilterChange={setOriginFilter}
      />

      <ConfirmDialog
        open={rotateOpen}
        title="Rotate the device audit key?"
        description={
          'A new keypair will be generated.\n\nExisting receipts continue to verify against the retired key (kept in local history). This cannot be undone.'
        }
        confirmLabel="Rotate key"
        destructive
        busy={busy === 'rotate'}
        onConfirm={() => void handleRotateConfirmed()}
        onClose={() => setRotateOpen(false)}
      />
    </div>
  );
}

interface RecentReceiptsPanelProps {
  receipts: ToolReceipt[] | null;
  originFilter: ReceiptOrigin | 'all';
  onOriginFilterChange: (next: ReceiptOrigin | 'all') => void;
}

/**
 * Last-N receipts table with an origin filter. Receipts are already
 * sorted newest-first by `getRecentReceipts`. Filtering is purely
 * client-side derived state — recompute on every render via useMemo
 * because the underlying list is small (<=20).
 */
function RecentReceiptsPanel({
  receipts,
  originFilter,
  onOriginFilterChange,
}: RecentReceiptsPanelProps) {
  const counts = useMemo(() => {
    const c: Record<ReceiptOrigin | 'all', number> = {
      all: 0,
      agent: 0,
      pilot: 0,
      parallel: 0,
      webmcp: 0,
    };
    if (!receipts) return c;
    c.all = receipts.length;
    for (const r of receipts) {
      const o = originOf(r);
      c[o] = (c[o] ?? 0) + 1;
    }
    return c;
  }, [receipts]);

  const filtered = useMemo(() => {
    if (!receipts) return [];
    if (originFilter === 'all') return receipts;
    return receipts.filter((r) => originOf(r) === originFilter);
  }, [receipts, originFilter]);

  return (
    <div className="space-y-1.5 border-t pt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Recent receipts
        </div>
        <div className="text-[10px] text-muted-foreground">
          {receipts === null ? 'loading…' : `last ${Math.min(RECENT_LIMIT, counts.all)}`}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {ORIGIN_FILTERS.map((o) => {
          const active = originFilter === o;
          const n = counts[o];
          return (
            <button
              key={o}
              type="button"
              onClick={() => onOriginFilterChange(o)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {o}
              <span className={cn('ml-1 tabular-nums', active ? 'opacity-80' : 'opacity-60')}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {receipts !== null && filtered.length === 0 && (
        <div className="rounded-md border border-dashed bg-muted/30 px-2 py-2 text-[11px] text-muted-foreground">
          No receipts {originFilter === 'all' ? 'yet' : `with origin=${originFilter}`}.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-md border">
          {filtered.map((r) => (
            <ReceiptRow key={`${r.callId}-${r.startedAt}-${r.outputHash}`} receipt={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReceiptRow({ receipt }: { receipt: ToolReceipt }) {
  const origin = originOf(receipt);
  const ts = new Date(receipt.startedAt).toLocaleTimeString();
  const status =
    receipt.outputHash === 'pending' ? 'pending' : receipt.ok ? 'ok' : 'error';
  return (
    <div className="flex items-center gap-2 border-b px-2 py-1.5 text-[11px] last:border-b-0">
      <OriginChip origin={origin} />
      <span className="flex-1 truncate font-mono text-[10.5px]" title={receipt.toolName}>
        {receipt.toolName}
      </span>
      <span
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider',
          status === 'ok' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          status === 'error' && 'bg-red-500/10 text-red-700 dark:text-red-400',
          status === 'pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        )}
      >
        {status}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground" title={String(receipt.startedAt)}>
        {ts}
      </span>
    </div>
  );
}

function OriginChip({ origin }: { origin: ReceiptOrigin }) {
  const styles: Record<ReceiptOrigin, string> = {
    agent: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
    pilot: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
    parallel: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    webmcp: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  };
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider',
        styles[origin],
      )}
    >
      {origin}
    </span>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 px-1 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? 'truncate font-mono text-[11px]' : 'truncate'}>{value}</span>
    </div>
  );
}
