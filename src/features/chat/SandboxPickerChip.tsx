/**
 * Chat-header chip that lets the user bind a sandbox or their own PC to
 * the current chat session. The selection is persisted in
 * `useChatStore.boundComputeTarget` and shipped on every chat send via
 * the existing `sandbox: {...}` request field (resolved server-side by
 * `POST /api/compute-targets/resolve`).
 *
 * Two sections inside the popover:
 *   - **Your computers** — `app_instances` rows for local PCs registered
 *     by matrx-local, with online/offline status from the Cloudflare
 *     tunnel heartbeat (server-side freshness window: 10 minutes).
 *   - **Sandboxes** — `sandbox_instances` rows, running/ready first.
 *
 * Mirrors the matrx-frontend `SandboxPanel` UX with extension-friendly
 * sizing. Empty / loading / error states are first-class.
 */

import { Check, Cpu, Loader2, Monitor, Plus, RefreshCw, Server, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useComputeTargets } from '@/lib/compute/use-compute-targets';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/state/chat';
import type { ComputeTarget } from '@/types/compute-target';

interface SandboxPickerChipProps {
  disabled?: boolean;
}

/**
 * Open the matrx-frontend create-sandbox surface in a new tab. The
 * extension does not host a creation flow itself — same path the web
 * SandboxPanel uses when "New sandbox" is clicked at the user's tier limit.
 */
function openNewSandboxFlow(): void {
  void chrome.tabs.create({
    url: 'https://aimatrx.com/sandboxes/new',
  });
}

/**
 * Open the matrx-local install page so the user can register their PC.
 */
function openInstallLocalFlow(): void {
  void chrome.tabs.create({
    url: 'https://aimatrx.com/matrx-local',
  });
}

export function SandboxPickerChip({ disabled = false }: SandboxPickerChipProps) {
  const boundTarget = useChatStore((s) => s.boundComputeTarget);
  const setBoundTarget = useChatStore((s) => s.setBoundComputeTarget);

  // Lazy fetch: only hit the network when the popover is opened. The chip's
  // trigger renders from the persisted `boundTarget` shape, so the closed
  // state is instant.
  const fetchEnabled = !disabled;
  const { data, loading, error, refetch } = useComputeTargets(fetchEnabled);

  const sandboxes = (data?.targets ?? []).filter((t) => t.kind === 'ec2' || t.kind === 'hosted');
  const computers = (data?.targets ?? []).filter((t) => t.kind === 'local-pc');

  const atSandboxLimit = data ? data.sandbox_count >= data.max_sandboxes : false;

  const TriggerIcon = boundTarget ? (boundTarget.kind === 'local-pc' ? Monitor : Server) : Cpu;

  const triggerLabel = boundTarget?.name ?? 'Compute';
  const tooltip = boundTarget
    ? `Bound to ${boundTarget.kind === 'local-pc' ? 'your computer' : 'a sandbox'}: ${boundTarget.name}`
    : 'Pick a sandbox or your own computer';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={tooltip}
          className={cn(
            'h-7 gap-1.5 px-2 text-[11px] font-medium hover:bg-accent',
            boundTarget ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
          )}
        >
          <TriggerIcon className="size-3.5" />
          <span className="hidden max-w-[120px] truncate sm:inline">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <div className="text-xs font-semibold text-foreground">Agent compute target</div>
            <div className="text-[10px] text-muted-foreground">
              Where shell &amp; file tools run for this chat.
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            title="Refresh"
            onClick={() => void refetch()}
            disabled={loading}
          >
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
          </Button>
        </div>

        {boundTarget && (
          <div className="border-b bg-accent/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[11px] font-semibold">{boundTarget.name}</div>
                <div className="text-[10px] text-muted-foreground">Currently bound</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[10px] text-destructive hover:bg-destructive/10"
                onClick={() => setBoundTarget(null)}
              >
                <X className="size-3" />
                Detach
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="border-b px-3 py-2 text-[11px] text-destructive">
            Could not load targets: {error}
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </div>
        )}

        {data && (
          <div className="max-h-72 overflow-y-auto">
            {/* Your computers section */}
            <SectionHeader>Your computers</SectionHeader>
            {computers.length === 0 && (
              <EmptyHint>
                No matrx-local devices online. Install matrx-local on your computer to bind it.
                <button
                  type="button"
                  onClick={openInstallLocalFlow}
                  className="ml-1 underline hover:no-underline"
                >
                  Install
                </button>
              </EmptyHint>
            )}
            {computers.map((target) => (
              <TargetRow
                key={target.id}
                target={target}
                bound={boundTarget?.kind === target.kind && boundTarget.id === target.id}
                onSelect={() =>
                  setBoundTarget({
                    kind: target.kind,
                    id: target.id,
                    name: target.name,
                  })
                }
              />
            ))}

            {/* Sandboxes section */}
            <SectionHeader>Sandboxes</SectionHeader>
            {sandboxes.length === 0 && (
              <EmptyHint>No sandboxes yet. Your plan allows {data.max_sandboxes}.</EmptyHint>
            )}
            {sandboxes.map((target) => (
              <TargetRow
                key={target.id}
                target={target}
                bound={boundTarget?.kind === target.kind && boundTarget.id === target.id}
                onSelect={() =>
                  setBoundTarget({
                    kind: target.kind,
                    id: target.id,
                    name: target.name,
                  })
                }
              />
            ))}

            <div className="border-t bg-muted/30 px-2 py-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start gap-1.5 px-2 text-[11px] text-muted-foreground"
                onClick={openNewSandboxFlow}
                title={
                  atSandboxLimit
                    ? `At plan limit (${data.max_sandboxes}). Upgrade to add more.`
                    : 'Open the create-sandbox flow on aimatrx.com'
                }
              >
                <Plus className="size-3" />
                {atSandboxLimit
                  ? `Upgrade (${data.sandbox_count}/${data.max_sandboxes} used)`
                  : 'New sandbox'}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-2 text-[10px] text-muted-foreground">{children}</div>;
}

function TargetRow({
  target,
  bound,
  onSelect,
}: {
  target: ComputeTarget;
  bound: boolean;
  onSelect: () => void;
}) {
  const Icon = target.kind === 'local-pc' ? Monitor : Server;
  const dotClass = target.is_online ? 'bg-emerald-500' : 'bg-muted-foreground/40';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-accent',
        bound && 'bg-accent/60',
      )}
      // Allow selection of offline / stopped targets — the picker doesn't
      // know whether the user is about to wake/start them. The server
      // surfaces the actual readiness at chat-send time.
    >
      <span
        className={cn('inline-block size-1.5 shrink-0 rounded-full', dotClass)}
        title={target.is_online ? 'Online' : 'Offline'}
      />
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{target.name}</span>
      <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">
        {target.status}
      </span>
      {bound && <Check className="size-3 shrink-0 text-emerald-600" />}
    </button>
  );
}
