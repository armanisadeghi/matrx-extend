import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useChatStream } from '@/hooks/use-chat-stream';
import {
  type AgxAgent,
  type Conversation,
  dbMessagesToChatMessages,
  fetchConversationHistory,
  fetchConversationMessages,
  fetchUserAgents,
} from '@/lib/supabase/queries';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/state/chat';
import {
  ArrowUp,
  History,
  Lightbulb,
  Mic,
  Pencil,
  Plus,
  ScanLine,
  Sparkles,
  Square,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SUGGESTIONS = [
  { icon: Pencil, label: 'Help me with my writing' },
  { icon: Sparkles, label: 'Brainstorm ideas with me' },
  { icon: Lightbulb, label: 'Help me make a decision' },
  { icon: ScanLine, label: 'Analyze the current page' },
];

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
  const [agents, setAgents] = useState<AgxAgent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const [a, c] = await Promise.all([fetchUserAgents(user.id), fetchConversationHistory(50)]);
      if (cancelled) return;
      setAgents(a);
      setConversations(c);
      setAgentsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!selectedConversationId) return;
    void (async () => {
      const dbMessages = await fetchConversationMessages(selectedConversationId);
      setMessages(dbMessagesToChatMessages(dbMessages));
    })();
  }, [selectedConversationId, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

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
    setDraft('');
    void send(trimmed, {
      agentId,
      conversationId: selectedConversationId ?? undefined,
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
        selectedAgentId={selectedAgentId}
        selectedConversationId={selectedConversationId}
        conversations={conversations}
        onAgentChange={(v) => setAgent(v || null)}
        onNewChat={handleNewChat}
        onPickConversation={(id) => setConversation(id)}
      />

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
              <MessageRow key={m.id} role={m.role} content={m.content} pending={m.pending} />
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

function ChatHeader({
  agents,
  agentsLoading,
  selectedAgentId,
  selectedConversationId,
  conversations,
  onAgentChange,
  onNewChat,
  onPickConversation,
}: {
  agents: AgxAgent[];
  agentsLoading: boolean;
  selectedAgentId: string | null;
  selectedConversationId: string | null;
  conversations: Conversation[];
  onAgentChange: (id: string) => void;
  onNewChat: () => void;
  onPickConversation: (id: string) => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center px-2">
      {agentsLoading ? (
        <Skeleton className="h-6 w-28" />
      ) : (
        <Select value={selectedAgentId ?? ''} onValueChange={onAgentChange}>
          <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent focus:ring-0 [&>span]:truncate">
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.length === 0 && (
              <SelectItem value="__none__" disabled>
                No agents — create one in Matrx
              </SelectItem>
            )}
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="ml-auto flex items-center">
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

function MessageRow({
  role,
  content,
  pending,
}: {
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    );
  }
  return (
    <div className="prose prose-sm max-w-none text-sm dark:prose-invert prose-p:my-2 prose-pre:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content || (pending ? '…' : '')}
      </ReactMarkdown>
    </div>
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
  const [mode, setMode] = useState<'fast' | 'thinking'>('fast');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const showComingSoon = (feature: string) => {
    window.alert(`${feature} — coming soon`);
  };

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
          className="block max-h-[180px] w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm placeholder:text-muted-foreground focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!isStreaming) onSubmit();
            }
          }}
        />
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <button
            type="button"
            onClick={() => showComingSoon('Attachments')}
            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Attach"
          >
            <Plus className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === 'fast' ? 'thinking' : 'fast')}
            className="ml-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Mode"
          >
            {mode === 'fast' ? 'Fast' : 'Thinking'}
            <ChevronDownTiny />
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => showComingSoon('Voice input')}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Voice input"
            >
              <Mic className="size-4" />
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

