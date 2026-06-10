/**
 * Admin-only Settings section: toggles for optional Chrome permissions.
 *
 * When enabled, each toggle calls `chrome.permissions.request` for that
 * permission. Once granted, the matching tool family becomes callable by the
 * agent dispatcher. Disabling removes the permission via
 * `chrome.permissions.remove`.
 *
 * Shown ONLY for admins because the underlying tools are still labelled
 * `admin_only` and filtered out of regular users' bundles.
 */

import { Switch } from '@/components/ui/switch';
import { AuditKeyCard } from '@/features/settings/AuditKeyCard';
import {
  ALL_OPTIONAL,
  OPTIONAL_PERMISSION_LABELS,
  type OptionalPermission,
  hasOptionalPermissions,
  removeOptionalPermission,
  requestOptionalPermission,
} from '@/lib/permissions/optional';
import { useEffect, useState } from 'react';

export function AdvancedAgentCapabilities() {
  const [granted, setGranted] = useState<Set<OptionalPermission>>(new Set());
  const [busy, setBusy] = useState<OptionalPermission | null>(null);

  useEffect(() => {
    void refresh();
    if (!chrome.permissions?.onAdded || !chrome.permissions?.onRemoved) return;
    const onChange = () => void refresh();
    chrome.permissions.onAdded.addListener(onChange);
    chrome.permissions.onRemoved.addListener(onChange);
    return () => {
      chrome.permissions.onAdded.removeListener(onChange);
      chrome.permissions.onRemoved.removeListener(onChange);
    };
  }, []);

  async function refresh() {
    const next = new Set<OptionalPermission>();
    for (const p of ALL_OPTIONAL) {
      if (await hasOptionalPermissions([p])) next.add(p);
    }
    setGranted(next);
  }

  async function toggle(perm: OptionalPermission, on: boolean) {
    setBusy(perm);
    try {
      const ok = on ? await requestOptionalPermission(perm) : await removeOptionalPermission(perm);
      if (ok) {
        setGranted((s) => {
          const n = new Set(s);
          if (on) n.add(perm);
          else n.delete(perm);
          return n;
        });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl border bg-card p-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Admin · advanced agent capabilities
        </div>
        <div className="text-[11px] text-muted-foreground">
          Each switch grants a Chrome permission at runtime. Tools that depend on a permission only
          become callable once the toggle is on.
        </div>
        <div className="space-y-1.5 pt-1">
          {ALL_OPTIONAL.map((p) => {
            const meta = OPTIONAL_PERMISSION_LABELS[p];
            const isOn = granted.has(p);
            return (
              <label
                key={p}
                className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-accent/40"
              >
                <Switch
                  checked={isOn}
                  onCheckedChange={(v) => void toggle(p, v)}
                  disabled={busy === p}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {meta.title}
                    <span className="font-mono text-[10px] text-muted-foreground">{p}</span>
                  </div>
                  <div className="text-[11px] leading-snug text-muted-foreground">{meta.desc}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
      <AuditKeyCard />
    </div>
  );
}
