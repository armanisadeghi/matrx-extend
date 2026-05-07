/**
 * Debug → Bridges subview. Renders five panels — one per bridge channel
 * plus a combined event log — so the user can manually verify all three
 * Phase-2 integration channels (aidream backend, matrx-local desktop,
 * matrx-frontend) plus WebMCP without typing console commands.
 *
 * Mounted from `DebugView`, gated by the same admin check the Debug tab
 * itself uses (`{isAdmin && <TabsContent value="debug">…</TabsContent>}`
 * in `entrypoints/sidepanel/App.tsx`). No additional auth is needed here.
 *
 * All panels reuse the existing primitives — see imports below — and
 * never re-implement transport logic. The panel is the harness; the
 * primitives are the engine.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JsonTree } from '@/components/ui/json-tree';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { pingHealth } from '@/lib/api/routes/health';
import {
  type BridgeTrafficEntry,
  setBridgeTrafficEnabled,
  startBridgeTrafficRelay,
  useBridgeTrafficStore,
} from '@/lib/debug/bridge-traffic';
import { type DebugEvent, log, useDebugStore } from '@/lib/debug/log';
import { getDesktopState, probeDesktop } from '@/lib/desktop/bridge';
import {
  getEnginePortOverride,
  invalidateEnginePortCache,
  setEnginePortOverride,
} from '@/lib/desktop/discovery';
import { rpcHttp } from '@/lib/desktop/http';
import {
  connectWs,
  disconnectWs,
  getWsState,
  getWsStateChangedAt,
  onWsMessage,
  type WsControlResult,
} from '@/lib/desktop/ws-client';
import {
  connectBroadcast,
  disconnectBroadcast,
  publishToFrontend,
} from '@/lib/frontend-bridge/broadcast';
import { ALLOWED_ORIGIN_PATTERNS } from '@/lib/origin-allowlist';
import {
  webmcp_call_page_tool,
  webmcp_check_availability,
  webmcp_list_page_tools,
} from '@/lib/tools/handlers/webmcp';
import { registerToolsOnActiveTab } from '@/lib/webmcp/register';
import { useActiveToolsStore } from '@/state/active-tools';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  Eraser,
  Pause,
  Play,
  Plug,
  PlugZap,
  Power,
  RefreshCw,
  Send,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Synthetic ToolContext for the debug runner — these tools don't post results
// back to a conversation, so the conversation/run/call IDs are placeholders.
function debugCtx(callId: string) {
  return {
    conversationId: null,
    runId: 'debug-bridges',
    callId,
    agentName: null,
    permissionMode: 'act' as const,
    assignedTabId: null,
  };
}

export function BridgesView() {
  // The cross-context relay is sidepanel-only; safe to install once on mount.
  useEffect(() => {
    startBridgeTrafficRelay();
  }, []);

  return (
    <div className="space-y-2 p-2 text-xs">
      <ChannelAPanel />
      <ChannelBPanel />
      <ChannelCPanel />
      <ChannelWebMcpPanel />
      <CombinedEventLog />
    </div>
  );
}

// ─── Panel shell ────────────────────────────────────────────────────────────

function Panel({
  title,
  subtitle,
  children,
  defaultOpen = true,
  rightSlot,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  rightSlot?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {title}
        </span>
        {subtitle && (
          <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        )}
        {rightSlot && <div className="ml-auto">{rightSlot}</div>}
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-md bg-background/40 p-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 font-mono text-[11px]">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="truncate text-foreground">{v}</span>
    </div>
  );
}

function ResultBox({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <JsonTree data={value} defaultDepth={2} />
    </div>
  );
}

// ─── Channel A — aidream backend ────────────────────────────────────────────

function ChannelAPanel() {
  const liveTools = useActiveToolsStore((s) => s.liveTools);
  const loadedByConvo = useActiveToolsStore((s) => s.loadedByConversation);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<{ ms: number; ok: boolean } | null>(null);

  const onPing = useCallback(async () => {
    setPinging(true);
    setPingResult(null);
    const t0 = Date.now();
    const r = await pingHealth('debug bridges panel');
    setPingResult({ ms: Date.now() - t0, ok: r !== null });
    setPinging(false);
  }, []);

  return (
    <Panel
      title="Channel A — AI Dream backend"
      subtitle="agent stream + capability discovery"
    >
      <Section label="Health">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onPing} disabled={pinging}>
            <PlugZap className="mr-1 size-3.5" /> Send test ping
          </Button>
          {pingResult && (
            <span
              className={cn(
                'font-mono text-[11px]',
                pingResult.ok ? 'text-emerald-500' : 'text-red-500',
              )}
            >
              {pingResult.ok ? 'OK' : 'FAIL'} · {pingResult.ms}ms
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            full stream verification: see Chat tab
          </span>
        </div>
      </Section>

      <Section label="Live tool surface (last RESOURCE_CHANGED)">
        <KV k="live_tools_count" v={String(liveTools.length)} />
        {liveTools.length > 0 && (
          <div className="mt-1 max-h-32 overflow-auto rounded bg-secondary/40 p-1.5 font-mono text-[10px]">
            {liveTools.map((t) => (
              <div key={t}>{t}</div>
            ))}
          </div>
        )}
      </Section>

      <Section label="Loaded categories per conversation">
        {Object.keys(loadedByConvo).length === 0 ? (
          <div className="text-[10px] text-muted-foreground">
            no conversations have loaded a category yet
          </div>
        ) : (
          <JsonTree data={loadedByConvo} defaultDepth={2} />
        )}
      </Section>
    </Panel>
  );
}

// ─── Channel B — matrx-local ────────────────────────────────────────────────

function ChannelBPanel() {
  return (
    <Panel
      title="Channel B — Matrx Local desktop engine"
      subtitle="HTTP + WebSocket reverse channel"
    >
      <DiscoverySection />
      <HttpRpcSection />
      <WsSection />
    </Panel>
  );
}

function DiscoverySection() {
  const [override, setOverrideState] = useState<number | null>(null);
  const [overrideDraft, setOverrideDraft] = useState('');
  const [resolved, setResolved] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    const ov = await getEnginePortOverride();
    setOverrideState(ov);
    const s = getDesktopState();
    if (s.transport === 'http' && s.health) {
      // The bridge cached the resolved port — surface it via an HTTP probe.
      // discovery.ts doesn't expose the cache value directly so we infer
      // from a quick rpcHttp health round-trip.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onRediscover = useCallback(async () => {
    setWorking(true);
    setResolved(null);
    await invalidateEnginePortCache();
    const r = await probeDesktop();
    if (r.transport !== 'none') {
      setResolved(r.transport === 'http' ? 'http transport active' : 'native transport active');
    } else {
      setResolved('engine offline');
    }
    log.info('desktop', `bridges: re-discover → ${r.transport}`);
    setWorking(false);
  }, []);

  const onSaveOverride = useCallback(async () => {
    const v = overrideDraft.trim();
    if (v === '') {
      await setEnginePortOverride(null);
      log.info('desktop', 'bridges: override cleared');
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        log.warn('desktop', `bridges: invalid port "${v}"`);
        return;
      }
      await setEnginePortOverride(n);
      log.info('desktop', `bridges: override → ${n}`);
    }
    await refresh();
  }, [overrideDraft, refresh]);

  const onClearOverride = useCallback(async () => {
    await setEnginePortOverride(null);
    setOverrideDraft('');
    log.info('desktop', 'bridges: override cleared');
    await refresh();
  }, [refresh]);

  return (
    <Section label="Discovery">
      <KV k="override" v={override === null ? '(none)' : String(override)} />
      <KV k="status" v={resolved ?? '(not yet probed this session)'} />
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button size="sm" variant="outline" onClick={onRediscover} disabled={working}>
          <RefreshCw className={cn('mr-1 size-3.5', working && 'animate-spin')} /> Re-discover
        </Button>
        <Button size="sm" variant="outline" onClick={onClearOverride}>
          Clear override
        </Button>
      </div>
      <div className="flex items-center gap-1.5 pt-1">
        <Input
          value={overrideDraft}
          onChange={(e) => setOverrideDraft(e.target.value)}
          placeholder="Port (e.g. 22141)"
          className="h-7 w-32 font-mono text-[11px]"
          inputMode="numeric"
        />
        <Button size="sm" variant="outline" onClick={onSaveOverride}>
          Save
        </Button>
      </div>
    </Section>
  );
}

function HttpRpcSection() {
  const [busy, setBusy] = useState<string | null>(null);
  const [healthResult, setHealthResult] = useState<unknown>(undefined);
  const [versionResult, setVersionResult] = useState<unknown>(undefined);
  const [capsResult, setCapsResult] = useState<unknown>(undefined);
  const [capsTools, setCapsTools] = useState<string[]>([]);
  const [toolName, setToolName] = useState('');
  const [argsText, setArgsText] = useState('{}');
  const [callResult, setCallResult] = useState<unknown>(undefined);

  const run = useCallback(
    async (label: string, command: string, setter: (v: unknown) => void) => {
      setBusy(label);
      setter(undefined);
      const r = await rpcHttp({ command });
      setter(r);
      log.info('desktop', `bridges: rpc ${command}`, r);
      setBusy(null);
      return r;
    },
    [],
  );

  const onCapabilities = useCallback(async () => {
    const r = await run('capabilities', 'capabilities', setCapsResult);
    if (r.ok && r.data && typeof r.data === 'object') {
      const list = (r.data as { tools?: Array<{ name?: string }> }).tools;
      if (Array.isArray(list)) {
        setCapsTools(list.map((t) => t.name ?? '').filter(Boolean));
      }
    }
  }, [run]);

  const onCallTool = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsText);
    } catch (err) {
      setCallResult({ ok: false, error: `invalid JSON: ${(err as Error).message}` });
      return;
    }
    if (!toolName.trim()) {
      setCallResult({ ok: false, error: 'tool name required' });
      return;
    }
    setBusy('call-tool');
    setCallResult(undefined);
    const r = await rpcHttp({
      command: 'tool',
      args: { tool_name: toolName.trim(), tool_input: parsed },
    });
    setCallResult(r);
    log.info('desktop', `bridges: call ${toolName}`, r);
    setBusy(null);
  }, [argsText, toolName]);

  return (
    <Section label="HTTP RPC">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void run('health', 'health', setHealthResult)}
          disabled={busy !== null}
        >
          Health
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void run('version', 'version', setVersionResult)}
          disabled={busy !== null}
        >
          Version
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onCapabilities()}
          disabled={busy !== null}
        >
          Capabilities
        </Button>
      </div>
      <ResultBox label="health" value={healthResult} />
      <ResultBox label="version" value={versionResult} />
      {capsResult !== undefined && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            capabilities
          </div>
          {capsTools.length > 0 && (
            <KV
              k="tool_count"
              v={`${capsTools.length} (first 5: ${capsTools.slice(0, 5).join(', ')})`}
            />
          )}
          <JsonTree data={capsResult} defaultDepth={1} />
        </div>
      )}
      <div className="space-y-1 pt-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Call tool
        </div>
        {capsTools.length > 0 ? (
          <Select value={toolName} onValueChange={setToolName}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Pick a tool" />
            </SelectTrigger>
            <SelectContent>
              {capsTools.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            placeholder="tool name (run Capabilities first)"
            className="h-7 font-mono text-[11px]"
          />
        )}
        <Textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder='{"key":"value"}'
          rows={3}
          className="font-mono text-[11px]"
        />
        <Button size="sm" variant="outline" onClick={() => void onCallTool()} disabled={busy !== null}>
          <Send className="mr-1 size-3.5" /> Send
        </Button>
        <ResultBox label="result" value={callResult} />
      </div>
    </Section>
  );
}

function WsSection() {
  const [, force] = useState(0);
  const [tail, setTail] = useState<Array<{ ts: number; payload: unknown }>>([]);
  const [lastHash, setLastHash] = useState<string | null>(null);
  const [lastPing, setLastPing] = useState<number | null>(null);
  const [lastPong, setLastPong] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<
    | { kind: 'connect' | 'disconnect' | 'reconnect'; ts: number; result: WsControlResult }
    | null
  >(null);

  useEffect(() => {
    const off = onWsMessage((payload) => {
      setTail((prev) => {
        const next = [{ ts: Date.now(), payload }, ...prev];
        if (next.length > 10) next.length = 10;
        return next;
      });
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        if (typeof p.tool_catalog_hash === 'string') {
          setLastHash(p.tool_catalog_hash);
        }
        if (p.type === 'ping') setLastPing(Date.now());
        if (p.type === 'pong') setLastPong(Date.now());
      }
    });
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const onConnect = useCallback(async () => {
    setBusy('connect');
    try {
      const r = await connectWs();
      setLastResult({ kind: 'connect', ts: Date.now(), result: r });
    } finally {
      setBusy(null);
    }
  }, []);
  const onDisconnect = useCallback(async () => {
    setBusy('disconnect');
    try {
      const r = await disconnectWs();
      setLastResult({ kind: 'disconnect', ts: Date.now(), result: r });
    } finally {
      setBusy(null);
    }
  }, []);
  const onForceReconnect = useCallback(async () => {
    setBusy('reconnect');
    try {
      await disconnectWs();
      await new Promise((r) => setTimeout(r, 100));
      const r = await connectWs();
      setLastResult({ kind: 'reconnect', ts: Date.now(), result: r });
    } finally {
      setBusy(null);
    }
  }, []);

  const state = getWsState();
  const stateColor =
    state === 'open'
      ? 'text-emerald-500'
      : state === 'closed'
        ? 'text-amber-500'
        : 'text-muted-foreground';
  const stateChangedAt = getWsStateChangedAt();
  const isBusy = busy !== null;

  return (
    <Section label="WebSocket">
      <KV
        k="state"
        v={
          <span>
            <span className={stateColor}>{state}</span>
            {stateChangedAt && (
              <span className="ml-2 text-muted-foreground">
                (since {new Date(stateChangedAt).toLocaleTimeString()})
              </span>
            )}
          </span>
        }
      />
      <KV k="last_ping" v={lastPing ? new Date(lastPing).toLocaleTimeString() : '—'} />
      <KV k="last_pong" v={lastPong ? new Date(lastPong).toLocaleTimeString() : '—'} />
      <KV k="last_tool_catalog_hash" v={lastHash ?? '—'} />
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button size="sm" variant="outline" onClick={() => void onConnect()} disabled={isBusy}>
          <Plug
            className={cn('mr-1 size-3.5', busy === 'connect' && 'animate-pulse')}
          />{' '}
          Connect
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onDisconnect()} disabled={isBusy}>
          <Power className="mr-1 size-3.5" /> Disconnect
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onForceReconnect()}
          disabled={isBusy}
        >
          <RefreshCw
            className={cn('mr-1 size-3.5', busy === 'reconnect' && 'animate-spin')}
          />{' '}
          Force reconnect
        </Button>
        {busy && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {busy}…
          </span>
        )}
      </div>
      {lastResult && (
        <div
          className={cn(
            'rounded bg-secondary/40 p-1.5 font-mono text-[11px]',
            lastResult.result.ok ? 'text-emerald-500' : 'text-red-500',
          )}
        >
          <span className="text-muted-foreground">
            {new Date(lastResult.ts).toLocaleTimeString()} · {lastResult.kind}
          </span>{' '}
          {lastResult.result.ok ? 'OK' : `FAIL${lastResult.result.stage ? ` @ ${lastResult.result.stage}` : ''}: ${lastResult.result.error ?? '(no error message)'}`}
        </div>
      )}
      <div className="space-y-1 pt-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          last 10 inbound frames
        </div>
        {tail.length === 0 ? (
          <div className="text-[10px] text-muted-foreground">no inbound frames yet</div>
        ) : (
          <div className="max-h-48 space-y-1 overflow-auto">
            {tail.map((entry) => (
              <div key={`${entry.ts}-${Math.random()}`} className="rounded bg-secondary/40 p-1.5">
                <div className="font-mono text-[10px] text-muted-foreground">
                  {new Date(entry.ts).toLocaleTimeString()}
                </div>
                <JsonTree data={entry.payload} defaultDepth={1} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

// ─── Channel C — matrx-frontend ─────────────────────────────────────────────

function ChannelCPanel() {
  const enabled = useBridgeTrafficStore((s) => s.enabled);
  const entries = useBridgeTrafficStore((s) => s.entries);
  const clearEntries = useBridgeTrafficStore((s) => s.clear);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [pubAction, setPubAction] = useState('ping');
  const [pubPayload, setPubPayload] = useState('{}');
  const [pubResult, setPubResult] = useState<unknown>(undefined);

  const inboundFrontendRpc = useMemo(
    () => entries.filter((e) => e.stream === 'frontend-rpc').slice(0, 10),
    [entries],
  );
  const inboundBroadcast = useMemo(
    () => entries.filter((e) => e.stream === 'broadcast').slice(0, 10),
    [entries],
  );

  const onConnectBroadcast = useCallback(async () => {
    setBroadcastBusy(true);
    await connectBroadcast();
    setBroadcastBusy(false);
  }, []);
  const onDisconnectBroadcast = useCallback(async () => {
    setBroadcastBusy(true);
    await disconnectBroadcast();
    setBroadcastBusy(false);
  }, []);

  const onPublish = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(pubPayload);
    } catch (err) {
      setPubResult({ ok: false, error: `invalid JSON: ${(err as Error).message}` });
      return;
    }
    if (!pubAction.trim()) {
      setPubResult({ ok: false, error: 'action required' });
      return;
    }
    setBroadcastBusy(true);
    setPubResult(undefined);
    const { requestId, promise } = await publishToFrontend(pubAction.trim(), parsed);
    log.info('frontend-bridge', `bridges: publish → ${pubAction} req=${requestId}`);
    const r = await promise;
    setPubResult(r);
    setBroadcastBusy(false);
  }, [pubAction, pubPayload]);

  return (
    <Panel
      title="Channel C — Matrx Frontend"
      subtitle="externally_connectable + Supabase Broadcast"
    >
      <Section label="Allowed origins (externally_connectable)">
        <div className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
          {ALLOWED_ORIGIN_PATTERNS.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      </Section>

      <Section label="Inbound traffic capture">
        <div className="flex items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={(v: boolean) => void setBridgeTrafficEnabled(v)}
          />
          <span className="text-[11px]">
            {enabled ? 'recording (last 50, FIFO)' : 'OFF (no production cost)'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={clearEntries}
          >
            <Eraser className="mr-1 size-3.5" /> Clear
          </Button>
        </div>
      </Section>

      <Section label="Last 10 inbound FRONTEND_RPC envelopes">
        <BridgeTrafficList entries={inboundFrontendRpc} emptyText="no inbound frontend-rpc yet" />
      </Section>

      <Section label="Broadcast">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onConnectBroadcast()}
          disabled={broadcastBusy}
        >
          <Wifi className="mr-1 size-3.5" /> Connect
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onDisconnectBroadcast()}
          disabled={broadcastBusy}
          className="ml-1"
        >
          <Power className="mr-1 size-3.5" /> Disconnect
        </Button>
        <div className="space-y-1 pt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Publish to frontend
          </div>
          <Input
            value={pubAction}
            onChange={(e) => setPubAction(e.target.value)}
            placeholder="action (e.g. ping)"
            className="h-7 font-mono text-[11px]"
          />
          <Textarea
            value={pubPayload}
            onChange={(e) => setPubPayload(e.target.value)}
            placeholder='{"key":"value"}'
            rows={3}
            className="font-mono text-[11px]"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onPublish()}
            disabled={broadcastBusy}
          >
            <Send className="mr-1 size-3.5" /> Publish
          </Button>
          <ResultBox label="response" value={pubResult} />
        </div>
        <div className="space-y-1 pt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Last 10 inbound Broadcast envelopes
          </div>
          <BridgeTrafficList entries={inboundBroadcast} emptyText="no inbound broadcast yet" />
        </div>
      </Section>
    </Panel>
  );
}

function BridgeTrafficList({
  entries,
  emptyText,
}: {
  entries: BridgeTrafficEntry[];
  emptyText: string;
}) {
  if (entries.length === 0) {
    return <div className="text-[10px] text-muted-foreground">{emptyText}</div>;
  }
  return (
    <div className="max-h-48 space-y-1 overflow-auto">
      {entries.map((e) => (
        <div key={e.id} className="rounded bg-secondary/40 p-1.5">
          <div className="flex items-baseline gap-2 font-mono text-[10px]">
            <span className="text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="font-semibold">{e.action}</span>
            <span className="text-muted-foreground">{e.requestId?.slice(0, 8) ?? ''}</span>
            <span
              className={cn(
                'ml-auto',
                e.ok === false ? 'text-red-500' : 'text-emerald-500',
              )}
            >
              {e.ok === false ? 'fail' : 'ok'}
            </span>
          </div>
          {e.payload !== undefined && (
            <div className="mt-1">
              <JsonTree data={e.payload} defaultDepth={1} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Channel WebMCP ─────────────────────────────────────────────────────────

function ChannelWebMcpPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [availability, setAvailability] = useState<unknown>(undefined);
  const [pageTools, setPageTools] = useState<unknown>(undefined);
  const [pageToolNames, setPageToolNames] = useState<string[]>([]);
  const [callName, setCallName] = useState('');
  const [callArgs, setCallArgs] = useState('{}');
  const [callResult, setCallResult] = useState<unknown>(undefined);
  const [registerResult, setRegisterResult] = useState<unknown>(undefined);

  const onCheck = useCallback(async () => {
    setBusy('check');
    setAvailability(undefined);
    const r = await webmcp_check_availability.run({}, debugCtx('webmcp-check'));
    setAvailability(r);
    setBusy(null);
  }, []);

  const onList = useCallback(async () => {
    setBusy('list');
    setPageTools(undefined);
    const r = await webmcp_list_page_tools.run({}, debugCtx('webmcp-list'));
    setPageTools(r);
    if (r && typeof r === 'object') {
      const obj = r as { tools?: Array<{ name?: string }> };
      if (Array.isArray(obj.tools)) {
        setPageToolNames(obj.tools.map((t) => t.name ?? '').filter(Boolean));
      }
    }
    setBusy(null);
  }, []);

  const onCall = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(callArgs);
    } catch (err) {
      setCallResult({ ok: false, error: `invalid JSON: ${(err as Error).message}` });
      return;
    }
    setBusy('call');
    setCallResult(undefined);
    const r = await webmcp_call_page_tool.run(
      { name: callName.trim(), arguments: parsed },
      debugCtx('webmcp-call'),
    );
    setCallResult(r);
    setBusy(null);
  }, [callArgs, callName]);

  const onRegister = useCallback(async () => {
    setBusy('register');
    setRegisterResult(undefined);
    const r = await registerToolsOnActiveTab({ isAdmin: true });
    setRegisterResult(r);
    setBusy(null);
  }, []);

  return (
    <Panel title="WebMCP" subtitle="extension ↔ active page (navigator.modelContext)">
      <Section label="Availability">
        <Button size="sm" variant="outline" onClick={() => void onCheck()} disabled={busy !== null}>
          Check availability
        </Button>
        <ResultBox label="result" value={availability} />
      </Section>
      <Section label="Page-registered tools">
        <Button size="sm" variant="outline" onClick={() => void onList()} disabled={busy !== null}>
          List page tools
        </Button>
        <ResultBox label="result" value={pageTools} />
      </Section>
      <Section label="Call page tool">
        {pageToolNames.length > 0 ? (
          <Select value={callName} onValueChange={setCallName}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Pick a tool" />
            </SelectTrigger>
            <SelectContent>
              {pageToolNames.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={callName}
            onChange={(e) => setCallName(e.target.value)}
            placeholder="tool name (List page tools first)"
            className="h-7 font-mono text-[11px]"
          />
        )}
        <Textarea
          value={callArgs}
          onChange={(e) => setCallArgs(e.target.value)}
          placeholder='{"key":"value"}'
          rows={3}
          className="mt-1 font-mono text-[11px]"
        />
        <Button
          size="sm"
          variant="outline"
          className="mt-1"
          onClick={() => void onCall()}
          disabled={busy !== null}
        >
          <Send className="mr-1 size-3.5" /> Call
        </Button>
        <ResultBox label="result" value={callResult} />
      </Section>
      <Section label="Register matrx-extend tools on active tab">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void onRegister()}
          disabled={busy !== null}
        >
          Register
        </Button>
        <ResultBox label="result" value={registerResult} />
      </Section>
    </Panel>
  );
}

// ─── Combined log ───────────────────────────────────────────────────────────

const BRIDGE_SOURCES = new Set(['desktop', 'desktop-ws-offscreen', 'frontend-bridge']);

function CombinedEventLog() {
  const events = useDebugStore((s) => s.events);
  const traffic = useBridgeTrafficStore((s) => s.entries);
  const [paused, setPaused] = useState(false);
  const frozenEvents = useRef<DebugEvent[]>([]);
  const frozenTraffic = useRef<BridgeTrafficEntry[]>([]);
  const clearTraffic = useBridgeTrafficStore((s) => s.clear);
  const clearLog = useDebugStore((s) => s.clear);

  const liveEvents = paused ? frozenEvents.current : events;
  if (!paused) frozenEvents.current = events;
  const liveTraffic = paused ? frozenTraffic.current : traffic;
  if (!paused) frozenTraffic.current = traffic;

  const merged = useMemo(() => {
    type Row =
      | { kind: 'event'; ts: number; data: DebugEvent }
      | { kind: 'traffic'; ts: number; data: BridgeTrafficEntry };
    const rows: Row[] = [];
    for (const e of liveEvents) {
      if (BRIDGE_SOURCES.has(e.source)) {
        rows.push({ kind: 'event', ts: e.ts, data: e });
      }
    }
    for (const t of liveTraffic) {
      rows.push({ kind: 'traffic', ts: t.ts, data: t });
    }
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, 80);
  }, [liveEvents, liveTraffic]);

  return (
    <Panel
      title="Combined event log"
      subtitle="every bridge channel, color-coded"
      defaultOpen={false}
      rightSlot={
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={(e) => {
              e.stopPropagation();
              setPaused((v) => !v);
            }}
          >
            {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={(e) => {
              e.stopPropagation();
              clearTraffic();
              clearLog();
            }}
          >
            <Eraser className="size-3" />
          </Button>
        </div>
      }
    >
      {merged.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">
          no bridge activity yet — try one of the panels above
        </div>
      ) : (
        <div className="max-h-72 space-y-0.5 overflow-auto font-mono text-[10px]">
          {merged.map((row) =>
            row.kind === 'event' ? (
              <div key={row.data.id} className="flex items-baseline gap-2">
                <span className="text-muted-foreground">
                  {new Date(row.ts).toLocaleTimeString()}
                </span>
                <span className={sourceClass(row.data.source)}>{row.data.source}</span>
                <span className="truncate">{row.data.message}</span>
              </div>
            ) : (
              <div key={row.data.id} className="flex items-baseline gap-2">
                <span className="text-muted-foreground">
                  {new Date(row.ts).toLocaleTimeString()}
                </span>
                <span className="text-sky-500">{row.data.stream}</span>
                <span className="truncate">
                  {row.data.direction} {row.data.action}
                  {row.data.error ? ` (${row.data.error})` : ''}
                </span>
              </div>
            ),
          )}
        </div>
      )}
    </Panel>
  );
}

function sourceClass(source: string): string {
  if (source === 'desktop' || source === 'desktop-ws-offscreen') return 'text-amber-500';
  if (source === 'frontend-bridge') return 'text-violet-500';
  return 'text-muted-foreground';
}
