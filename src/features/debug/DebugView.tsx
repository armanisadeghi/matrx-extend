/**
 * Debug tab — always-on, captures every event from every extension context
 * (sidepanel, SW, offscreen, content scripts) via the cross-context relay.
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
import { setBackendEnv, setBackendOverride, useBackendConfig } from '@/config/backend';
import type { BackendEnv } from '@/config/env';
import { AdminAgentFlagsPanel } from '@/features/debug/AdminAgentFlagsPanel';
import { BridgesView } from '@/features/debug/BridgesView';
import { ExtensionIdentityCard } from '@/features/debug/ExtensionIdentityCard';
import { pingHealth } from '@/lib/api/routes/health';
import {
  CONTEXT_SHAPE_STORAGE_KEY,
  type ContextShape,
  DEFAULT_CONTEXT_SHAPE,
  setContextShape,
} from '@/lib/chat/context/shape-config';
import {
  type DebugEvent,
  type LogLevel,
  type LogSource,
  log,
  useDebugStore,
} from '@/lib/debug/log';
import { cn } from '@/lib/utils';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Download,
  Eraser,
  Pause,
  Play,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const SOURCES: LogSource[] = [
  'auth',
  'api',
  'stream',
  'scrape',
  'desktop',
  'supabase',
  'sw',
  'msg',
  'ui',
  'sys',
];
const LEVELS: LogLevel[] = ['info', 'success', 'warn', 'error'];

export function DebugView() {
  const events = useDebugStore((s) => s.events);
  const clear = useDebugStore((s) => s.clear);
  const [subview, setSubview] = useState<'log' | 'bridges'>('log');
  const [sources, setSources] = useState<Set<LogSource>>(new Set(SOURCES));
  const [levels, setLevels] = useState<Set<LogLevel>>(new Set(LEVELS));
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const frozenRef = useRef<DebugEvent[]>([]);

  const filtered = useMemo(() => {
    const list = paused ? frozenRef.current : events;
    if (!paused) frozenRef.current = events;
    const q = search.trim().toLowerCase();
    return list.filter((e) => {
      if (!sources.has(e.source) || !levels.has(e.level)) return false;
      if (!q) return true;
      const detail = e.detail !== undefined ? safeStringify(e.detail).toLowerCase() : '';
      return e.message.toLowerCase().includes(q) || detail.includes(q);
    });
  }, [events, sources, levels, paused, search]);

  const errorCount = useMemo(() => events.filter((e) => e.level === 'error').length, [events]);

  const toggleSource = (s: LogSource) =>
    setSources((curr) => {
      const next = new Set(curr);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const toggleLevel = (l: LogLevel) =>
    setLevels((curr) => {
      const next = new Set(curr);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  const toggleExpand = (id: string) =>
    setExpanded((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyAll = async () => {
    const text = filtered.slice().reverse().map(formatEventLine).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadAll = () => {
    const text = filtered.slice().reverse().map(formatEventLine).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `matrx-extend-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1.5 px-3 pt-1 pb-2">
        {/*
          Identity card first — when sign-in is broken, this is the answer.
          Lives outside the AdminAgentFlagsPanel collapsible so it's visible
          without an extra click.
        */}
        <ExtensionIdentityCard />
        <BackendSwitcher />
        <ContextShapeSwitcher />
        <AdminAgentFlagsPanel />
        <div className="flex items-center gap-1 rounded-full bg-secondary/40 p-0.5">
          <button
            type="button"
            onClick={() => setSubview('log')}
            className={cn(
              'flex-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
              subview === 'log'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Log
          </button>
          <button
            type="button"
            onClick={() => setSubview('bridges')}
            className={cn(
              'flex-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
              subview === 'bridges'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Bridges
          </button>
        </div>
        {subview === 'log' && (
          <>
            <div className="flex items-center gap-1.5">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-7 flex-1 rounded-full border-0 bg-secondary/40 px-3 text-xs focus-visible:ring-1"
              />
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {filtered.length}/{events.length}
              </span>
              {errorCount > 0 && (
                <span className="font-mono text-[10px] tabular-nums text-destructive">
                  {errorCount} err
                </span>
              )}
              <IconBtn title={paused ? 'Resume' : 'Pause'} onClick={() => setPaused((p) => !p)}>
                {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              </IconBtn>
              <IconBtn title="Copy all" onClick={() => void copyAll()}>
                {copied ? (
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                ) : (
                  <Clipboard className="size-3.5" />
                )}
              </IconBtn>
              <IconBtn title="Download .log" onClick={downloadAll}>
                <Download className="size-3.5" />
              </IconBtn>
              <IconBtn title="Clear" onClick={clear}>
                <Eraser className="size-3.5" />
              </IconBtn>
            </div>
            <Filters
              options={SOURCES}
              active={sources as Set<string>}
              onToggle={(v) => toggleSource(v as LogSource)}
            />
            <Filters
              options={LEVELS}
              active={levels as Set<string>}
              onToggle={(v) => toggleLevel(v as LogLevel)}
            />
          </>
        )}
      </div>
      {subview === 'bridges' && (
        <div className="flex-1 overflow-y-auto">
          <BridgesView />
        </div>
      )}
      {subview === 'log' && (
      <div className="flex-1 overflow-y-auto font-mono text-[11px]">
        {filtered.length === 0 && (
          <div className="px-3 py-12 text-center text-muted-foreground">
            {events.length === 0
              ? "No events yet. Use the extension and they'll show up here."
              : 'No events match the current filter.'}
          </div>
        )}
        {filtered.map((e) => {
          const isOpen = expanded.has(e.id);
          const hasDetail = e.detail !== undefined;
          return (
            <div key={e.id} className="hover:bg-accent/40">
              <button
                type="button"
                onClick={() => hasDetail && toggleExpand(e.id)}
                className={cn(
                  'flex w-full items-baseline gap-2 px-3 py-1 text-left',
                  levelClass(e.level),
                  !hasDetail && 'cursor-default',
                )}
              >
                <span className="size-3 shrink-0 text-muted-foreground/50">
                  {hasDetail ? (
                    isOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )
                  ) : null}
                </span>
                <span className="shrink-0 text-muted-foreground/60">{fmtTime(e.ts)}</span>
                <span className="shrink-0 text-[9px] uppercase text-muted-foreground/70">
                  {e.ctx}
                </span>
                <span className="shrink-0 font-semibold">{e.source}</span>
                <span className="truncate">{e.message}</span>
              </button>
              {isOpen && hasDetail && (
                <pre className="mx-3 mb-1.5 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-secondary/40 p-2 text-[10px]">
                  {safeStringify(e.detail)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-7 text-muted-foreground hover:text-foreground"
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function BackendSwitcher() {
  const backend = useBackendConfig();
  const [overrideDraft, setOverrideDraft] = useState<string | null>(null);

  const change = async (env: BackendEnv) => {
    await setBackendEnv(env);
    log.info('sys', `backend env → ${env}`);
    void pingHealth(`switched to ${env}`);
  };

  const saveOverride = async (val: string) => {
    const prev = backend.override;
    await setBackendOverride(val);
    log.info('sys', val ? `backend URL override → ${val}` : 'backend URL override cleared');
    if (val !== prev) void pingHealth(val ? `switched override to ${val}` : 'cleared override');
  };

  const overrideValue = overrideDraft ?? backend.override;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Select value={backend.env} onValueChange={(v) => void change(v as BackendEnv)}>
        <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="prod">prod</SelectItem>
          <SelectItem value="staging">staging</SelectItem>
          <SelectItem value="dev">dev</SelectItem>
          <SelectItem value="local">localhost:8000</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={overrideValue}
        onChange={(e) => setOverrideDraft(e.target.value)}
        onBlur={() => {
          if (overrideDraft !== null) {
            void saveOverride(overrideDraft.trim());
            setOverrideDraft(null);
          }
        }}
        placeholder="Custom URL"
        className="h-7 flex-1 rounded-full border-0 bg-secondary/40 px-3 font-mono text-[10px] focus-visible:ring-1"
      />
      <IconBtn title="Ping /health/" onClick={() => void pingHealth('manual')}>
        <Activity className="size-3.5" />
      </IconBtn>
      <span
        className="max-w-[140px] truncate font-mono text-[10px] text-muted-foreground"
        title={backend.url}
      >
        → {backend.url}
      </span>
    </div>
  );
}

function ContextShapeSwitcher() {
  const [shape, setShape] = useState<ContextShape>(DEFAULT_CONTEXT_SHAPE);

  useEffect(() => {
    let cancelled = false;
    void chrome.storage.local.get([CONTEXT_SHAPE_STORAGE_KEY]).then((r) => {
      if (cancelled) return;
      const v = r[CONTEXT_SHAPE_STORAGE_KEY];
      if (v === 'v1-flat' || v === 'v2-bundled') setShape(v);
    });
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      const c = changes[CONTEXT_SHAPE_STORAGE_KEY];
      if (!c) return;
      const v = c.newValue;
      if (v === 'v1-flat' || v === 'v2-bundled') setShape(v);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const change = async (next: ContextShape) => {
    await setContextShape(next);
    setShape(next);
    log.info('sys', `context shape → ${next}`);
  };

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-mono text-[10px] text-muted-foreground">context</span>
      <Select value={shape} onValueChange={(v) => void change(v as ContextShape)}>
        <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="v2-bundled">v2 (bundled, default)</SelectItem>
          <SelectItem value="v1-flat">v1 (legacy flat)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function Filters({
  options,
  active,
  onToggle,
}: {
  options: string[];
  active: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      <button
        type="button"
        onClick={() => options.forEach((o) => !active.has(o) && onToggle(o))}
        className="rounded-full px-2 py-0.5 text-muted-foreground hover:bg-accent"
      >
        all
      </button>
      <button
        type="button"
        onClick={() => options.forEach((o) => active.has(o) && onToggle(o))}
        className="rounded-full px-2 py-0.5 text-muted-foreground hover:bg-accent"
      >
        none
      </button>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onToggle(o)}
          className={cn(
            'rounded-full px-2 py-0.5 font-mono transition-colors',
            active.has(o)
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground/50 hover:bg-accent hover:text-muted-foreground',
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function levelClass(level: LogLevel): string {
  switch (level) {
    case 'success':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'warn':
      return 'text-amber-600 dark:text-amber-400';
    case 'error':
      return 'text-red-600 dark:text-red-400';
    default:
      return '';
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatEventLine(e: DebugEvent): string {
  const detail =
    e.detail !== undefined ? `\n    ${safeStringify(e.detail).split('\n').join('\n    ')}` : '';
  return `${fmtTime(e.ts)} [${e.ctx}/${e.source}/${e.level}] ${e.message}${detail}`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, replacer, 2);
  } catch {
    return String(v);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'string' && value.length > 4000) {
    return `${value.slice(0, 4000)}…(+${value.length - 4000} chars)`;
  }
  return value;
}
