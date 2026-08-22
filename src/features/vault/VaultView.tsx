/**
 * Vault — the extension's password-manager surface.
 *
 * The everyday path is the top section: you are standing on a login page, you
 * open the panel, and the logins the SERVER says may fill this page are right
 * there with a "Use here" button. Everything else (search, Mine / Shared,
 * per-item settings, create-from-this-page) sits below it.
 *
 * Security contract for this file:
 *   - Only masked metadata is rendered by default. `value_hint` is a
 *     server-built mask, never a value.
 *   - A value appears ONLY after an explicit reveal click, comes from
 *     `POST /items/{id}/reveal` (audited server-side), lives in
 *     `useTransientSecret` (auto-clears ~30s, dropped on unmount), and is
 *     never written to storage, a store, a log, or model context.
 *   - "Use here" runs the SAME `credential_login` handler the agent runs, so
 *     the human button cannot fill anywhere the agent could not.
 *   - Everyday management lives here: rename, login URLs / match rule / notes,
 *     change or add or remove a field value, delete the login. A typed value
 *     is plaintext travelling OUT once from component-local state (dropped
 *     the moment the request resolves) — the same rule as create.
 *   - Sharing, transfer, ownership, and file attachments are deliberately NOT
 *     rebuilt here — they link out to the web vault.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ENV } from '@/config/env';
import { useActiveTab } from '@/hooks/use-active-tab';
import { useAuth } from '@/hooks/use-auth';
import type {
  VaultFieldInput,
  VaultFieldSummary,
  VaultItemMetadataPatch,
  VaultItemSummary,
} from '@/lib/api/routes/vault';
import { WEBSITE_LOGIN_DEFINITION_KEY } from '@/lib/api/routes/vault';
import { copyToClipboard } from '@/lib/clipboard/copy';
import {
  type UriMatchMode,
  asUriMatchMode,
  coversPage,
  isFillablePageUrl,
  loginUrlLabel,
  normalizeLoginUrl,
  primaryHost,
  safeParseUrl,
  withPageAdded,
} from '@/lib/credentials/login-urls';
import { useTransientSecret } from '@/lib/credentials/transient-secret';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  LogIn,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Vault as VaultIcon,
  X,
} from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { useCredentialLogin, useVault } from './useVault';

const WEB_VAULT_URL = `${ENV.FRONTEND_URL}/vault`;

type Scope = 'mine' | 'shared';

export function VaultView() {
  const tab = useActiveTab();
  const pageUrl = tab.url;
  const vault = useVault(pageUrl);
  const login = useCredentialLogin();
  const [scope, setScope] = useState<Scope>('mine');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const host = useMemo(() => safeParseUrl(pageUrl)?.host ?? null, [pageUrl]);
  const fillable = isFillablePageUrl(pageUrl);

  const list = scope === 'mine' ? vault.mine : vault.shared;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
      const haystack = [item.display_name, ...item.login_urls, item.notes ?? '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [list, query]);

  if (vault.auth === 'checking') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (vault.auth === 'signed-out') return <SignInPrompt />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 px-2">
        <VaultIcon className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Vault</span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            title="Refresh"
            onClick={() => {
              void vault.reload();
            }}
          >
            <RefreshCw className={cn('size-3.5', vault.loading && 'animate-spin')} />
          </IconButton>
          <IconButton
            title="Open the full vault on the web"
            onClick={() => void chrome.tabs.create({ url: WEB_VAULT_URL })}
          >
            <ExternalLink className="size-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <SiteSection
          host={host}
          blockedReason={
            !login.supported
              ? 'Browser login is not available in this browser yet.'
              : !fillable
                ? 'Browser login only runs on https pages.'
                : null
          }
          pageUrl={pageUrl}
          matches={vault.matches}
          matchesLoading={vault.matchesLoading}
          running={login.running}
          outcome={login.outcome}
          onUseHere={(id) => void login.useHere(id)}
          onDismissOutcome={login.dismiss}
          onCreateFromPage={() => setCreating(true)}
        />

        {vault.error && (
          <div className="mx-2 mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-muted-foreground">{vault.error}</span>
          </div>
        )}

        {creating && (
          <CreateLoginForm
            pageUrl={pageUrl}
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              const error = await vault.createItem(input);
              if (!error) setCreating(false);
              return error;
            }}
          />
        )}

        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logins"
              className="h-7 pl-6 text-xs"
            />
          </div>
          {!creating && (
            <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setCreating(true)}>
              <Plus className="size-3" /> New
            </Button>
          )}
        </div>

        <div className="px-2 pb-1.5">
          <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <TabsList className="h-7 w-full">
              <TabsTrigger value="mine" className="h-6 flex-1 text-xs">
                Mine ({vault.mine.length})
              </TabsTrigger>
              <TabsTrigger value="shared" className="h-6 flex-1 text-xs">
                Shared ({vault.shared.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {vault.loading && list.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {list.length === 0
              ? scope === 'mine'
                ? 'No logins saved yet.'
                : 'Nobody has shared a login with you.'
              : 'No logins match that search.'}
          </p>
        ) : (
          <ul className="space-y-1 px-2 pb-3">
            {filtered.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                pageUrl={pageUrl}
                onPatch={(patch) => vault.patchItem(item.id, patch)}
                onChangeValue={(fieldId, value) => vault.changeFieldValue(item.id, fieldId, value)}
                onAddField={(field) => vault.addField(item.id, field)}
                onRemoveField={(fieldId) => vault.removeField(item.id, fieldId)}
                onRemove={() => vault.removeItem(item.id)}
              />
            ))}
          </ul>
        )}

        <p className="px-3 pb-4 text-[11px] leading-relaxed text-muted-foreground">
          Sharing, transfer, ownership, and file attachments live in the full vault on the web.
        </p>
      </div>
    </div>
  );
}

// ── Sign-in gate ────────────────────────────────────────────────────────────

/**
 * The extension's guest identity is a fingerprint, and the Vault rejects it by
 * design. Say that plainly instead of showing an empty list.
 */
