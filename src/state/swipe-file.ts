import { create } from 'zustand';
export interface SwipeSelection {
  postId: string;
  collectionId?: string;
  organizationId?: string;
}
interface SwipeState {
  selection: SwipeSelection | null;
  select: (selection: SwipeSelection | null) => void;
}
export const useSwipeFileStore = create<SwipeState>((set) => ({
  selection: null,
  select: (selection) => set({ selection }),
}));
