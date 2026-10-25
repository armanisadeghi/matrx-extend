/**
 * The side panel's Chat tab on `@ai-matrx/chat` (W1/W2): the package's history,
 * new-chat screen and conversation room over the extension host (`./host`).
 * The only extension UI here is the browser-tool prompt dock — approval,
 * question and credential cards raised by THIS browser's tool dispatcher.
 */

import { AgentApprovalCard } from '@/features/chat/AgentApprovalCard';
import { AgentAskUserCard } from '@/features/chat/AgentAskUserCard';
import { useAuth } from '@/hooks/use-auth';
import { useToolInbox$Subscribe } from '@/hooks/use-tool-inbox';
import { SessionNotReadyError } from '@/lib/api/session-credentials';
import { captureSpec, dismissCapture, saveCapture } from '@/lib/credentials/capture-card-host';
import { useToolInbox } from '@/state/tool-inbox';
import { ChatConversationRoom } from '@ai-matrx/chat/agents/components/chat/ChatConversationRoom';
import { ChatNewClient } from '@ai-matrx/chat/agents/components/chat/ChatNewClient';
import { useConversationTitle } from '@ai-matrx/chat/agents/hooks/useConversationTitle';
import { CredentialCaptureCard } from '@ai-matrx/chat/agents/ui-first-tools/ui/CredentialCaptureCard';
import type { ChatHost } from '@ai-matrx/chat/host';
import { ChatProvider, usePathname, useRouter } from '@ai-matrx/chat/host/react';
import { ConversationSidebar } from '@ai-matrx/chat/sidebar/ConversationSidebar';
import { type SidebarEntry, openSidebarEntryOnWeb } from '@ai-matrx/chat/sidebar/sidebar-buckets';
import { Button } from '@ai-matrx/design-system';
import { withReferral } from '@ai-matrx/kit/outbound';
import { PanelLeft, PanelLeftClose, SquarePen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ExtensionTabLayer } from './canvas-tabs';
import { createExtensionChatHost } from './host';

/** Approval / ask / capture cards for the OPEN conversation only (each card names its conversation). */
export function BrowserToolPrompts({ conversationId }: { conversationId: string | null }) {
  useToolInbox$Subscribe();
  const mine = <T extends { conversationId: string | null }>(items: readonly T[]) =>
    items.filter((item) => item.conversationId === conversationId);
  const confirms = mine(useToolInbox((s) => s.pendingConfirms));
  const asks = mine(useToolInbox((s) => s.pendingAsks));
  const captures = mine(useToolInbox((s) => s.pendingCaptures));
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

/** The sidebar's entries have no page in the panel: they open on the web (the package's one entry map), in a browser tab. A tab that cannot open is the sidebar's one status line. */
function openEntryOnWeb(entry: SidebarEntry) {
  return openSidebarEntryOnWeb(entry, 'https://www.aimatrx.com', async (url) => {
    await chrome.tabs.create({ url: withReferral(url) });
  });
}

/**
 * One slim bar above the chat: the history toggle, the open conversation's
 * title, and New chat — aligned on a single row with a hairline under it.
 */
function ChatHeader({
  conversationId,
  historyOpen,
  onToggleHistory,
  onNewChat,
}: {
  conversationId: string | null;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
}) {
  const title = useConversationTitle(historyOpen ? null : conversationId);
  const label = historyOpen ? 'Chats' : conversationId ? (title ?? '') : 'New chat';
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label={historyOpen ? 'Close chats' : 'Chats'}
        title={historyOpen ? 'Close chats' : 'Chats'}
        aria-pressed={historyOpen}
        onClick={onToggleHistory}
      >
        {historyOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
      </Button>
      <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-foreground">
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label="New chat"
        title="New chat"
        onClick={onNewChat}
      >
        <SquarePen className="size-4" />
      </Button>
    </div>
  );
}

function Screens() {
  const pathname = usePathname();
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const conversationId = pathname.match(/^\/chat\/([0-9a-f-]{36})/)?.[1] ?? null;
  return (
    <div data-package-chat="" className="relative flex h-full min-h-0 flex-col">
      <ExtensionTabLayer />
      <ChatHeader
        conversationId={conversationId}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((o) => !o)}
        onNewChat={() => {
          setHistoryOpen(false);
          router.push('/chat');
        }}
      />
      {historyOpen ? (
        <ConversationSidebar
          activeConversationId={conversationId}
          onOpenConversation={(conversation) => {
            setHistoryOpen(false);
            router.push(`/chat/${conversation.id}`);
          }}
          onNew={() => {
            setHistoryOpen(false);
            router.push('/chat');
          }}
          onEntry={openEntryOnWeb}
          className="min-h-0 flex-1"
        />
      ) : (
        <>
          <BrowserToolPrompts conversationId={conversationId} />
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
  const { user, sessionEnded, status } = useAuth();
  // Build once the boot has said who this is, so a signed-in open never builds a guest host first.
  const authKnown = status !== 'unknown';
  const [host, setHost] = useState<ChatHost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id ?? null;
  // The host carries who is speaking, so it is rebuilt when the person signs in, signs out,
  // or chooses to keep going as a guest — never left holding the account that just ended.
  // biome-ignore lint/correctness/useExhaustiveDependencies: userId and attempt are rebuild triggers
  useEffect(() => {
    if (sessionEnded || !authKnown) return;
    let live = true;
    setHost(null);
    setError(null);
    createExtensionChatHost().then(
      (h) => live && setHost(h),
      (e: unknown) => {
        if (!live) return;
        setError(
          e instanceof SessionNotReadyError
            ? 'Your session is still connecting.'
            : e instanceof Error
              ? e.message
              : String(e),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [userId, sessionEnded, authKnown, attempt]);
  // The account card above the panel offers Sign in / Use as guest; the chat waits for that choice.
  if (sessionEnded) return null;
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted-foreground">Chat couldn't open. {error}</p>
        <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  if (!host) return null;
  return (
    <ChatProvider host={host}>
      <Screens />
    </ChatProvider>
  );
}
