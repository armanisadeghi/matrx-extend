/**
 * Audit-key card (CLAUDE.md roadmap item #8). Lives inside the admin-only
 * Advanced agent capabilities section. Three controls:
 *
 *   1. Display the active publicKeyId + creation time + a count of
 *      retained receipts.
 *   2. "Re-key" — rotates the device keypair after explicit confirmation.
 *      Old receipts continue to verify because the previous public key is
 *      retained in `matrx.audit.publicKeyHistory`.
 *   3. "Export public key" — copies the active public-key JWK to the
 *      clipboard so an external auditor can verify exported receipts.
 *
 * No backend round-trip — every operation reads / writes
 * `chrome.storage.local` directly via `lib/audit/device-key`.
 */

import { Button } from '@/components/ui/button';
import { MAX_RECEIPTS, getReceiptCount } from '@/lib/audit/log';
import {
  exportPublicKeyJwk,
  rotateDeviceKey,
} from '@/lib/audit/device-key';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export function AuditKeyCard() {
  const [publicKeyId, setPublicKeyId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'rotate' | 'export' | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const [pk, c] = await Promise.all([exportPublicKeyJwk(), getReceiptCount()]);
    setPublicKeyId(pk.publicKeyId);
    setCreatedAt(pk.createdAt);
    setCount(c);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const handleRotate = async () => {
    if (
      !window.confirm(
        'Rotate the device audit key?\n\n' +
          'A new keypair will be generated. Existing receipts continue to verify ' +
          'against the retired key (kept in local history). This cannot be undone.',
      )
    ) {
      return;
    }
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
          onClick={() => void handleRotate()}
          disabled={busy !== null}
          className="h-7 rounded-full px-3 text-xs"
        >
          {busy === 'rotate' ? 'Rotating…' : 'Re-key'}
        </Button>
      </div>
    </div>
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
