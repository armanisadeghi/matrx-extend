import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  USER_MODEL_LABEL_BY_ID,
  USER_MODEL_PRESETS,
} from '@/lib/agents/model-presets';
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
import { CopyConversationButton } from '@/features/chat/CopyConversationButton';
import { formatAssistantBody } from '@/features/chat/copy-conversation';
import { LanguagePicker } from '@/features/chat/LanguagePicker';
import { ServerToolRow } from '@/features/chat/ServerToolRow';
import { SpeakerButton } from '@/features/chat/SpeakerButton';
import { ToolTimelineRow } from '@/features/chat/ToolTimelineRow';
import { useAgentExecution } from '@/hooks/use-agent-execution';
import { useAuth } from '@/hooks/use-auth';
import { useChatStream } from '@/hooks/use-chat-stream';
import { useRecordAndTranscribe } from '@/lib/audio/useRecordAndTranscribe';
import { log } from '@/lib/debug/log';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useToolInbox$Subscribe } from '@/hooks/use-tool-inbox';
import { wrapForAgent } from '@/lib/clipboard/copy';
import {
  type AgxAgent,
  type Conversation,
  dbMessagesToChatMessages,
  fetchConversationHistory,
  fetchConversationMessages,
  fetchUserAgents,
} from '@/lib/supabase/queries';
import { cn } from '@/lib/utils';
import { type ChatMessage, type MessagePart, useChatStore } from '@/state/chat';
import { useSettingsStore } from '@/state/settings';
import { useToolInbox } from '@/state/tool-inbox';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronDown,
  Hand,
  History,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Settings2,
  Sliders,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BreathingOrb } from './BreathingOrb';
import { chatMarkdownRegistry } from './markdown-registry';

const SUGGESTIONS = [
  { icon: Pencil, label: 'Help me with my writing' },
  { icon: Sparkles, label: 'Brainstorm ideas with me' },
  { icon: Lightbulb, label: 'Help me make a decision' },
  { icon: ScanLine, label: 'Analyze the current page' },
];

/**
 * Map raw mic / transcription errors to short user-actionable messages.
 * The canonical error codes are emitted by mic-recorder-offscreen.ts.
 *
 * NOTE: PERMISSION_DENIED is normally routed into the dedicated mic-grant
 * popup window (see `onError` in the composer); it only falls through to
 * this banner if `chrome.windows.create` itself fails. Everything else
 * (forwarding failures, HTTP errors, etc.) we just pass through with a
 * hint about what failed.
 */
function formatMicErrorForUser(message: string, code?: string): string {
  switch (code) {
    case 'PERMISSION_DENIED':
      // Fallback only — the canonical PERMISSION_DENIED path opens the
      // mic-grant popup so Chrome can prompt for permission reliably.
      return 'Microphone access required. Click the mic button to try again.';
    case 'NO_DEVICE':
      return 'No microphone detected. Plug one in or check your system audio input settings.';
    case 'DEVICE_BUSY':
      return 'Microphone is in use by another app. Close any other recording app (Zoom, Teams, OBS, etc.) and try again.';
    case 'UNKNOWN_ERROR':
      return `Mic failed: ${message || 'unknown error'}. Try unplugging and replugging the microphone.`;
    default:
      // Sign-in / network / HTTP errors land here. The message comes from
      // the underlying throw and is already user-friendly.
      return message || 'Voice input failed.';
  }
}

