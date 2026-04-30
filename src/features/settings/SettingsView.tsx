/**
 * Settings — user-facing preferences ONLY.
 *
 * Apple iOS-style: each feature gets its own section header + a grouped card
 * of single-row controls. No descriptive paragraphs, no nested cards.
 *
 * Operationally sensitive controls (backend env, URL overrides) live in the
 * admin-gated Debug tab. A regular user MUST NOT be able to repoint the
 * extension at staging / dev / localhost from here.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { useDesktopBridge } from '@/hooks/use-desktop';
import { clearPairToken, setPairToken } from '@/lib/desktop/http';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/state/settings';
import { ChevronRight, LogOut, Trash2 } from 'lucide-react';
import { useState } from 'react';

export function SettingsView() {
  const { user, signOut, isAdmin } = useAuth();
  const desktop = useDesktopBridge();
  const settings = useSettingsStore();
  const [pairTokenInput, setPairTokenInput] = useState('');

  const handleClearLocalData = async () => {
    if (
      !window.confirm(
        'Clear all locally cached extension data on this device?\n\nYou will be signed out. Your chats, captures and patterns saved on the server are NOT affected.',
      )
    ) {
      return;
    }
    await chrome.storage.local.clear();
    await chrome.storage.session.clear().catch(() => undefined);
    await signOut();
  };

  const desktopColor =
    desktop.transport === 'native'
      ? 'text-emerald-600 dark:text-emerald-400'
      : desktop.transport === 'http'
        ? 'text-sky-600 dark:text-sky-400'
        : 'text-muted-foreground';

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 px-3 pb-3">
          <Section label="Account">
            <Row label="Email" value={user?.email ?? '—'} mono />
            {user?.full_name && <Row label="Name" value={user.full_name} />}
            {isAdmin && <Row label="Role" value={<Badge>admin</Badge>} />}
          </Section>

          <Section label="Appearance">
            <ControlRow
              label="Theme"
              control={
                <Select
                  value={settings.theme}
                  onValueChange={(v) => settings.setTheme(v as typeof settings.theme)}
                >
                  <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-sm shadow-none hover:bg-accent focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </Section>

          <Section label="Chat">
            <EmptyRow>No options yet</EmptyRow>
          </Section>

          <Section label="Tasks">
            <EmptyRow>No options yet</EmptyRow>
          </Section>

          <Section label="Scrape">
            <ControlRow
              label="Deep clean"
              control={
                <Switch
                  checked={settings.scrapeDeepClean}
                  onCheckedChange={settings.setScrapeDeepClean}
                />
              }
            />
          </Section>

          <Section label="Data">
            <EmptyRow>No options yet</EmptyRow>
          </Section>

          <Section label="SEO">
            <EmptyRow>No options yet</EmptyRow>
          </Section>

          <Section label="Desktop bridge">
            <Row
              label="Status"
              value={
                <span className={desktopColor}>
                  {desktop.transport === 'none' ? 'Not connected' : desktop.transport}
                </span>
              }
            />
            {desktop.health?.version && (
              <Row label="Version" value={`matrx-local v${desktop.health.version}`} mono />
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
          </Section>

          <Section label="Privacy">
            <ActionRow
              label="Clear local data on this device"
              icon={<Trash2 className="size-3.5" />}
              destructive
              onClick={() => void handleClearLocalData()}
            />
          </Section>

          <Section label="About">
            <Row
              label="Version"
              value={chrome.runtime.getManifest().version}
              mono
            />
            <Row label="Extension ID" value={chrome.runtime.id} mono />
          </Section>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1">
        <Button
          variant="ghost"
          onClick={signOut}
          className="w-full rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="size-3.5" /> Sign out
        </Button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="divide-y divide-border/60">{children}</div>
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
    <div className="flex min-h-9 items-center justify-between gap-3 px-3.5 py-2">
      <span className="shrink-0 text-sm">{label}</span>
      <div className={cn('min-w-0 truncate text-right text-sm text-muted-foreground', mono && 'font-mono text-xs')}>
        {value}
      </div>
    </div>
  );
}

function ControlRow({ label, control }: { label: string; control: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-3.5 py-1.5">
      <span className="shrink-0 text-sm">{label}</span>
      <div className="flex items-center">{control}</div>
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

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-2.5 text-xs italic text-muted-foreground/70">{children}</div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
      {children}
    </span>
  );
}
