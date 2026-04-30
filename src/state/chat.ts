import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  pending?: boolean;
}

interface ChatState {
  selectedAgentId: string | null;
  selectedConversationId: string | null;
  draft: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  setAgent: (id: string | null) => void;
  setConversation: (id: string | null) => void;
  setDraft: (s: string) => void;
  pushMessage: (m: ChatMessage) => void;
  appendAssistantText: (id: string, chunk: string) => void;
  finalizeAssistant: (id: string) => void;
  setStreaming: (b: boolean) => void;
  setMessages: (ms: ChatMessage[]) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      selectedAgentId: null,
      selectedConversationId: null,
      draft: '',
      messages: [],
      isStreaming: false,
      setAgent: (selectedAgentId) => set({ selectedAgentId }),
      setConversation: (selectedConversationId) => set({ selectedConversationId, messages: [] }),
      setDraft: (draft) => set({ draft }),
      pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      appendAssistantText: (id, chunk) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
        })),
      finalizeAssistant: (id) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, pending: false } : m)),
        })),
      setStreaming: (isStreaming) => set({ isStreaming }),
      setMessages: (messages) => set({ messages }),
      reset: () => set({ messages: [], draft: '', isStreaming: false }),
    }),
    {
      name: 'matrx.chat.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
      partialize: (s) => ({
        selectedAgentId: s.selectedAgentId,
        selectedConversationId: s.selectedConversationId,
        draft: s.draft,
      }),
    },
  ),
);
