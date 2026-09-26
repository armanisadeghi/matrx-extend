/**
 * Admin-only Settings section: runtime Chrome permissions and the required
 * DevTools Protocol capability.
 *
 * When enabled, each toggle calls `chrome.permissions.request` for that
 * permission. Once granted, the matching tool family becomes callable by the
 * agent dispatcher. Disabling removes the permission via
 * `chrome.permissions.remove`.
 *
 * Chrome forbids debugger as an optional permission, so it is shown as
 * installation-granted status rather than an interactive switch.
 */

import { AuditKeyCard } from '@/features/settings/AuditKeyCard';
import {
  OPTIONAL_PERMISSION_LABELS,
  type RuntimeOptionalPermission,
  declaredRuntimeOptionalPermissions,
  hasOptionalPermissions,
  removeOptionalPermission,
  requestOptionalPermission,
} from '@/lib/permissions/optional';
import { Switch } from '@ai-matrx/design-system';
import { useEffect, useState } from 'react';

export function AdvancedAgentCapabilities() {
  const [available, setAvailable] = useState<RuntimeOptionalPermission[]>([]);
  const [granted, setGranted] = useState<Set<RuntimeOptionalPermission>>(new Set());
  const [debuggerGranted, setDebuggerGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<RuntimeOptionalPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);

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
    try {
      const declared = declaredRuntimeOptionalPermissions();
      const next = new Set<RuntimeOptionalPermission>();
      for (const p of declared) {
        if (await hasOptionalPermissions([p])) next.add(p);
      }
      const hasDebugger = await hasOptionalPermissions(['debugger']);
      setAvailable(declared);
      setGranted(next);
      setDebuggerGranted(hasDebugger);
      setReadFailed(false);
    } catch {
      setReadFailed(true);
      setError(
        'Chrome could not read extension permissions. Check the extension in Chrome, then retry the permission check.',
      );
    }
  }

  async function toggle(perm: RuntimeOptionalPermission, on: boolean) {
    setBusy(perm);
    setError(null);
    try {
      const ok = on ? await requestOptionalPermission(perm) : await removeOptionalPermission(perm);
      if (!ok) {
        setError(
          `Chrome did not ${on ? 'grant' : 'remove'} ${OPTIONAL_PERMISSION_LABELS[perm].title}. Check this extension's permissions in Chrome, then try again.`,
        );
      }
    } catch {
      setError(
        `Chrome could not change ${OPTIONAL_PERMISSION_LABELS[perm].title}. Check this extension's permissions in Chrome, then try again.`,
      );
    } finally {
      try {
        await refresh();
      } finally {
        setBusy(null);
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl border bg-card p-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Admin · advanced agent capabilities
        </div>
        <div className="text-[11px] text-muted-foreground">
          The switches manage optional Chrome permissions. DevTools Protocol is granted with the
          extension because Chrome does not allow it to be optional.
        </div>
        <div className="rounded-md px-1 py-1.5" aria-label="DevTools Protocol permission">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            DevTools Protocol
            <span className="font-mono text-[10px] text-muted-foreground">debugger</span>
          </div>
          <div className="text-[11px] leading-snug text-muted-foreground">
            {debuggerGranted === null
              ? 'Checking Chrome permission status.'
              : debuggerGranted
                ? 'Included with this Chrome extension. Chrome cannot turn this permission off here; manage the extension in Chrome to change its access.'
                : 'Unavailable in this browser or extension build. Use a Chrome build of the extension with DevTools Protocol access.'}
          </div>
        </div>
        {error && (
          <div role="alert" className="text-xs text-destructive">
            {error}
          </div>
        )}
        {readFailed && (
          <button
            type="button"
            className="text-xs underline"
            onClick={() => {
              setError(null);
              void refresh();
            }}
          >
            Retry permission check
          </button>
        )}
        <div className="space-y-1.5 pt-1">
          {available.map((p) => {
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
                  disabled={readFailed || busy === p}
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
