/**
 * PilotView — CLAUDE.md roadmap item #9.
 *
 * Cloned from ChatView. Two surfaces, two render trees, on purpose: the
 * Pilot tab is its own conversational surface that drives a sandboxed
 * Chrome tab group, and the assistant Chat tab continues to follow the
 * user's active tab. Their evolution paths diverge — keeping the views
 * parallel is cheaper than untangling a shared base later.
 *
 * Differences from ChatView (intentional):
 *   - Reads from `usePilotChatStore` instead of `useChatStore`
 *   - Streams via `usePilotChatStream` (writes into the pilot store, sets
 *     `surface: 'pilot'` and `source_feature: 'pilot-chat'`)
 *   - Header shows the active Pilot session state plus Start / End controls
 *   - Composer is disabled until a session is active
 *   - All sends pin to a tab INSIDE the active session's group — never to
 *     the user's focused tab
 *   - Defaults to 'act' permission mode (Pilot is meant to be more autonomous)
 */

import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ALL_SCOPES,
  type AgentScope,
  SCOPE_LABEL,
  countByScope,
  filterAgentsByScope,
  scopeOf,
} from '@/lib/agents/scope';
import { AgentApprovalCard } from '@/features/chat/AgentApprovalCard';
import { AgentAskUserCard } from '@/features/chat/AgentAskUserCard';
import { AgentVariablesPanel } from '@/features/chat/AgentVariablesPanel';
import { LanguagePicker } from '@/features/chat/LanguagePicker';
import { ServerToolRow } from '@/features/chat/ServerToolRow';
import { SpeakerButton } from '@/features/chat/SpeakerButton';
import { ToolTimelineRow } from '@/features/chat/ToolTimelineRow';
import { useAgentExecution } from '@/hooks/use-agent-execution';
import { useAuth } from '@/hooks/use-auth';
import { usePilotChatStream } from '@/hooks/use-pilot-chat-stream';
import { useToolInbox$Subscribe } from '@/hooks/use-tool-inbox';
import { wrapForAgent } from '@/lib/clipboard/copy';
import {
  type AgxAgent,
  fetchUserAgents,
} from '@/lib/supabase/queries';
import { cn } from '@/lib/utils';
import { type ChatMessage, type MessagePart } from '@/state/chat';
import { usePilotChatStore } from '@/state/pilot-chat';
import { usePilotStore } from '@/state/pilot';
import { useSettingsStore } from '@/state/settings';
import { useToolInbox } from '@/state/tool-inbox';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Crosshair,
  Hand,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  StopCircle,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BreathingOrb } from './BreathingOrb';
import { chatMarkdownRegistry } from './markdown-registry';

const PILOT_SUGGESTIONS = [
  { icon: Crosshair, label: 'Open three competitor sites and summarize each' },
  { icon: Sparkles, label: 'Find the best price for this product across vendors' },
  { icon: Pencil, label: 'Walk through this multi-step form on my behalf' },
];