export function ChatView() {
  const { user } = useAuth();
  const {
    selectedAgentId,
    selectedConversationId,
    messages,
    draft,
    isStreaming,
    setAgent,
    setConversation,
    setDraft,
    setMessages,
  } = useChatStore();
  const { send, cancel } = useChatStream();
  const { variableDefs } = useAgentExecution(selectedAgentId);
  const getAgentVariables = useChatStore((s) => s.getAgentVariables);
  const defaultPermissionMode = useSettingsStore((s) => s.defaultPermissionMode);
  const explicitPermissionMode = useChatStore((s) =>
    selectedAgentId ? s.permissionMode[selectedAgentId] : undefined,
  );
  const permissionMode = explicitPermissionMode ?? defaultPermissionMode;
  const setPermissionMode = useChatStore((s) => s.setPermissionMode);
  const [agents, setAgents] = useState<AgxAgent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-scroll follows the stream only while the user is pinned to the
  // bottom of the scroll container. ANY scroll away — wheel, touch,
  // scrollbar drag, keyboard (PageUp/arrow/Home/End/space), Find-in-page —
  // un-pins and the next streamed chunks stop yanking them back. They
  // re-pin by scrolling to within a few pixels of the bottom themselves
  // or by sending a new message. The earlier wheel/touchmove-only listener
  // missed scrollbar-drag and keyboard scrolling, which is why a single
  // resistance gesture didn't reliably stop the pull.
  const pinnedToBottomRef = useRef(true);

  useToolInbox$Subscribe();
  const allPendingConfirms = useToolInbox((s) => s.pendingConfirms);
  const allPendingAsks = useToolInbox((s) => s.pendingAsks);
  // Filter pending cards to the active conversation. When the user switches
  // threads, cards from the previous one stay in the store (the SW timeout
  // will eventually clear them) but should NOT render in the new thread's
  // message list. `selectedConversationId === null` matches the
  // pre-conversation state where the very first turn hasn't received its
  // server-assigned id yet.
  const pendingConfirms = useMemo(
    () => allPendingConfirms.filter((c) => c.conversationId === selectedConversationId),
    [allPendingConfirms, selectedConversationId],
  );
  const pendingAsks = useMemo(
    () => allPendingAsks.filter((c) => c.conversationId === selectedConversationId),
    [allPendingAsks, selectedConversationId],
  );

  const [agentsRefreshing, setAgentsRefreshing] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const [a, c] = await Promise.all([fetchUserAgents(user.id), fetchConversationHistory(50)]);
      if (cancelled) return;
      setAgents(a);
      setConversations(c);
      setAgentsLoading(false);

      // Auto-select user's default agent if nothing is currently selected.
      const chat = useChatStore.getState();
      const defaultId = useSettingsStore.getState().defaultAgentId;
      if (!chat.selectedAgentId && defaultId && a.some((x) => x.id === defaultId)) {
        chat.setAgent(defaultId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Manual refresh — engineers iterating on an agent in the dashboard want
  // a way to pull the latest version (system prompt, tools, model, vars)
  // without reloading the whole side panel. Keeps the current selection if
  // the agent still exists in the refreshed list.
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

  const loadedConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedConversationId) {
      // User started a new chat. Forget what we loaded so a later return to
      // the same thread re-fetches its messages.
      loadedConversationIdRef.current = null;
      return;
    }
    if (loadedConversationIdRef.current === selectedConversationId) return;
    // The id can flip null → real mid-stream when the server returns
    // X-Conversation-ID for a brand-new conversation. In that case the
    // messages array already holds the in-flight user turn + pending
    // assistant — don't refetch and clobber them. Just record that this id
    // is now considered "loaded".
    const existing = useChatStore.getState().messages;
    if (existing.length > 0) {
      loadedConversationIdRef.current = selectedConversationId;
      return;
    }
    void (async () => {
      const dbMessages = await fetchConversationMessages(selectedConversationId);
      // Bail if the user switched threads while we were fetching.
      if (useChatStore.getState().selectedConversationId !== selectedConversationId) return;
      setMessages(dbMessagesToChatMessages(dbMessages));
      loadedConversationIdRef.current = selectedConversationId;
    })();
  }, [selectedConversationId, setMessages]);

  // Track distance-from-bottom on every scroll event. Method-agnostic — works
  // for wheel, touch, scrollbar drag, keyboard, and find-in-page alike.
  // 8px tolerance absorbs sub-pixel rounding when content is at the bottom.
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

  // Conversation switch (new chat, agent change, thread pick) re-engages
  // auto-scroll. Fresh thread = fresh scroll behavior.
  useEffect(() => {
    pinnedToBottomRef.current = true;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    // 'auto' (instant) intentionally — smooth-scroll fires intermediate
    // `scroll` events at non-zero distances from bottom that would race
    // the pin detector and incorrectly mark the user as un-pinned mid-
    // animation, suppressing the next streamed chunk's follow.
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }, [messages, pendingConfirms.length, pendingAsks.length]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const firstName = useMemo<string>(() => {
    const full = user?.full_name?.trim();
    if (full) return full.split(' ')[0] ?? '';
    return user?.email?.split('@')[0] ?? '';
  }, [user]);

  const submitMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const agentId = selectedAgentId ?? agents[0]?.id;
    if (!agentId) return;
    if (!selectedAgentId && agentId) setAgent(agentId);
    // Fresh turn → re-engage auto-scroll, even if the user had scrolled away
    // during the previous response.
    pinnedToBottomRef.current = true;
    setDraft('');
    // Pass per-agent variable values along with the message. Empty / missing
    // values are dropped so the server falls back to the agent's defaults.
    const rawVars = getAgentVariables(agentId);
    const variables: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawVars)) {
      if (v && v.trim().length > 0) variables[k] = v;
    }
    const agentName = agents.find((a) => a.id === agentId)?.name;
    void send(trimmed, {
      agentId,
      agentName,
      conversationId: selectedConversationId ?? undefined,
      variables: Object.keys(variables).length > 0 ? variables : undefined,
    });
  };

  const handleNewChat = () => {
    setConversation(null);
    setMessages([]);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <ChatHeader
        agents={agents}
        agentsLoading={agentsLoading}
        agentsRefreshing={agentsRefreshing}
        onRefreshAgents={() => void refreshAgents()}
        selectedAgentId={selectedAgentId}
        selectedConversationId={selectedConversationId}
        conversations={conversations}
        permissionMode={permissionMode}
        onPermissionModeChange={(m) => {
          if (selectedAgentId) setPermissionMode(selectedAgentId, m);
        }}
        onAgentChange={(v) => {
          const next = v || null;
          if (next === selectedAgentId) return;
          if (isStreaming) cancel();
          setAgent(next);
          setConversation(null);
        }}
        onNewChat={handleNewChat}
        onPickConversation={(id) => setConversation(id)}
        hasMessages={messages.length > 0}
        getMessages={() => useChatStore.getState().messages}
        getAgent={() => {
          const a = selectedAgent;
          return a ? { id: a.id, name: a.name } : null;
        }}
      />

      {selectedAgentId && variableDefs.length > 0 && (
        <AgentVariablesPanel agentId={selectedAgentId} defs={variableDefs} />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState
            firstName={firstName}
            onSuggestion={(text) => submitMessage(text)}
            disabled={agents.length === 0}
          />
        ) : (
          <div className="space-y-4 px-4 py-4">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}

            {/*
              Pending approval / ask cards render BELOW the message list
              because they're awaiting user action (no message has been
              produced yet). Filtered to the active conversation in the
              parent — switching threads hides them automatically.
            */}
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
        onSubmit={() => submitMessage(draft)}
        onCancel={() => void cancel()}
        isStreaming={isStreaming}
        canSend={Boolean(selectedAgentId || agents[0]?.id)}
        placeholder={
          selectedAgent
            ? `Message ${selectedAgent.name}…`
            : agents.length === 0
              ? 'No agents available'
              : 'How can I help you today?'
        }
      />
    </div>
  );
}

