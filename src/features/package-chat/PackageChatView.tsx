/**
 * The side panel's Chat tab on `@ai-matrx/chat` (W1/W2): the package's history,
 * new-chat screen and conversation room over the extension host (`./host`).
 * The only extension UI here is the browser-tool prompt dock — approval,
 * question and credential cards raised by THIS browser's tool dispatcher.
 */

import { AgentApprovalCard } from '@/features/chat/AgentApprovalCard';
import { AgentAskUserCard } from '@/features/chat/AgentAskUserCard';
import { useToolInbox$Subscribe } from '@/hooks/use-tool-inbox';
import { captureSpec, dismissCapture, saveCapture } from '@/lib/credentials/capture-card-host';
import { useToolInbox } from '@/state/tool-inbox';
import { ChatConversationRoom } from '@ai-matrx/chat/agents/components/chat/ChatConversationRoom';
import { ChatHistorySidebar } from '@ai-matrx/chat/agents/components/chat/ChatHistorySidebar';
import { ChatNewClient } from '@ai-matrx/chat/agents/components/chat/ChatNewClient';
import { CredentialCaptureCard } from '@ai-matrx/chat/agents/ui-first-tools/ui/CredentialCaptureCard';
import type { ChatHost } from '@ai-matrx/chat/host';
import { ChatProvider, usePathname, useRouter } from '@ai-matrx/chat/host/react';
import { Button } from '@ai-matrx/design-system';
import { History, SquarePen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createExtensionChatHost } from './host';

function BrowserToolPrompts() {
  useToolInbox$Subscribe();
  const confirms = useToolInbox((s) => s.pendingConfirms);
  const asks = useToolInbox((s) => s.pendingAsks);
  const captures = useToolInbox((s) => s.pendingCaptures);
  if (confirms.length + asks.length + captures.length === 0) return null;
  return (
    <div data-browser-tool-prompts="" className="flex shrink-0 flex-col gap-2 px-3 py-2">
      {confirms.map((req) => (
        <AgentApprovalCard key={req.callId} req={req} />
      ))}
      {asks.map((req) => (
        <AgentAskUserCard key={req.callId} req={req} />
      ))}
      {captures.map((req) => (
        <CredentialCaptureCard
          key={req.callId}
          spec={captureSpec(req)}
          save={(values) => saveCapture(req, values)}
          dismiss={(reason) => dismissCapture(req, reason)}
        />
      ))}
    </div>
  );
}

function Screens() {
  const pathname = usePathname();
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const conversationId = pathname.match(/^\/chat\/([0-9a-f-]{36})/)?.[1] ?? null;
  return (
    <div data-package-chat="" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Conversations"
          aria-pressed={historyOpen}
          onClick={() => setHistoryOpen((o) => !o)}
        >
          <History className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="New chat"
          onClick={() => {
            setHistoryOpen(false);
            router.push('/chat');
          }}
        >
          <SquarePen className="size-4" />
        </Button>
      </div>
      {historyOpen ? (
        <ChatHistorySidebar
          scopeId="matrx-extend-side-panel"
          openInPlace
          activeConversationId={conversationId}
          onOpenConversation={(conversation) => {
            setHistoryOpen(false);
            router.push(`/chat/${conversation.conversationId}`);
          }}
          className="min-h-0 flex-1"
        />
      ) : (
        <>
          <BrowserToolPrompts />
          <div className="min-h-0 flex-1">
            {conversationId ? (
              <ChatConversationRoom
                key={conversationId}
                conversationId={conversationId}
                agentId={null}
                ownedByMandate={false}
              />
            ) : (
              <ChatNewClient agentId={null} composer={{ initialMode: null }} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function PackageChatView() {
  const [host, setHost] = useState<ChatHost | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    createExtensionChatHost().then(
      (h) => live && setHost(h),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  if (error) return <p className="p-3 text-sm text-destructive">Chat could not start: {error}</p>;
  if (!host) return null;
  return (
    <ChatProvider host={host}>
      <Screens />
    </ChatProvider>
  );
}
