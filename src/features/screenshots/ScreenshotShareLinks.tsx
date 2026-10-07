import { ENV } from '@/config/env';
import { requireActiveOrganizationId } from '@/lib/org/active-org';
import { getSupabase } from '@/lib/supabase/client';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@ai-matrx/design-system';
import { shortLinkUrl } from '@ai-matrx/kit/short-link';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ShareLink {
  id: string;
  token: string;
  short_token: string | null;
  label: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  is_active: boolean;
}
function linkUrl(link: Pick<ShareLink, 'token' | 'short_token'>): string {
  return link.short_token
    ? shortLinkUrl(ENV.FRONTEND_URL, link.short_token)
    : `${ENV.FRONTEND_URL}/s/${encodeURIComponent(link.token)}`;
}
function resultObject(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Sharing returned an invalid response.');
  return data as Record<string, unknown>;
}
function requireSuccess(data: unknown): Record<string, unknown> {
  const result = resultObject(data);
  if (result.success !== true)
    throw new Error(typeof result.error === 'string' ? result.error : 'Sharing failed. Try again.');
  return result;
}

/** Host-owned manager slot of the canonical media share body. All grants use the public owner-gated RPC family. */
export function ScreenshotShareLinks({
  fileId,
  open,
  onOpenChange,
}: { fileId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const { data, error: readError } = await getSupabase().rpc('list_share_links', {
        p_resource_type: 'file',
        p_resource_id: fileId,
      });
      if (readError) throw readError;
      if (!Array.isArray(data)) throw new Error('Could not load share links.');
      const parsed = data.map((row: unknown) => {
        const link = resultObject(row);
        if (
          typeof link.id !== 'string' ||
          typeof link.token !== 'string' ||
          typeof link.is_active !== 'boolean'
        )
          throw new Error('Could not load share links.');
        return link as unknown as ShareLink;
      });
      if (current === generation.current) setLinks(parsed);
    } catch (err) {
      if (current === generation.current) {
        setLoadFailed(true);
        setError(err instanceof Error ? err.message : 'Could not load share links.');
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [fileId]);
  useEffect(() => {
    if (open) void reload();
    return () => {
      generation.current++;
    };
  }, [open, reload]);
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied');
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  };
  const mutate = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sharing failed. Try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const create = () =>
    mutate(async () => {
      const date = expiry ? new Date(expiry) : null;
      if (date && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()))
        throw new Error('Choose a future expiration.');
      const uses = maxUses ? Number(maxUses) : null;
      if (uses !== null && (!Number.isSafeInteger(uses) || uses < 1))
        throw new Error('Enter a positive whole number of views.');
      const organizationId = await requireActiveOrganizationId();
      const { data, error: writeError } = await getSupabase()
        .rpc('create_share_link', {
          p_resource_type: 'file',
          p_resource_id: fileId,
          p_permission_level: 'viewer',
          p_expires_at: date?.toISOString() ?? null,
          p_max_uses: uses,
          p_label: label.trim() || null,
        })
        .setHeader('X-Organization-Id', organizationId);
      if (writeError) throw writeError;
      const result = requireSuccess(data);
      if (typeof result.token !== 'string') throw new Error('Sharing returned no link.');
      const url = linkUrl({
        token: result.token,
        short_token: typeof result.short_token === 'string' ? result.short_token : null,
      });
      setCreatedUrl(url);
      setNotice('Public link created');
    });
  const revoke = (id: string) =>
    mutate(async () => {
      const organizationId = await requireActiveOrganizationId();
      const { data, error: writeError } = await getSupabase()
        .rpc('revoke_share_link', { p_link_id: id })
        .setHeader('X-Organization-Id', organizationId);
      if (writeError) throw writeError;
      requireSuccess(data);
      setCreatedUrl(null);
      setNotice('Link revoked');
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-24px)] flex-col overflow-y-auto p-4">
        <DialogHeader>
          <DialogTitle>Share screenshot</DialogTitle>
          <DialogDescription>Anyone with a public link can view this image.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Label>
            Label
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional"
              disabled={busy}
            />
          </Label>
          <Label>
            Expiration
            <Input
              type="datetime-local"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              disabled={busy}
            />
          </Label>
          <Label>
            Maximum views
            <Input
              type="number"
              min={1}
              step={1}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
              placeholder="Unlimited"
              disabled={busy}
            />
          </Label>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Create public link'}
          </Button>
        </form>
        {createdUrl && (
          <div className="flex gap-2">
            <Input
              aria-label="New public link"
              readOnly
              value={createdUrl}
              onFocus={(event) => event.target.select()}
            />
            <Button variant="secondary" onClick={() => void copy(createdUrl)}>
              Copy
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-xs">
            {notice}
          </p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Existing links</span>
          <Button variant="ghost" disabled={loading || busy} onClick={() => void reload()}>
            Refresh
          </Button>
        </div>
        {loading ? (
          <p role="status">Loading links…</p>
        ) : links.length === 0 && !loadFailed ? (
          <p className="text-xs text-muted-foreground">No share links</p>
        ) : (
          links.map((link) => (
            <div key={link.id} className="space-y-2 rounded border border-border p-2 text-xs">
              <div>
                {link.label ?? 'Public link'} · {link.is_active ? 'Active' : 'Revoked'}
              </div>
              <div className="text-muted-foreground">
                {link.expires_at ? new Date(link.expires_at).toLocaleString() : 'Never expires'} ·{' '}
                {link.use_count ?? 0}
                {link.max_uses ? ` / ${link.max_uses}` : ''} views
              </div>
              <Input
                aria-label="Public share link"
                readOnly
                value={linkUrl(link)}
                onFocus={(event) => event.target.select()}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copy(linkUrl(link))}>
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !link.is_active}
                  onClick={() => void revoke(link.id)}
                >
                  Revoke
                </Button>
              </div>
            </div>
          ))
        )}
      </DialogContent>
    </Dialog>
  );
}
