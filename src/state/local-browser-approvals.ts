import { create } from 'zustand';

export type LocalBrowserApprovalView = {
  approvalContextId: string;
  operation: 'navigate' | 'inspect_login' | 'vault_login' | 'authenticator';
  origin?: string;
  fieldSummary?: string;
  tier: 'read' | 'action' | 'ask-user' | 'privileged';
  deadlineMs: number;
};

type LocalBrowserApprovalState = {
  approvals: Record<string, LocalBrowserApprovalView>;
  show: (approval: LocalBrowserApprovalView) => void;
  remove: (approvalContextId: string) => void;
  clear: () => void;
};

/** Ephemeral sidepanel projection. Do not add persist middleware or command data. */
export const useLocalBrowserApprovals = create<LocalBrowserApprovalState>((set) => ({
  approvals: {},
  show: (approval) =>
    set((state) => ({ approvals: { ...state.approvals, [approval.approvalContextId]: approval } })),
  remove: (approvalContextId) =>
    set((state) => {
      const { [approvalContextId]: _removed, ...approvals } = state.approvals;
      return { approvals };
    }),
  clear: () => set({ approvals: {} }),
}));
