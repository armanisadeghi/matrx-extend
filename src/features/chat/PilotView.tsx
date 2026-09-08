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
import { RenderBlockView } from '@/components/kinds/RenderBlockView';
import { Markdown } from '@/components/markdown';
import { AgentApprovalCard } from '@/features/chat/AgentApprovalCard';
import { AgentAskUserCard } from '@/features/chat/AgentAskUserCard';
import { AgentVariablesPanel } from '@/features/chat/AgentVariablesPanel';
import { CopyConversationButton } from '@/features/chat/CopyConversationButton';
import { LanguagePicker } from '@/features/chat/LanguagePicker';
import { ServerToolRow } from '@/features/chat/ServerToolRow';
import { SpeakerButton } from '@/features/chat/SpeakerButton';
import { ToolTimelineRow } from '@/features/chat/ToolTimelineRow';
import { formatAssistantBody } from '@/features/chat/copy-conversation';
import { TaskPanel, TaskPanelChip } from '@/features/lists/TaskPanel';
import { useAgentExecution } from '@/hooks/use-agent-execution';
import { useAuth } from '@/hooks/use-auth';
import { usePilotChatStream } from '@/hooks/use-pilot-chat-stream';
import { useToolInbox$Subscribe } from '@/hooks/use-tool-inbox';
import { useAgentRow } from '@/lib/agents/use-agent-row';
import { wrapForAgent } from '@/lib/clipboard/copy';
import { warmContentIr } from '@/lib/content-ir/route-env';
import { DEFAULT_CHAT_MANDATE_KEY, DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';
import { cn } from '@/lib/utils';
import type { ChatMessage, MessagePart } from '@/state/chat';
import { useListsSubscriber } from '@/state/lists';
import { usePilotStore } from '@/state/pilot';
import { usePilotChatStore } from '@/state/pilot-chat';
import { useSettingsStore } from '@/state/settings';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { useToolInbox } from '@/state/tool-inbox';
import { AgentListDropdown, useAgentCatalog } from '@ai-matrx/agents/catalog/react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@ai-matrx/design-system';
import {
  AlertTriangle,
  ArrowUp,
  Check,
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
  // One warm load per session for the Content IR registries — see ChatView.
  useEffect(() => warmContentIr(), []);
  const { user, isAdmin } = useAuth();
  const { selectedAgentId, draft, messages, isStreaming, setAgent, setDraft, setMessages } =
    usePilotChatStore();
  const pilotTabActive = useSidepanelTabStore((s) => s.tab) === 'pilot';
  const streamInterruption = usePilotChatStore((s) => s.streamInterruption);
  const setStreamInterruption = usePilotChatStore((s) => s.setStreamInterruption);
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

  const catalog = useAgentCatalog();
  const [agentsRefreshing, setAgentsRefreshing] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [groupTabCount, setGroupTabCount] = useState<number | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  useToolInbox$Subscribe();
  const allPendingConfirms = useToolInbox((s) => s.pendingConfirms);
  const allPendingAsks = useToolInbox((s) => s.pendingAsks);
  // The pilot view has its own conversation — filter inbox cards to it.
  // Cards from a stale assistant chat or a previous pilot session must
  // not bleed into the active pilot turn.
  const pilotConversationId = session.conversationId;
  useListsSubscriber(pilotConversationId, pilotTabActive);
  const pendingConfirms = useMemo(
    () => allPendingConfirms.filter((c) => c.conversationId === pilotConversationId),
    [allPendingConfirms, pilotConversationId],
  );
  const pendingAsks = useMemo(
    () => allPendingAsks.filter((c) => c.conversationId === pilotConversationId),
    [allPendingAsks, pilotConversationId],
  );

  useEffect(() => {
    // The package catalog owns the list read for every picker in this panel.
    void catalog.ensureLoaded();

    // Auto-select the user's saved default target if nothing is chosen yet.
    const chat = usePilotChatStore.getState();
    const defaultId = useSettingsStore.getState().defaultAgentId;
    if (!chat.selectedAgentId && defaultId) chat.setAgent(defaultId);
  }, [catalog]);

  const refreshAgents = async () => {
    if (agentsRefreshing) return;
    setAgentsRefreshing(true);
    try {
      await catalog.ensureLoaded({ force: true });
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

  // Always a real target: an explicit agent id, or this client's platform
  // default Mandate. The NAME comes live from the package.
  const runTargetId = selectedAgentId ?? DEFAULT_CHAT_MANDATE_REF;
  const selectedAgent = useAgentRow(runTargetId);

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
    const agentId = runTargetId;
    if (!selectedAgentId) setAgent(agentId);
    pinnedToBottomRef.current = true;
    setDraft('');
    const rawVars = getAgentVariables(agentId);
    const variables: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawVars)) {
      if (v && v.trim().length > 0) variables[k] = v;
    }
    const agentName = selectedAgent.name ?? undefined;
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
      ...(agentName !== undefined && { agentName }),
      ...(session.conversationId != null && { conversationId: session.conversationId }),
      ...(Object.keys(variables).length > 0 && { variables }),
      assignedTabId: tabId,
    });
  };

  const handleNewChat = () => {
    usePilotChatStore.getState().setConversation(null);
    usePilotStore.getState().setConversationId(null);
    setMessages([]);
  };

  const handleStartSession = async () => {
    const agentId = runTargetId;
    setSessionError(null);
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
          The Pilot surface drives a sandboxed Chrome tab group with the full read+action+ask agent
          toolkit. It will graduate to general availability once the rough edges are sanded.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-background">
      {streamInterruption && !isStreaming && (
        // Stall notice (audit P3-13) — the Pilot spinner used to vanish with
        // zero explanation when the watchdog gave up on a silent stream.
        <div className="mx-3 mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          <span>The run went silent and was stopped. Send your message again to retry.</span>
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-amber-200/50 dark:hover:bg-amber-800/40"
            onClick={() => setStreamInterruption(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="absolute right-2 top-1 z-30">
        <TaskPanelChip
          conversationId={pilotConversationId}
          onClick={() => setTaskPanelOpen((v) => !v)}
        />
      </div>
      <TaskPanel
        conversationId={pilotConversationId}
        open={taskPanelOpen}
        onClose={() => setTaskPanelOpen(false)}
      />
      <PilotHeader
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
        hasMessages={messages.length > 0}
        getMessages={() => usePilotChatStore.getState().messages}
        getAgent={() => (selectedAgent.name ? { id: runTargetId, name: selectedAgent.name } : null)}
      />

      {selectedAgentId && variableDefs.length > 0 && (
        <AgentVariablesPanel agentId={selectedAgentId} defs={variableDefs} />
      )}

      {sessionError && (
        <div
          role="alert"
          className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div className="flex-1 leading-snug">{sessionError}</div>
          <button
            type="button"
            onClick={() => setSessionError(null)}
            className="ml-1 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <PilotEmptyState
            firstName={firstName}
            sessionActive={session.active}
            onSuggestion={(text) => void submitMessage(text)}
            disabled={!session.active}
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
        canSend={session.active}
        placeholder={
          !session.active
            ? 'Start a Pilot session to begin.'
            : selectedAgent.name
              ? `Pilot ${selectedAgent.name}…`
              : selectedAgent.resolving
                ? 'Naming the agent…'
                : 'How should the agent drive the sandbox?'
        }
      />
    </div>
  );
}

function PilotHeader({
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
  hasMessages,
  getMessages,
  getAgent,
}: {
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
  hasMessages: boolean;
  getMessages: () => ChatMessage[];
  getAgent: () => { id: string; name: string } | null;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center px-2">
      {/* THE ONE agent picker (@ai-matrx/agents/catalog/react) — its own
          consumer id so Pilot's tab/sort/filter state is separate from Chat's. */}
      <AgentListDropdown
        consumerId="extend.pilot"
        activeAgentId={selectedAgentId}
        onSelect={onAgentChange}
        defaultMandateKey={DEFAULT_CHAT_MANDATE_KEY}
        compact
        noBorder
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
                description: 'Text, thinking, tool calls with full args and results.',
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
  if (part.type === 'block') {
    // Server-built structured content — routed through the SHARED kind route.
    return <RenderBlockView block={part.block} />;
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
        progress: t.progress,
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
          The Pilot surface drives a sandboxed Chrome tab group with the full read+action+ask agent
          toolkit. Click <strong>Start Pilot</strong> in the header to open a fresh group seeded
          with the active tab.
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          The agent can only act on tabs inside that group. Close the group (or click{' '}
          <strong>End</strong>) to release control.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-[60vh] flex-col justify-end px-4 pb-2">
      <h1 className="text-3xl font-medium tracking-tight">
        <span className="text-primary">Ready{firstName ? `, ${firstName}` : ''}</span>
      </h1>
      <p className="mt-1 text-2xl text-muted-foreground">How should the Pilot drive the sandbox?</p>
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
    // Skip measurement while the forceMounted tab is hidden — scrollHeight
    // is 0 under display:none and the latched 0px height left the composer
    // a clipped sliver until the first keystroke.
    if (el.offsetParent === null) return;
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
