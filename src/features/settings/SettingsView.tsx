/**
 * Settings — user-facing preferences ONLY.
 *
 * Apple iOS-style: each feature gets its own collapsible section + a grouped
 * card of single-row controls. No descriptive paragraphs, no nested cards.
 *
 * Operationally sensitive controls (backend env, URL overrides) live in the
 * admin-gated Debug tab. A regular user MUST NOT be able to repoint the
 * extension at staging / dev / localhost from here.
 */

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Collapsible } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AdvancedAgentCapabilities } from '@/features/settings/AdvancedAgentCapabilities';
import { useAuth } from '@/hooks/use-auth';
import { useDesktopBridge } from '@/hooks/use-desktop';
import {
  getEnginePortOverride,
  invalidateEnginePortCache,
  setEnginePortOverride,
} from '@/lib/desktop/discovery';
import { clearPairToken, setPairToken } from '@/lib/desktop/http';
import {
  desktopStatusTextClass,
  engineHealthState,
  formatDesktopConnectionLabel,
} from '@/lib/desktop/types';
import { type AgxAgent, fetchUserAgents } from '@/lib/supabase/queries';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/state/settings';
import { ChevronRight, LogIn, LogOut, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

const NONE = '__none__';

export function SettingsView() {
  const { user, signIn, signOut, isAdmin } = useAuth();
  const desktop = useDesktopBridge();
  const settings = useSettingsStore();
  const [pairTokenInput, setPairTokenInput] = useState('');
  const [agents, setAgents] = useState<AgxAgent[]>([]);
  const [enginePortInput, setEnginePortInput] = useState('');
  const [enginePortSaved, setEnginePortSaved] = useState<number | null>(null);
  const [enginePortError, setEnginePortError] = useState<string | null>(null);
  const [clearLocalDataOpen, setClearLocalDataOpen] = useState(false);

  useEffect(() => {
    // Both signed-in users and guests get the agent list: builtin agents
    // are readable by anon, owned + shared agents need a JWT.
    let cancelled = false;
    void (async () => {
      const a = await fetchUserAgents(user?.id);
      if (!cancelled) setAgents(a);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await getEnginePortOverride();
      if (cancelled) return;
      setEnginePortSaved(p);
      setEnginePortInput(p === null ? '' : String(p));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveEnginePort = async () => {
    const trimmed = enginePortInput.trim();
    if (trimmed === '') {
      await setEnginePortOverride(null);
      await invalidateEnginePortCache();
      setEnginePortSaved(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      // Silent return left the input showing a value that was never applied.
      setEnginePortError('Port must be 1–65535.');
      return;
    }
    setEnginePortError(null);
    await setEnginePortOverride(n);
    await invalidateEnginePortCache();
    setEnginePortSaved(n);
  };

  const handleClearLocalDataConfirmed = async () => {
    setClearLocalDataOpen(false);
    await chrome.storage.local.clear();
    await chrome.storage.session.clear().catch(() => undefined);
    await signOut();
  };

  const desktopColor = desktopStatusTextClass(desktop.transport, desktop.health);
  const engineHealth = engineHealthState(desktop.health);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3 px-3 pb-3">
          <Collapsible label="Account">
            <Card>
              <Row label="Email" value={user?.email ?? '—'} mono />
              {user?.full_name && <Row label="Name" value={user.full_name} />}
              {isAdmin && <Row label="Role" value={<Badge>admin</Badge>} />}
            </Card>
          </Collapsible>

          <Collapsible label="Appearance">
            <Card>
              <ControlRow
                label="Theme"
                control={
                  <PillSelect
                    value={settings.theme}
                    onChange={(v) => settings.setTheme(v as typeof settings.theme)}
                    options={[
                      { value: 'system', label: 'System' },
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                }
              />
            </Card>
          </Collapsible>

          <Collapsible label="Chat">
            <Card>
              <ControlRow
                label="Default agent"
                control={
                  <PillSelect
                    value={settings.defaultAgentId ?? NONE}
                    onChange={(v) => settings.setDefaultAgentId(v === NONE ? null : v)}
                    placeholder="None"
                    options={[
                      { value: NONE, label: 'None' },
                      ...agents.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                  />
                }
              />
              <ControlRow
                label="Default mode"
                control={
                  <PillSelect
                    value={settings.defaultPermissionMode}
                    onChange={(v) =>
                      settings.setDefaultPermissionMode(v as typeof settings.defaultPermissionMode)
                    }
                    options={[
                      { value: 'ask', label: 'Ask before acting' },
                      { value: 'act', label: 'Act without asking' },
                    ]}
                  />
                }
              />
              <ControlRow
                label="Default speed"
                hint="coming soon"
                control={
                  <PillSelect
                    value={settings.defaultChatSpeed}
                    onChange={(v) =>
                      settings.setDefaultChatSpeed(v as typeof settings.defaultChatSpeed)
                    }
                    options={[
                      { value: 'fast', label: 'Fast' },
                      { value: 'thinking', label: 'Thinking' },
                    ]}
                  />
                }
              />
            </Card>
          </Collapsible>

          <Collapsible label="Privacy">
            <Card>
              <ControlRow
                label="Share page identity & email content"
                hint="lets the agent see your visible username on sites and Gmail subjects/excerpts"
                control={
                  <Switch
                    checked={settings.sharePageIdentity}
                    onCheckedChange={settings.setSharePageIdentity}
                  />
                }
              />
            </Card>
          </Collapsible>

          <Collapsible label="Scrape">
            <Card>
              <ControlRow
                label="Deep clean"
                hint="coming soon"
                control={
                  <Switch
                    checked={settings.scrapeDeepClean}
                    onCheckedChange={settings.setScrapeDeepClean}
                  />
                }
              />
              <ControlRow
                label="Auto-scrape on load"
                hint="capture page content in the background after each load"
                control={
                  <Switch
                    checked={settings.scrapeAutoOnLoad}
                    onCheckedChange={settings.setScrapeAutoOnLoad}
                  />
                }
              />
              <ControlRow
                label="Auto-scrape mode"
                hint="Scroll & capture loads lazy content first (slower)"
                control={
                  <PillSelect
                    value={settings.scrapeAutoMode}
                    onChange={(v) =>
                      settings.setScrapeAutoMode(v as typeof settings.scrapeAutoMode)
                    }
                    options={[
                      { value: 'capture', label: 'Capture' },
                      { value: 'scroll-capture', label: 'Scroll & capture' },
                    ]}
                  />
                }
              />
            </Card>
          </Collapsible>

          <Collapsible label="Data" defaultOpen={false}>
            <EmptyCard>No options yet</EmptyCard>
          </Collapsible>

          <Collapsible label="SEO" defaultOpen={false}>
            <EmptyCard>No options yet</EmptyCard>
          </Collapsible>

          <Collapsible label="Desktop bridge">
            <Card>
              <Row
                label="Status"
                value={
                  <span className={desktopColor}>
                    {formatDesktopConnectionLabel(desktop.transport, desktop.health)}
                  </span>
                }
              />
              {desktop.transport !== 'none' && engineHealth !== 'ok' && (
                <Row
                  label="Engine health"
                  value={
                    <span className={desktopColor}>
                      {engineHealth === 'degraded' ? 'Degraded' : 'Failed services'}
                    </span>
                  }
                />
              )}
              {desktop.health?.degraded?.length ? (
                <Row label="Degraded" value={desktop.health.degraded.join(', ')} mono />
              ) : null}
              {desktop.health?.failed?.length ? (
                <Row label="Failed" value={desktop.health.failed.join(', ')} mono />
              ) : null}
              {desktop.health?.version && (
                <Row label="Version" value={`matrx-local v${desktop.health.version}`} mono />
              )}
              {desktop.transport !== 'native' && (
                <p className="px-3.5 pt-2 text-xs text-muted-foreground">
                  Pairing is automatic when the Matrx desktop app runs on this computer. The code
                  below is only needed to pair with a desktop app on another machine — copy it from
                  that app&apos;s Settings → Bridge Test → Extension pairing.
                </p>
              )}
              {desktop.transport !== 'native' && (
                <div className="flex items-center gap-2 px-3.5 py-2">
                  <Input
                    value={pairTokenInput}
                    onChange={(e) => setPairTokenInput(e.target.value)}
                    placeholder="Pair code"
                    className="h-7 rounded-full border-0 bg-secondary focus-visible:ring-1"
                  />
                  <Button
                    size="sm"
                    className="h-7 rounded-full px-3"
                    disabled={!pairTokenInput.trim()}
                    onClick={async () => {
                      if (pairTokenInput.trim()) {
                        await setPairToken(pairTokenInput.trim());
                        setPairTokenInput('');
                      }
                    }}
                  >
                    Pair
                  </Button>
                </div>
              )}
              {desktop.transport === 'http' && (
                <ActionRow label="Forget pair code" onClick={() => void clearPairToken()} />
              )}
              <div className="flex items-center gap-2 px-3.5 py-2">
                <span className="shrink-0 text-sm">Local engine port</span>
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={enginePortInput}
                  onChange={(e) => setEnginePortInput(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="auto"
                  className="h-7 w-20 rounded-full border-0 bg-secondary text-right focus-visible:ring-1"
                />
                <Button
                  size="sm"
                  className="h-7 rounded-full px-3"
                  onClick={() => void handleSaveEnginePort()}
                >
                  {enginePortSaved === null ? 'Set' : 'Save'}
                </Button>
                {enginePortSaved !== null && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    override
                  </span>
                )}
              </div>
              {enginePortError && (
                <div className="px-3.5 pb-2 text-[11px] text-red-600 dark:text-red-400">
                  {enginePortError}
                </div>
              )}
            </Card>
          </Collapsible>

          {isAdmin && (
            <Collapsible label="Advanced agent capabilities" defaultOpen={false}>
              <AdvancedAgentCapabilities />
            </Collapsible>
          )}

          <Collapsible label="Data & reset">
            <Card>
              <ActionRow
                label="Clear local data on this device"
                icon={<Trash2 className="size-3.5" />}
                destructive
                onClick={() => setClearLocalDataOpen(true)}
              />
            </Card>
          </Collapsible>

          <ConfirmDialog
            open={clearLocalDataOpen}
            title="Clear local data?"
            description={
              'Clear all locally cached extension data on this device?\n\nYou will be signed out. Your chats, captures and patterns saved on the server are NOT affected.'
            }
            confirmLabel="Clear & sign out"
            destructive
            onConfirm={() => void handleClearLocalDataConfirmed()}
            onClose={() => setClearLocalDataOpen(false)}
          />

          <Collapsible label="About" defaultOpen={false}>
            <Card>
              <Row label="Version" value={chrome.runtime.getManifest().version} mono />
              <Row label="Extension ID" value={chrome.runtime.id} mono />
            </Card>
          </Collapsible>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1">
        {user ? (
          <Button
            variant="ghost"
            onClick={signOut}
            className="w-full rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-3.5" /> Sign out
          </Button>
        ) : (
          <Button onClick={() => void signIn()} className="w-full rounded-full">
            <LogIn className="size-3.5" /> Sign in
          </Button>
        )}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="divide-y divide-border/60">{children}</div>
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 px-3.5 py-3 text-xs italic text-muted-foreground/70">
      {children}
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
    <div className="flex min-h-9 items-center justify-between gap-3 px-3.5 py-2">
      <span className="shrink-0 text-sm">{label}</span>
      <div
        className={cn(
          'min-w-0 truncate text-right text-sm text-muted-foreground',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ControlRow({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-3.5 py-1.5">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm">{label}</span>
        {hint && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {hint}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center">{control}</div>
    </div>
  );
}

function ActionRow({
  label,
  icon,
  destructive = false,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-accent/40',
        destructive && 'text-destructive',
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-3.5 opacity-40" />
    </button>
  );
}

function PillSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto max-w-[180px] gap-1 border-0 bg-transparent px-2 text-sm shadow-none hover:bg-accent focus:ring-0 [&>span]:truncate">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
      {children}
    </span>
  );
}