/**
 * Agent picker — Popover-based replacement for the previous Select.
 *
 * The reason it's not a plain Select: we want three persistent toggle pills
 * (Mine / Shared / System) at the top so the user can scope what's visible
 * without leaving the dropdown. Default is "Mine" only; the user can flip
 * any combo on, and the selection persists in settings.
 *
 * Scope is computed from the AgxAgent fields the RPC already returns
 * (`is_owner`, `shared_by_email`, `access_level`) — see lib/agents/scope.ts.
 */
function AgentPicker({
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

  // Reset the search box when the popover closes so the next open is fresh.
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
  const triggerLabel = selectedAgent?.name ?? 'Select agent';

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
              // Pressing Enter when there's exactly one match selects it.
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
          {ALL_SCOPES.map((scope) => {
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

function ChatHeader({
  agents,
  agentsLoading,
  agentsRefreshing,
  onRefreshAgents,
  selectedAgentId,
  selectedConversationId,
  conversations,
  permissionMode,
  onPermissionModeChange,
  onAgentChange,
  onNewChat,
  onPickConversation,
  hasMessages,
  getMessages,
  getAgent,
}: {
  agents: AgxAgent[];
  agentsLoading: boolean;
  agentsRefreshing: boolean;
  onRefreshAgents: () => void;
  selectedAgentId: string | null;
  selectedConversationId: string | null;
  conversations: Conversation[];
  permissionMode: 'ask' | 'act';
  onPermissionModeChange: (m: 'ask' | 'act') => void;
  onAgentChange: (id: string) => void;
  onNewChat: () => void;
  onPickConversation: (id: string) => void;
  hasMessages: boolean;
  getMessages: () => ChatMessage[];
  getAgent: () => { id: string; name: string } | null;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center px-2">
      {agentsLoading ? (
        <Skeleton className="h-6 w-28" />
      ) : (
        <>
          <AgentPicker
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
        <CopyConversationButton
          getMessages={getMessages}
          getAgent={getAgent}
          disabled={!hasMessages}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          title="New chat"
          onClick={onNewChat}
        >
          <Plus className="size-4" />
        </Button>
        <HistoryMenu
          conversations={conversations}
          selectedId={selectedConversationId}
          onPick={onPickConversation}
        />
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

function HistoryMenu({
  conversations,
  selectedId,
  onPick,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          title="History"
        >
          <History className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent chats
          </span>
          <span className="text-[10px] text-muted-foreground">{conversations.length}</span>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No conversations yet.
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onPick(c.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent',
                  selectedId === c.id && 'bg-accent',
                )}
              >
                <span className="line-clamp-1 w-full text-sm">
                  {c.title?.trim() || 'Untitled chat'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatRelative(c.updated_at)}
                  {typeof c.message_count === 'number' && c.message_count > 0
                    ? ` · ${c.message_count} msg${c.message_count === 1 ? '' : 's'}`
                    : ''}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86_400 * 7) return `${Math.floor(diffSec / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
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

  // Assistant rendering — prefer the parts array (new path: ordered text /
  // reasoning / tool entries arriving via the stream). Fall back to a
  // single `content` block when parts isn't set (DB-hydrated history).
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

  // Build the trailing copy menu from the final concatenated text. Same
  // shape as before — text-only, no tool internals.
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
                label: 'With tool calls',
                description: 'Text plus each tool name + status (no data).',
                getContent: () =>
                  formatAssistantBody(message, {
                    includeToolCalls: true,
                    includeFullToolResults: false,
                    includeThinking: false,
                  }),
              },
              {
                label: 'With everything',
                adminOnly: true,
                description:
                  'Text, thinking, tool calls with full args and results.',
                getContent: () =>
                  formatAssistantBody(message, {
                    includeToolCalls: true,
                    includeFullToolResults: true,
                    includeThinking: true,
                  }),
              },
              {
                label: 'For AI agent',
                ai: true,
                description: 'With agent context',
                getContent: () =>
                  wrapForAgent({
                    description: 'a reply from a Matrx AI agent',
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

/**
 * Renders a single MessagePart at its arrival position. Each type owns
 * its own visual treatment — text uses the chat markdown registry,
 * reasoning gets a muted "thinking" block, tool entries reuse the
 * existing ServerToolRow / ToolTimelineRow components.
 */
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
  // part.type === 'tool'
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

function EmptyState({
  firstName,
  onSuggestion,
  disabled,
}: {
  firstName: string;
  onSuggestion: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col justify-end px-4 pb-2">
      <h1 className="text-3xl font-medium tracking-tight">
        <span className="text-primary">Hello{firstName ? `, ${firstName}` : ''}</span>
      </h1>
      <p className="mt-1 text-2xl text-muted-foreground">How can I help you today?</p>
      <div className="mt-6 flex flex-col items-start gap-2">
        {SUGGESTIONS.map(({ icon: Icon, label }) => (
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
  const recordBaselineRef = useRef('');

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  // Voice input — Groq Whisper streaming via the matrx-frontend route.
  // While recording, every transcribed chunk overwrites the textarea with
  // the baseline text + the running transcript. On stop, whatever's in the
  // input is what gets sent.
  //
  // Failure modes (any of these MUST surface to the user — silent failures
  // are unacceptable):
  //   - getUserMedia rejects in offscreen (NotAllowed / NotFound / etc.) —
  //     forwarded as MIC_EVENT.error → onError → inline banner.
  //   - SW → offscreen forwarding fails (offscreen not yet listening,
  //     transient sendMessage failure) — startRecording's try/catch
  //     surfaces via onError.
  //   - Per-chunk transcription HTTP fails (auth, network, server) —
  //     onChunkError fires; we accumulate failed-chunk count and show
  //     a soft warning so the user can decide to retry.
  //   - Final transcription returned no text — onTranscriptionComplete
  //     fires with empty text; user just sees nothing typed (we leave a
  //     hint).
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);

  const {
    isRecording,
    isTranscribing,
    audioLevel,
    failedChunkCount,
    startRecording,
    stopRecording,
  } = useRecordAndTranscribe({
    streaming: true,
    onChunkTranscribed: (_snippet, accumulated) => {
      const baseline = recordBaselineRef.current;
      const sep = baseline && !baseline.endsWith(' ') ? ' ' : '';
      onChange(`${baseline}${sep}${accumulated}`);
    },
    onChunkError: (idx, msg) => {
      log.error('audio', 'ui: chunk transcription failed', { idx, msg });
      // Don't replace a hard error — keep this as a soft warning unless
      // we're already showing something more important.
      setVoiceWarning(`Some audio failed to transcribe (chunk ${idx}): ${msg}`);
    },
    onError: (msg, code) => {
      log.error('audio', 'ui: mic error', { msg, code });
      // PERMISSION_DENIED means Chrome's native prompt returned 'denied'
      // (or permission has never been granted for this extension). MV3
      // sidepanel + offscreen contexts can't reliably surface Chrome's
      // native getUserMedia prompt, so we open a dedicated popup window
      // instead — a real Chrome window where the prompt fires reliably.
      // Once the user grants there, the side panel auto-retries via the
      // MIC_GRANT_RESULT listener below.
      if (code === 'PERMISSION_DENIED') {
        try {
          void chrome.windows.create({
            url: chrome.runtime.getURL('mic-grant.html'),
            type: 'popup',
            width: 400,
            height: 280,
            focused: true,
          });
        } catch (err) {
          // chrome.windows.create should always succeed in extension
          // contexts; if it doesn't, surface the original mic error so
          // the user sees something rather than a silent no-op.
          log.error('audio', 'ui: failed to open mic-grant popup', err);
          setVoiceError(formatMicErrorForUser(msg, code));
        }
        return;
      }
      setVoiceError(formatMicErrorForUser(msg, code));
    },
  });

  const beginRecording = () => {
    setVoiceError(null);
    setVoiceWarning(null);
    recordBaselineRef.current = value;
    void startRecording();
  };

  // Listen for the mic-grant popup's outcome. On grant we automatically
  // resume recording so the user doesn't have to click the mic button a
  // second time after granting permission. On denial the popup itself
  // tells the user how to fix it; we just leave the side panel idle.
  useEffect(() => {
    const listener = (msg: unknown): boolean | undefined => {
      if (
        typeof msg !== 'object' ||
        msg === null ||
        (msg as Record<string, unknown>).__matrx !== true ||
        (msg as Record<string, unknown>).kind !== CHANNELS.MIC_GRANT_RESULT
      ) {
        return false;
      }
      const payload = (msg as { payload: { granted: boolean } }).payload;
      if (payload?.granted) {
        beginRecording();
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
    // beginRecording closes over `value` (textarea baseline) and
    // `startRecording`. Re-binding is cheap and we want the listener to
    // always reflect the latest baseline — so depend on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Click handler for the mic button.
  //
  // We DON'T pre-flight `getUserMedia` from the sidepanel anymore —
  // Chrome's MV3 sidepanel context rejects the call silently with
  // NotAllowedError without ever showing the native prompt. Instead, we
  // call `beginRecording()` directly, which kicks recording off in the
  // offscreen document. If permission is already granted for the
  // extension origin, offscreen's getUserMedia succeeds silently and the
  // user never sees a prompt. If it's not granted, offscreen's
  // PERMISSION_DENIED error routes through `onError` above, which opens
  // the dedicated mic-grant popup window — the only context where Chrome
  // reliably shows its prompt.
  const handleMicClick = () => {
    log.info('audio', 'mic button clicked', { isRecording });
    if (isRecording) {
      void stopRecording();
      return;
    }
    beginRecording();
  };

  const dismissVoiceMessages = () => {
    setVoiceError(null);
    setVoiceWarning(null);
  };

  const hasText = value.trim().length > 0;

  return (
    <div className="px-3 pb-3 pt-1">
      {(voiceError || (voiceWarning && !voiceError)) && (
        <div
          role="alert"
          className={cn(
            'mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
            voiceError
              ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
          )}
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div className="flex-1 leading-snug">
            <span className="font-medium">
              {voiceError ? 'Voice input failed' : 'Voice input — partial failure'}
            </span>
            <span className="mt-0.5 block opacity-90">
              {voiceError ?? voiceWarning}
            </span>
            {!voiceError && failedChunkCount > 0 && (
              <span className="mt-0.5 block opacity-75">
                {failedChunkCount} chunk{failedChunkCount === 1 ? '' : 's'} dropped — your transcript may be incomplete.
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={dismissVoiceMessages}
            className="ml-1 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      )}
      <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:shadow">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={1}
          className="block max-h-[180px] w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm placeholder:text-muted-foreground focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!isStreaming) onSubmit();
            }
          }}
        />
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <ComposerSettingsChip />

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={handleMicClick}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-full transition-colors',
                isRecording
                  ? 'bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400'
                  : voiceError
                    ? 'text-red-600 hover:bg-red-500/15 dark:text-red-400'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              title={
                voiceError
                  ? voiceError
                  : isRecording
                    ? 'Stop recording'
                    : isTranscribing
                      ? 'Finishing transcription…'
                      : 'Voice input'
              }
              style={
                isRecording
                  ? { boxShadow: `0 0 0 ${Math.min(6, Math.round(audioLevel / 12))}px rgba(239,68,68,0.18)` }
                  : undefined
              }
            >
              {isRecording ? (
                <MicOff className="size-4" />
              ) : isTranscribing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mic className="size-4" />
              )}
            </button>

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
                title={canSend ? 'Send' : 'Select an agent first'}
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChevronDownTiny() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3 opacity-70"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Composer settings popover. Replaces the previous "Fast / Thinking"
 * placeholder with a real menu of per-message behavior toggles. The label
 * summarizes the most distinctive setting that's currently on so the user
 * can scan state without opening the popover.
 */
function ComposerSettingsChip() {
  const autoScrape = useSettingsStore((s) => s.scrapeAutoOnLoad);
  const autoFullScroll = useSettingsStore((s) => s.autoFullScrollOnFirstSubmit);
  const modelOverrideId = useSettingsStore((s) => s.modelOverrideId);
  const setAutoScrape = useSettingsStore((s) => s.setScrapeAutoOnLoad);
  const setAutoFullScroll = useSettingsStore((s) => s.setAutoFullScrollOnFirstSubmit);
  const setModelOverrideId = useSettingsStore((s) => s.setModelOverrideId);

  // Trigger label summarizes the most distinctive choice the user has made.
  // Model override beats page-capture mode because it changes which model
  // answers — way more impactful than how content gets captured.
  const summary = modelOverrideId
    ? (USER_MODEL_LABEL_BY_ID[modelOverrideId] ?? 'Custom model')
    : autoFullScroll
      ? 'Deep page'
      : autoScrape
        ? 'Auto page'
        : 'Customize';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Customize this conversation"
        >
          <Sliders className="size-3.5" />
          {summary}
          <ChevronDownTiny />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-95 p-1" align="start">
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Model
        </div>
        <ModelPresetRow
          active={modelOverrideId === null}
          label="Agent Official"
          hint="Typically the best results for the task"
          onClick={() => setModelOverrideId(null)}
        />
        {USER_MODEL_PRESETS.map((p) => (
          <ModelPresetRow
            key={p.id}
            active={modelOverrideId === p.id}
            label={p.label}
            hint={p.hint}
            onClick={() => setModelOverrideId(p.id)}
          />
        ))}

        <div className="mt-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Page context
        </div>
        <SettingRow
          checked={autoScrape}
          onChange={setAutoScrape}
          title="Auto-capture page on load"
          desc="When a page finishes loading, capture its content + SEO in the background so it's ready in the agent's context the moment you ask. No scroll, fast."
        />
        <SettingRow
          checked={autoFullScroll}
          onChange={setAutoFullScroll}
          title="Deep capture on first submit"
          desc="On your first message about a fresh page, scroll top→bottom to load lazy content, capture, then restore your scroll position — before the message goes out. Adds 1–4s the first time. Subsequent submits reuse the deep capture."
        />
      </PopoverContent>
    </Popover>
  );
}

function ModelPresetRow({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      <div
        className={cn(
          'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border',
          active
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40 bg-transparent',
        )}
      >
        {active && <Check className="size-2.5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] leading-snug text-muted-foreground">{hint}</div>
      </div>
    </button>
  );
}

function SettingRow({
  checked,
  onChange,
  title,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <div
        className={cn(
          'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40 bg-transparent',
        )}
      >
        {checked && <Check className="size-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[11px] leading-snug text-muted-foreground">{desc}</div>
      </div>
    </button>
  );
}
