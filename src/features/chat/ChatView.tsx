import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useChatStream } from '@/hooks/use-chat-stream';
import {
  type AgentPrompt,
  type Conversation,
  dbMessagesToChatMessages,
  fetchConversationHistory,
  fetchConversationMessages,
  fetchUserAgents,
} from '@/lib/supabase/queries';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/state/chat';
import { Bot, History, Send, StopCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  const [agents, setAgents] = useState<AgentPrompt[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const [a, c] = await Promise.all([fetchUserAgents(user.id), fetchConversationHistory(30)]);
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

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void send(text, {
      promptId: selectedAgentId ?? undefined,
      conversationId: selectedConversationId ?? undefined,
      agentMode: !!selectedAgentId,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <Bot className="size-4 text-muted-foreground" />
        {agentsLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select
            value={selectedAgentId ?? 'default'}
            onValueChange={(v) => setAgent(v === 'default' ? null : v)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select agent…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default chat (no agent)</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="icon"
          variant="ghost"
          title="Conversation history"
          onClick={() => {
            // For v1, cycle through last conversations.
            const next = conversations[0];
            if (next) setConversation(next.id);
          }}
        >
          <History className="size-4" />
        </Button>
      </div>

      {selectedAgent?.description ? (
        <div className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {selectedAgent.description}
        </div>
      ) : null}

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {messages.length === 0 && (
            <div className="grid place-items-center py-12 text-sm text-muted-foreground">
              {selectedAgent ? `Chat with ${selectedAgent.name}.` : 'Start a conversation.'}
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm',
                m.role === 'user' ? 'bg-card' : 'bg-muted/30',
              )}
            >
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {m.role}
              </div>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.content || (m.pending ? '…' : '')}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t bg-card p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={selectedAgent ? `Message ${selectedAgent.name}…` : 'Send a message…'}
            className="min-h-[60px] max-h-[180px] resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          {isStreaming ? (
            <Button onClick={() => void cancel()} variant="destructive" size="icon" title="Stop">
              <StopCircle className="size-4" />
            </Button>
          ) : (
            <Button onClick={handleSend} disabled={!draft.trim()} size="icon" title="Send (⌘↵)">
              <Send className="size-4" />
            </Button>
          )}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">⌘+Enter to send</div>
      </div>
    </div>
  );
}
