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
 *   - Heavy management (sharing, transfer, ownership, field editing, rotation)
 *     is deliberately NOT rebuilt here — it links out to the web vault.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ENV } from '@/config/env';
import { useActiveTab } from '@/hooks/use-active-tab';
import { useAuth } from '@/hooks/use-auth';
import type { VaultFieldSummary, VaultItemSummary } from '@/lib/api/routes/vault';
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
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Vault as VaultIcon,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
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
              />
            ))}
          </ul>
        )}

        <p className="px-3 pb-4 text-[11px] leading-relaxed text-muted-foreground">
          Sharing, transfer, ownership, and field editing live in the full vault on the web.
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
  onPatch: (patch: {
    login_urls?: string[];
    browser_fill_enabled?: boolean;
    uri_match_mode?: UriMatchMode;
  }) => Promise<string | null>;
}

function ItemRow({ item, pageUrl, onPatch }: ItemRowProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = asUriMatchMode(item.uri_match_mode);
  const host = primaryHost(item.login_urls);
  const normalizedPage = normalizeLoginUrl(pageUrl);
  const alreadyCovers = coversPage(item.login_urls, mode, pageUrl);
  const canAddPage =
    item.capabilities.can_edit &&
    normalizedPage !== null &&
    isFillablePageUrl(pageUrl) &&
    !alreadyCovers;

  const run = useCallback(
    async (patch: Parameters<ItemRowProps['onPatch']>[0]) => {
      setBusy(true);
      setError(await onPatch(patch));
      setBusy(false);
    },
    [onPatch],
  );

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
                  />
                ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
            <span className="text-[11px]">Browser fill</span>
            <Switch
              checked={item.browser_fill_enabled}
              disabled={busy || !item.capabilities.can_edit}
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

          {error && <p className="text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}

          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() =>
              void chrome.tabs.create({
                url: `${WEB_VAULT_URL}?item=${encodeURIComponent(item.id)}`,
              })
            }
          >
            <ExternalLink className="size-3" /> Manage in the web vault
          </button>
        </div>
      )}
    </li>
  );
}

// ── One field, masked until explicitly revealed ─────────────────────────────

function FieldRow({
  itemId,
  field,
  canReveal,
}: {
  itemId: string;
  field: VaultFieldSummary;
  canReveal: boolean;
}) {
  const secret = useTransientSecret();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sealed = field.handling === 'sealed';
  const revealable = canReveal && !sealed;

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

  return (
    <li className="rounded-md bg-muted/40 px-2 py-1">
      <div className="flex items-center gap-1.5">
        <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">
          {field.field_key}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
          {secret.value ?? field.value_hint ?? '••••••'}
        </span>
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
              {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            </IconButton>
          </>
        )}
      </div>
      {sealed && (
        <p className="text-[10px] text-muted-foreground">
          Sealed — this value can never be shown, only used.
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