function SignInPrompt() {
  const { signIn, status } = useAuth();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <ShieldCheck className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">Sign in to open your Vault</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Saved logins are only ever released to a signed-in Matrx account. Guest sessions cannot
        reach them.
      </p>
      <Button
        size="sm"
        className="h-7 gap-1 px-3 text-xs"
        onClick={signIn}
        disabled={status === 'signing-in'}
      >
        {status === 'signing-in' ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <LogIn className="size-3" />
        )}
        Sign in
      </Button>
    </div>
  );
}

// ── "Logins for this site" ──────────────────────────────────────────────────

interface SiteSectionProps {
  host: string | null;
  /** Null when fill is possible here; otherwise the exact reason it is not. */
  blockedReason: string | null;
  pageUrl: string | null;
  matches: { item_id: string; display_name: string }[];
  matchesLoading: boolean;
  running: string | null;
  outcome: { status: string; message: string } | null;
  onUseHere: (itemId: string) => void;
  onDismissOutcome: () => void;
  onCreateFromPage: () => void;
}

function SiteSection(props: SiteSectionProps) {
  const { host, blockedReason, matches, matchesLoading, running, outcome } = props;
  const good = outcome?.status === 'authenticated' || outcome?.status === 'needs_mfa';

  return (
    <div className="border-b bg-muted/30 px-2 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs">
        <Globe className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{host ?? 'No page open'}</span>
        {matchesLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>

      {blockedReason !== null ? (
        <p className="text-[11px] text-muted-foreground">{blockedReason}</p>
      ) : matches.length === 0 ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">No saved login fills this page.</p>
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={props.onCreateFromPage}
          >
            <Plus className="size-3" /> Save this site
          </Button>
        </div>
      ) : (
        <ul className="space-y-1">
          {matches.map((match) => (
            <li
              key={match.item_id}
              className="flex items-center gap-2 rounded-md border bg-background px-2 py-1"
            >
              <span className="min-w-0 flex-1 truncate text-xs">{match.display_name}</span>
              <Button
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={running !== null}
                onClick={() => props.onUseHere(match.item_id)}
              >
                {running === match.item_id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  'Use here'
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {outcome && (
        <div
          className={cn(
            'mt-1.5 flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px]',
            good
              ? 'border-emerald-500/40 bg-emerald-500/10'
              : 'border-amber-500/40 bg-amber-500/10',
          )}
        >
          {good ? (
            <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <span className="flex-1 text-muted-foreground">{outcome.message}</span>
          <button
            type="button"
            onClick={props.onDismissOutcome}
            className="text-muted-foreground hover:text-foreground"
            title="Dismiss"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── One saved login ─────────────────────────────────────────────────────────

interface ItemRowProps {
  item: VaultItemSummary;
  pageUrl: string | null;
  onPatch: (patch: VaultItemMetadataPatch) => Promise<string | null>;
  onChangeValue: (fieldId: string, value: string) => Promise<string | null>;
  onAddField: (field: VaultFieldInput) => Promise<string | null>;
  onRemoveField: (fieldId: string) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}

function ItemRow({
  item,
  pageUrl,
  onPatch,
  onChangeValue,
  onAddField,
  onRemoveField,
  onRemove,
}: ItemRowProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const mode = asUriMatchMode(item.uri_match_mode);
  const host = primaryHost(item.login_urls);
  const normalizedPage = normalizeLoginUrl(pageUrl);
  const alreadyCovers = coversPage(item.login_urls, mode, pageUrl);
  const canEdit = item.capabilities.can_edit;
  const canManage = item.capabilities.can_manage;
  const canAddPage =
    canEdit && normalizedPage !== null && isFillablePageUrl(pageUrl) && !alreadyCovers;

  const run = useCallback(
    async (patch: VaultItemMetadataPatch) => {
      setBusy(true);
      setError(await onPatch(patch));
      setBusy(false);
    },
    [onPatch],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    const failure = await onRemove();
    // On success this row unmounts — only touch state on failure.
    if (failure) {
      setError(failure);
      setConfirmDelete(false);
      setBusy(false);
    }
  }, [onRemove]);

  return (
    <li className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{item.display_name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {host ?? 'No site set'}
          </span>
        </span>
        {item.browser_fill_enabled ? (
          <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
            Fill on
          </Badge>
        ) : (
          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] text-muted-foreground">
            Fill off
          </Badge>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t px-2 py-2">
          {editing ? (
            <EditDetailsForm
              item={item}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={async (patch) => {
                setBusy(true);
                const failure = await onPatch(patch);
                setBusy(false);
                setError(failure);
                if (!failure) setEditing(false);
              }}
            />
          ) : (
            <>
              {item.fields.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">This item has no fields.</p>
              ) : (
                <ul className="space-y-1">
                  {item.fields
                    .filter((field) => field.is_active)
                    .map((field) => (
                      <FieldRow
                        key={field.id || field.field_key}
                        itemId={item.id}
                        field={field}
                        canReveal={item.capabilities.can_reveal}
                        canEdit={canEdit}
                        onChangeValue={(value) => onChangeValue(field.id, value)}
                        onRemove={() => onRemoveField(field.id)}
                      />
                    ))}
                </ul>
              )}

              {addingField ? (
                <AddFieldForm
                  existingKeys={item.fields.map((f) => f.field_key)}
                  onCancel={() => setAddingField(false)}
                  onAdd={async (field) => {
                    const failure = await onAddField(field);
                    if (!failure) setAddingField(false);
                    return failure;
                  }}
                />
              ) : (
                canEdit && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setAddingField(true)}
                  >
                    <Plus className="size-3" /> Add a field
                  </button>
                )
              )}

              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                <span className="text-[11px]">Browser fill</span>
                <Switch
                  checked={item.browser_fill_enabled}
                  disabled={busy || !canEdit}
                  onCheckedChange={(checked) => void run({ browser_fill_enabled: checked })}
                />
              </div>

              {item.login_urls.length > 0 && (
                <ul className="space-y-0.5">
                  {item.login_urls.map((url) => (
                    <li key={url} className="truncate text-[11px] text-muted-foreground">
                      {loginUrlLabel(url)}
                    </li>
                  ))}
                </ul>
              )}

              {item.notes && (
                <p className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                  {item.notes}
                </p>
              )}

              {canAddPage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-full gap-1 px-2 text-[11px]"
                  disabled={busy}
                  onClick={() =>
                    void run({
                      login_urls: withPageAdded(item.login_urls, pageUrl),
                      browser_fill_enabled: true,
                    })
                  }
                >
                  {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                  Use this login on {safeParseUrl(pageUrl)?.host ?? 'this page'}
                </Button>
              )}

              {alreadyCovers && (
                <p className="text-[11px] text-muted-foreground">
                  This page is already covered ({mode === 'exact' ? 'exact URL' : 'whole site'}).
                </p>
              )}
            </>
          )}

          {error && <p className="text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}

          {!editing && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {canEdit && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3" /> Edit details
                </button>
              )}
              {canManage &&
                (confirmDelete ? (
                  <span className="flex items-center gap-1 text-[11px]">
                    <span className="text-muted-foreground">Delete this login?</span>
                    <button
                      type="button"
                      className="font-medium text-destructive hover:underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      {busy ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="size-3" /> Delete
                  </button>
                ))}
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  void chrome.tabs.create({
                    url: `${WEB_VAULT_URL}?item=${encodeURIComponent(item.id)}`,
                  })
                }
              >
                <ExternalLink className="size-3" /> Share &amp; more on the web
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── Edit name / site URLs / match mode / notes ──────────────────────────────

const MATCH_MODE_LABEL: Record<UriMatchMode, string> = {
  host: 'Whole site',
  exact: 'Exact URL only',
  never: 'Never match',
};

function EditDetailsForm({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item: VaultItemSummary;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: VaultItemMetadataPatch) => Promise<void>;
}) {
  const [name, setName] = useState(item.display_name);
  const [urlsText, setUrlsText] = useState(item.login_urls.join('\n'));
  const [mode, setMode] = useState<UriMatchMode>(asUriMatchMode(item.uri_match_mode));
  const [notes, setNotes] = useState(item.notes ?? '');
  const [urlError, setUrlError] = useState<string | null>(null);
  const ids = useId();

  const submit = useCallback(async () => {
    const urls: string[] = [];
    for (const line of urlsText.split('\n')) {
      const raw = line.trim();
      if (!raw) continue;
      const normalized = normalizeLoginUrl(raw);
      // Same rule as the tool: https anywhere, http only on loopback.
      if (!normalized || !isFillablePageUrl(raw)) {
        setUrlError(`"${raw}" is not an https address, so it cannot be a login URL.`);
        return;
      }
      if (!urls.includes(normalized)) urls.push(normalized);
    }
    setUrlError(null);
    const patch: VaultItemMetadataPatch = {
      display_name: name.trim() || item.display_name,
      login_urls: urls,
      uri_match_mode: mode,
      notes,
    };
    // Fill cannot stay on with nowhere to fill.
    if (urls.length === 0 && item.browser_fill_enabled) patch.browser_fill_enabled = false;
    await onSave(patch);
  }, [item.browser_fill_enabled, item.display_name, mode, name, notes, onSave, urlsText]);

  return (
    <div className="space-y-1.5">
      <label htmlFor={`${ids}-name`} className="block text-[11px] text-muted-foreground">
        Name
        <Input
          id={`${ids}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-0.5 h-7 text-xs"
        />
      </label>
      <label htmlFor={`${ids}-urls`} className="block text-[11px] text-muted-foreground">
        Login URLs (one per line, https only)
        <Textarea
          id={`${ids}-urls`}
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          rows={2}
          className="mt-0.5 min-h-0 px-2 py-1 font-mono text-[11px]"
          placeholder="https://example.com/login"
        />
      </label>
      <label htmlFor={`${ids}-mode`} className="block text-[11px] text-muted-foreground">
        Match rule
        <select
          id={`${ids}-mode`}
          value={mode}
          onChange={(e) => setMode(asUriMatchMode(e.target.value))}
          className="mt-0.5 h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs"
        >
          {(Object.keys(MATCH_MODE_LABEL) as UriMatchMode[]).map((m) => (
            <option key={m} value={m}>
              {MATCH_MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${ids}-notes`} className="block text-[11px] text-muted-foreground">
        Notes — not encrypted. Never put a password or code here.
        <Textarea
          id={`${ids}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-0.5 min-h-0 px-2 py-1 text-[11px]"
        />
      </label>
      {urlError && <p className="text-[11px] text-amber-600 dark:text-amber-400">{urlError}</p>}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Add one encrypted field ─────────────────────────────────────────────────

const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

function AddFieldForm({
  existingKeys,
  onCancel,
  onAdd,
}: {
  existingKeys: string[];
  onCancel: () => void;
  onAdd: (field: VaultFieldInput) => Promise<string | null>;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedKey = key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const keyOk = FIELD_KEY_RE.test(normalizedKey) && !existingKeys.includes(normalizedKey);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const failure = await onAdd({ field_key: normalizedKey, value, handling: 'revealable' });
    // Drop the plaintext the moment the request resolves, whatever the outcome.
    setValue('');
    setBusy(false);
    if (failure) setError(failure);
  }, [normalizedKey, onAdd, value]);

  return (
    <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
      <Input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Field name (e.g. security_answer)"
        className="h-7 text-xs"
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Value"
        type="password"
        autoComplete="new-password"
        className="h-7 text-xs"
      />
      {key && !keyOk && (
        <p className="text-[11px] text-muted-foreground">
          {existingKeys.includes(normalizedKey)
            ? 'That field already exists on this login.'
            : 'Use letters, numbers, and underscores, starting with a letter.'}
        </p>
      )}
      {error && <p className="text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={!keyOk || value.length === 0 || busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : 'Add field'}
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── One field, masked until explicitly revealed ─────────────────────────────

function FieldRow({
  itemId,
  field,
  canReveal,
  canEdit,
  onChangeValue,
  onRemove,
}: {
  itemId: string;
  field: VaultFieldSummary;
  canReveal: boolean;
  canEdit: boolean;
  onChangeValue: (value: string) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}) {
  const secret = useTransientSecret();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const sealed = field.handling === 'sealed';
  const revealable = canReveal && !sealed;
  // Any authorized editor may replace a value, sealed included — replacing is
  // the ONLY way to change a sealed value, since it can never be shown.
  const editable = canEdit && field.id.length > 0;

  const reveal = useCallback(async () => {
    if (secret.value !== null) {
      secret.clear();
      return;
    }
    setBusy(true);
    setError(null);
    // Imported lazily so the reveal route is only pulled in when a human
    // actually asks for a value.
    const { revealVaultField, describeVaultFailure } = await import('@/lib/api/routes/vault');
    const result = await revealVaultField(itemId, field.field_key);
    setBusy(false);
    if (!result.ok) {
      setError(describeVaultFailure(result.failure));
      return;
    }
    secret.hold(result.data);
  }, [field.field_key, itemId, secret]);

  const copy = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { revealVaultField, describeVaultFailure } = await import('@/lib/api/routes/vault');
    // Reveal fresh rather than reading whatever is on screen — the value may
    // have already auto-cleared, and re-fetching keeps the audit honest.
    const result = await revealVaultField(itemId, field.field_key);
    setBusy(false);
    if (!result.ok) {
      setError(describeVaultFailure(result.failure));
      return;
    }
    const ok = await copyToClipboard(result.data);
    setCopied(ok);
    setError(ok ? null : 'Could not reach the clipboard.');
    setTimeout(() => setCopied(false), 2000);
  }, [field.field_key, itemId]);

  const saveNewValue = useCallback(async () => {
    setBusy(true);
    setError(null);
    secret.clear();
    const failure = await onChangeValue(draft);
    // Drop the plaintext the moment the request resolves, whatever the outcome.
    setDraft('');
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setChanging(false);
  }, [draft, onChangeValue, secret]);

  const remove = useCallback(async () => {
    setBusy(true);
    const failure = await onRemove();
    // On success this row unmounts — only touch state on failure.
    if (failure) {
      setError(failure);
      setConfirmRemove(false);
      setBusy(false);
    }
  }, [onRemove]);

  return (
    <li className="rounded-md bg-muted/40 px-2 py-1">
      <div className="flex items-center gap-1.5">
        <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">
          {field.field_key}
        </span>
        {changing ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New value"
            type="password"
            autoComplete="new-password"
            autoFocus
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.length > 0) void saveNewValue();
              if (e.key === 'Escape') {
                setDraft('');
                setChanging(false);
              }
            }}
            className="h-6 min-w-0 flex-1 font-mono text-[11px]"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
            {secret.value ?? field.value_hint ?? '••••••'}
          </span>
        )}
        {changing ? (
          <>
            <IconButton
              title="Save new value"
              onClick={() => void saveNewValue()}
              disabled={busy || draft.length === 0}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            </IconButton>
            <IconButton
              title="Cancel"
              onClick={() => {
                setDraft('');
                setChanging(false);
              }}
              disabled={busy}
            >
              <X className="size-3" />
            </IconButton>
          </>
        ) : (
          <>
            {revealable && (
              <>
                <IconButton
                  title={secret.value ? 'Hide' : 'Reveal'}
                  onClick={() => void reveal()}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : secret.value ? (
                    <EyeOff className="size-3" />
                  ) : (
                    <Eye className="size-3" />
                  )}
                </IconButton>
                <IconButton title="Copy" onClick={() => void copy()} disabled={busy}>
                  {copied ? (
                    <Check className="size-3 text-emerald-500" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </IconButton>
              </>
            )}
            {editable && (
              <>
                <IconButton
                  title="Change value"
                  onClick={() => {
                    setConfirmRemove(false);
                    setChanging(true);
                  }}
                  disabled={busy}
                >
                  <Pencil className="size-3" />
                </IconButton>
                <IconButton
                  title="Remove field"
                  onClick={() => setConfirmRemove((v) => !v)}
                  disabled={busy}
                >
                  <Trash2 className="size-3" />
                </IconButton>
              </>
            )}
          </>
        )}
      </div>
      {confirmRemove && (
        <p className="flex items-center gap-1 text-[10px]">
          <span className="text-muted-foreground">Remove “{field.field_key}”?</span>
          <button
            type="button"
            className="font-medium text-destructive hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? 'Removing…' : 'Yes, remove'}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => setConfirmRemove(false)}
          >
            Keep
          </button>
        </p>
      )}
      {sealed && !changing && (
        <p className="text-[10px] text-muted-foreground">
          Sealed — this value can never be shown, only used or replaced.
        </p>
      )}
      {secret.value !== null && (
        <p className="text-[10px] text-muted-foreground">Hides itself in 30 seconds.</p>
      )}
      {error && <p className="text-[10px] text-amber-600 dark:text-amber-400">{error}</p>}
    </li>
  );
}

// ── Create from the current page ────────────────────────────────────────────

function CreateLoginForm({
  pageUrl,
  onCancel,
  onCreate,
}: {
  pageUrl: string | null;
  onCancel: () => void;
  onCreate: (input: {
    display_name: string;
    fields: { field_key: string; value: string }[];
    definition_key: string;
    login_urls: string[];
    browser_fill_enabled: boolean;
  }) => Promise<string | null>;
}) {
  const host = safeParseUrl(pageUrl)?.host ?? '';
  const normalized = normalizeLoginUrl(pageUrl);
  const [name, setName] = useState(host);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fillable = isFillablePageUrl(pageUrl);
  const canSave = name.trim().length > 0 && password.length > 0 && !busy;

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const fields = [{ field_key: 'password', value: password }];
    if (username.trim()) fields.unshift({ field_key: 'username', value: username.trim() });
    const failure = await onCreate({
      display_name: name.trim(),
      fields,
      definition_key: WEBSITE_LOGIN_DEFINITION_KEY,
      login_urls: normalized && fillable ? [normalized] : [],
      browser_fill_enabled: normalized !== null && fillable,
    });
    // Drop the plaintext from this component the moment the request resolves,
    // whatever the outcome.
    setPassword('');
    setUsername('');
    setBusy(false);
    if (failure) setError(failure);
  }, [fillable, name, normalized, onCreate, password, username]);

  return (
    <div className="mx-2 mb-2 space-y-1.5 rounded-md border bg-card p-2">
      <div className="flex items-center gap-1.5">
        <Plus className="size-3 text-muted-foreground" />
        <span className="flex-1 text-xs font-medium">New login</span>
        <IconButton title="Cancel" onClick={onCancel}>
          <X className="size-3" />
        </IconButton>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {fillable && normalized
          ? `Saved for ${host} and enabled for browser fill.`
          : 'This page is not an https destination, so no site will be attached.'}
      </p>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="h-7 text-xs"
      />
      <Input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username or email"
        autoComplete="off"
        className="h-7 text-xs"
      />
      <Input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        type="password"
        autoComplete="new-password"
        className="h-7 text-xs"
      />
      {error && <p className="text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}
      <Button
        size="sm"
        className="h-7 w-full text-xs"
        disabled={!canSave}
        onClick={() => void submit()}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : 'Save to Vault'}
      </Button>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}