export function PilotView() {
  const { user, isAdmin } = useAuth();
  const {
    selectedAgentId,
    draft,
    messages,
    isStreaming,
    setAgent,
    setDraft,
    setMessages,
  } = usePilotChatStore();
  const { send, cancel } = usePilotChatStream();
  const { variableDefs } = useAgentExecution(selectedAgentId);
  const getAgentVariables = usePilotChatStore((s) => s.getAgentVariables);

  // Pilot defaults to 'act' (more autonomous than the assistant). The user
  // can flip to 'ask' via the chip — same affordance as the chat header.
  const explicitPermissionMode = usePilotChatStore((s) =>
    selectedAgentId ? s.permissionMode[selectedAgentId] : undefined,
  );
  const permissionMode = explicitPermissionMode ?? 'act';
  const setPermissionMode = usePilotChatStore((s) => s.setPermissionMode);

  const session = usePilotStore((s) => s.session);
  const startSession = usePilotStore((s) => s.startSession);
  const endSession = usePilotStore((s) => s.endSession);

  const [agents, setAgents] = useState<AgxAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsRefreshing, setAgentsRefreshing] = useState(false);
  const [groupTabCount, setGroupTabCount] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  useToolInbox$Subscribe();
  const allPendingConfirms = useToolInbox((s) => s.pendingConfirms);
  const allPendingAsks = useToolInbox((s) => s.pendingAsks);
  // The pilot view has its own conversation — filter inbox cards to it.
  // Cards from a stale assistant chat or a previous pilot session must
  // not bleed into the active pilot turn.
  const pilotConversationId = session.conversationId;
  const pendingConfirms = useMemo(
    () => allPendingConfirms.filter((c) => c.conversationId === pilotConversationId),
    [allPendingConfirms, pilotConversationId],
  );
  const pendingAsks = useMemo(
    () => allPendingAsks.filter((c) => c.conversationId === pilotConversationId),
    [allPendingAsks, pilotConversationId],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const a = await fetchUserAgents(user.id);
      if (cancelled) return;
      setAgents(a);
      setAgentsLoading(false);

      // Auto-select user's default agent if nothing is currently selected.
      const chat = usePilotChatStore.getState();
      const defaultId = useSettingsStore.getState().defaultAgentId;
      if (!chat.selectedAgentId && defaultId && a.some((x) => x.id === defaultId)) {
        chat.setAgent(defaultId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const refreshAgents = async () => {
    if (!user || agentsRefreshing) return;
    setAgentsRefreshing(true);
    try {
      const a = await fetchUserAgents(user.id);
      setAgents(a);
    } finally {
      setAgentsRefreshing(false);
    }
  };

  // Track distance-from-bottom on every scroll event.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      pinnedToBottomRef.current = distanceFromBottom <= 8;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }, [messages, pendingConfirms.length, pendingAsks.length]);

  // Keep the in-header tab counter accurate. We poll on session changes and
  // on the tab-removed event Chrome fires; this isn't a hot path, so a simple
  // refresh-on-mount + listener is sufficient.
  useEffect(() => {
    if (!session.active || session.groupId == null) {
      setGroupTabCount(null);
      return;
    }
    const refresh = async () => {
      if (session.groupId == null) return;
      try {
        const tabs = await chrome.tabs.query({ groupId: session.groupId });
        setGroupTabCount(tabs.length);
      } catch {
        setGroupTabCount(null);
      }
    };
    void refresh();
    const onUpdated = () => void refresh();
    chrome.tabs.onCreated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onUpdated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onCreated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onUpdated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [session.active, session.groupId]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const firstName = useMemo<string>(() => {
    const full = user?.full_name?.trim();
    if (full) return full.split(' ')[0] ?? '';
    return user?.email?.split('@')[0] ?? '';
  }, [user]);

  /**
   * Resolve the tab the agent should pin to for this turn. We prefer the
   * group's currently-active tab (the one the user is looking at inside
   * the sandbox); if none is active, the most recently focused tab in
   * the group; failing that, any tab in the group. Returning null means
   * the group is empty — the dispatcher would refuse anyway, so we abort.
   */
  const resolvePilotTabId = async (): Promise<number | null> => {
    if (session.groupId == null) return null;
    try {
      const tabs = await chrome.tabs.query({ groupId: session.groupId });
      const active = tabs.find((t) => t.active);
      if (active?.id != null) return active.id;
      const sorted = tabs
        .filter((t) => t.id != null)
        .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      return sorted[0]?.id ?? null;
    } catch {
      return null;
    }
  };

  const submitMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!session.active) return;
    const agentId = selectedAgentId ?? agents[0]?.id;
    if (!agentId) return;
    if (!selectedAgentId && agentId) setAgent(agentId);
    pinnedToBottomRef.current = true;
    setDraft('');
    const rawVars = getAgentVariables(agentId);
    const variables: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawVars)) {
      if (v && v.trim().length > 0) variables[k] = v;
    }
    const agentName = agents.find((a) => a.id === agentId)?.name;
    const tabId = await resolvePilotTabId();
    if (tabId == null) {
      // Group has no tabs — open a fresh one so the user can keep going.
      try {
        if (session.groupId != null) {
          const tab = await chrome.tabs.create({
            active: true,
            windowId: session.windowId ?? undefined,
          });
          if (tab.id != null) {
            await chrome.tabs.group({
              tabIds: [tab.id],
              groupId: session.groupId,
            });
            await submitWith(tab.id, trimmed, agentId, agentName, variables);
          }
        }
      } catch {
        /* nothing more to do — surface inline error */
      }
      return;
    }
    await submitWith(tabId, trimmed, agentId, agentName, variables);
  };

  const submitWith = async (
    tabId: number,
    text: string,
    agentId: string,
    agentName: string | undefined,
    variables: Record<string, string>,
  ) => {
    void send(text, {
      agentId,
      agentName,
      conversationId: session.conversationId ?? undefined,
      variables: Object.keys(variables).length > 0 ? variables : undefined,
      assignedTabId: tabId,
    });
  };

  const handleNewChat = () => {
    usePilotChatStore.getState().setConversation(null);
    usePilotStore.getState().setConversationId(null);
    setMessages([]);
  };

  const handleStartSession = async () => {
    const agentId = selectedAgentId ?? agents[0]?.id;
    if (!agentId) {
      window.alert('Pick an agent before starting a Pilot session.');
      return;
    }
    if (!selectedAgentId) setAgent(agentId);
    await startSession({ agentId });
    handleNewChat();
  };

  const handleEndSession = async () => {
    if (isStreaming) await cancel();
    await endSession();
    handleNewChat();
  };

  // Admin-only convention (CLAUDE.md). Until Pilot graduates from
  // experimental, non-admin users see an explanatory placeholder rather
  // than the live UI. This mirrors the Showcase / Debug tab pattern.
  if (!isAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
        <Crosshair className="size-8 mb-3 text-primary" />
        <p className="text-sm font-medium">Pilot is admin-only while we shake it down.</p>
        <p className="mt-2 text-xs">
          The Pilot surface drives a sandboxed Chrome tab group with the full
          read+action+ask agent toolkit. It will graduate to general
          availability once the rough edges are sanded.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <PilotHeader
        agents={agents}
        agentsLoading={agentsLoading}
        agentsRefreshing={agentsRefreshing}
        onRefreshAgents={() => void refreshAgents()}
        selectedAgentId={selectedAgentId}
        permissionMode={permissionMode}
        onPermissionModeChange={(m) => {
          if (selectedAgentId) setPermissionMode(selectedAgentId, m);
        }}
        onAgentChange={(v) => {
          const next = v || null;
          if (next === selectedAgentId) return;
          if (isStreaming) cancel();
          setAgent(next);
          handleNewChat();
        }}
        sessionActive={session.active}
        groupId={session.groupId}
        groupTabCount={groupTabCount}
        onStartSession={() => void handleStartSession()}
        onEndSession={() => void handleEndSession()}
        sessionDisabled={isStreaming}
      />

      {selectedAgentId && variableDefs.length > 0 && (
        <AgentVariablesPanel agentId={selectedAgentId} defs={variableDefs} />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <PilotEmptyState
            firstName={firstName}
            sessionActive={session.active}
            onSuggestion={(text) => void submitMessage(text)}
            disabled={!session.active || agents.length === 0}
          />
        ) : (
          <div className="space-y-4 px-4 py-4">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}

            {pendingConfirms.map((req) => (
              <AgentApprovalCard key={req.callId} req={req} />
            ))}

            {pendingAsks.map((req) => (
              <AgentAskUserCard key={req.callId} req={req} />
            ))}
          </div>
        )}
      </div>

      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={() => void submitMessage(draft)}
        onCancel={() => void cancel()}
        isStreaming={isStreaming}
        canSend={session.active && Boolean(selectedAgentId || agents[0]?.id)}
        placeholder={
          !session.active
            ? 'Start a Pilot session to begin.'
            : selectedAgent
              ? `Pilot ${selectedAgent.name}…`
              : agents.length === 0
                ? 'No agents available'
                : 'How should the agent drive the sandbox?'
        }
      />
    </div>
  );
}

function PilotAgentPicker({
  agents,
  selectedAgentId,
  onAgentChange,
}: {
  agents: AgxAgent[];
  selectedAgentId: string | null;
  onAgentChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const scopes = useSettingsStore((s) => s.agentScopes);
  const toggleScope = useSettingsStore((s) => s.toggleAgentScope);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const counts = useMemo(() => countByScope(agents), [agents]);
  const scoped = useMemo(() => filterAgentsByScope(agents, scopes), [agents, scopes]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((a) => {
      if (a.name.toLowerCase().includes(q)) return true;
      if (a.description && a.description.toLowerCase().includes(q)) return true;
      if (a.tags && a.tags.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [scoped, query]);
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );
  const triggerLabel = selectedAgent?.name ?? 'Select pilot agent';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 max-w-[180px] items-center gap-1 rounded-md border-0 bg-transparent px-2 text-xs font-medium text-foreground hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-b px-2 py-1.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, description, tag…"
            className="h-7 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length === 1) {
                e.preventDefault();
                const only = filtered[0];
                if (only) {
                  onAgentChange(only.id);
                  setOpen(false);
                }
              } else if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
              }
            }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
          {ALL_SCOPES.map((scope: AgentScope) => {
            const active = scopes.includes(scope);
            const count = counts[scope];
            return (
              <button
                key={scope}
                type="button"
                onClick={() => toggleScope(scope)}
                className={cn(
                  'inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                title={`${SCOPE_LABEL[scope]} (${count})`}
              >
                {SCOPE_LABEL[scope]}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[9px] font-semibold',
                    active
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-background/80 text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {agents.length === 0
                ? 'No agents — create one in Matrx.'
                : query.trim()
                  ? `No agents match "${query.trim()}" within the current scope.`
                  : 'No agents match the current scope filter.'}
            </div>
          ) : (
            filtered.map((a) => {
              const isSelected = a.id === selectedAgentId;
              const scope = scopeOf(a);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    onAgentChange(a.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent',
                    isSelected && 'bg-accent',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm">{a.name}</span>
                      {a.is_favorite && (
                        <Sparkles className="size-3 shrink-0 text-amber-500" />
                      )}
                    </div>
                    {a.description && (
                      <div className="line-clamp-1 text-[10px] text-muted-foreground">
                        {a.description}
                      </div>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded-full bg-secondary/80 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
                    title={SCOPE_LABEL[scope]}
                  >
                    {scope === 'mine' ? '·' : SCOPE_LABEL[scope]}
                  </span>
                  {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PilotHeader({
  agents,
  agentsLoading,
  agentsRefreshing,
  onRefreshAgents,
  selectedAgentId,
  permissionMode,
  onPermissionModeChange,
  onAgentChange,
  sessionActive,
  groupId,
  groupTabCount,
  onStartSession,
  onEndSession,
  sessionDisabled,
}: {
  agents: AgxAgent[];
  agentsLoading: boolean;
  agentsRefreshing: boolean;
  onRefreshAgents: () => void;
  selectedAgentId: string | null;
  permissionMode: 'ask' | 'act';
  onPermissionModeChange: (m: 'ask' | 'act') => void;
  onAgentChange: (id: string) => void;
  sessionActive: boolean;
  groupId: number | null;
  groupTabCount: number | null;
  onStartSession: () => void;
  onEndSession: () => void;
  sessionDisabled: boolean;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center px-2">
      {agentsLoading ? (
        <Skeleton className="h-6 w-28" />
      ) : (
        <>
          <PilotAgentPicker
            agents={agents}
            selectedAgentId={selectedAgentId}
            onAgentChange={onAgentChange}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            title="Refresh agents (pull latest edits)"
            onClick={onRefreshAgents}
            disabled={agentsRefreshing}
          >
            <RefreshCw className={cn('size-3.5', agentsRefreshing && 'animate-spin')} />
          </Button>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        <LanguagePicker />
        <PermissionModeChip
          mode={permissionMode}
          disabled={!selectedAgentId}
          onChange={onPermissionModeChange}
        />
        {sessionActive ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
            title="End the active Pilot session and close its tabs"
            onClick={onEndSession}
            disabled={sessionDisabled}
          >
            <StopCircle className="size-3.5" />
            <span className="hidden sm:inline">
              End{groupId != null ? ` · group ${groupId}` : ''}
              {groupTabCount != null ? ` (${groupTabCount})` : ''}
            </span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
            title="Start a Pilot session — opens a fresh tab group"
            onClick={onStartSession}
          >
            <Play className="size-3.5" />
            <span className="hidden sm:inline">Start Pilot</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function PermissionModeChip({
  mode,
  disabled,
  onChange,
}: {
  mode: 'ask' | 'act';
  disabled: boolean;
  onChange: (m: 'ask' | 'act') => void;
}) {
  const Icon = mode === 'ask' ? Hand : Zap;
  const label = mode === 'ask' ? 'Ask before acting' : 'Act without asking';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            'h-7 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent',
            mode === 'act' && 'text-amber-700 dark:text-amber-400',
          )}
          title="Tool permission mode"
        >
          <Icon className="size-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="end">
        <ModeOption
          active={mode === 'ask'}
          icon={<Hand className="size-4" />}
          title="Ask before acting"
          desc="The agent pauses to confirm every browser action."
          onClick={() => onChange('ask')}
        />
        <ModeOption
          active={mode === 'act'}
          icon={<Zap className="size-4 text-amber-600 dark:text-amber-400" />}
          title="Act without asking"
          desc="The agent runs actions immediately. Privileged tools still confirm."
          onClick={() => onChange('act')}
        />
      </PopoverContent>
    </Popover>
  );
}

function ModeOption({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {active && <Check className="size-3.5 text-primary" />}
        </div>
        <div className="text-[11px] leading-snug text-muted-foreground">{desc}</div>
      </div>
    </button>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="group flex justify-end gap-1">
        <div className="self-end opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={message.content} title="Copy message" size="xs" />
        </div>
        <div className="max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-sm">
          <Markdown content={message.content} density="compact" />
        </div>
      </div>
    );
  }

  const parts = message.parts;
  const hasParts = (parts?.length ?? 0) > 0;
  const showOrb = message.pending && !hasParts && !message.content;

  if (showOrb) {
    return (
      <div className="group">
        <BreathingOrb size={28} />
      </div>
    );
  }

  const finalText = hasParts
    ? (parts ?? [])
        .filter((p) => p.type === 'text')
        .map((p) => (p as { content: string }).content)
        .join('')
    : message.content;

  return (
    <div className="group space-y-2">
      {hasParts ? (
        parts?.map((part, i) => <MessagePartView key={i} part={part} />)
      ) : message.content ? (
        <Markdown content={message.content} registry={chatMarkdownRegistry} />
      ) : null}

      {message.pending && hasParts && parts?.[parts.length - 1]?.type !== 'text' && (
        <BreathingOrb size={20} />
      )}

      {!message.pending && finalText && (
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyMenu
            title="Copy reply"
            align="start"
            options={[
              { label: 'Markdown', getContent: () => finalText },
              {
                label: 'For AI agent',
                ai: true,
                description: 'With agent context',
                getContent: () =>
                  wrapForAgent({
                    description: 'a reply from a Matrx Pilot agent',
                    format: 'markdown',
                    content: finalText,
                  }),
              },
            ]}
          />
          <SpeakerButton text={finalText} />
        </div>
      )}
    </div>
  );
}

function MessagePartView({ part }: { part: MessagePart }) {
  if (part.type === 'text') {
    return part.content ? (
      <Markdown content={part.content} registry={chatMarkdownRegistry} />
    ) : null;
  }
  if (part.type === 'reasoning') {
    return part.content ? (
      <div className="rounded-md border-l-2 border-muted-foreground/30 bg-secondary/30 px-3 py-1.5 text-[12px] italic text-muted-foreground">
        {part.content}
      </div>
    ) : null;
  }
  const t = part.tool;
  if (t.kind === 'server') {
    return <ServerToolRow tool={t} />;
  }
  return (
    <ToolTimelineRow
      entry={{
        callId: t.callId,
        toolName: t.toolName,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        phase: t.phase,
        args: t.args,
        output: t.result,
        message: t.message,
      }}
    />
  );
}

function PilotEmptyState({
  firstName,
  sessionActive,
  onSuggestion,
  disabled,
}: {
  firstName: string;
  sessionActive: boolean;
  onSuggestion: (text: string) => void;
  disabled: boolean;
}) {
  if (!sessionActive) {
    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <Crosshair className="size-10 text-primary" />
        <h1 className="text-2xl font-medium tracking-tight">
          Pilot{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The Pilot surface drives a sandboxed Chrome tab group with the full
          read+action+ask agent toolkit. Click <strong>Start Pilot</strong> in
          the header to open a fresh group seeded with the active tab.
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          The agent can only act on tabs inside that group. Close the group
          (or click <strong>End</strong>) to release control.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-[60vh] flex-col justify-end px-4 pb-2">
      <h1 className="text-3xl font-medium tracking-tight">
        <span className="text-primary">Ready{firstName ? `, ${firstName}` : ''}</span>
      </h1>
      <p className="mt-1 text-2xl text-muted-foreground">
        How should the Pilot drive the sandbox?
      </p>
      <div className="mt-6 flex flex-col items-start gap-2">
        {PILOT_SUGGESTIONS.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onSuggestion(label)}
            className="inline-flex items-center gap-2 rounded-full bg-secondary px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon className="size-4 text-primary" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  onCancel,
  isStreaming,
  canSend,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isStreaming: boolean;
  canSend: boolean;
  placeholder: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const hasText = value.trim().length > 0;

  return (
    <div className="px-3 pb-3 pt-1">
      <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:shadow">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={1}
          disabled={!canSend && !isStreaming}
          className="block max-h-[180px] w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!isStreaming && canSend) onSubmit();
            }
          }}
        />
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <div className="ml-auto flex items-center gap-1">
            {isStreaming ? (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
                title="Stop"
              >
                <Square className="size-3.5" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSubmit}
                disabled={!hasText || !canSend}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-full transition-opacity',
                  hasText && canSend
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'bg-muted text-muted-foreground',
                )}
                title={canSend ? 'Send' : 'Start a Pilot session first'}
              >
                {hasText ? (
                  <ArrowUp className="size-4" />
                ) : (
                  <Loader2 className="size-4 opacity-0" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
