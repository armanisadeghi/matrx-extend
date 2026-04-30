import type { DesktopHealth } from '@/lib/desktop/types';
import { create } from 'zustand';

interface DesktopState {
  transport: 'native' | 'http' | 'none';
  health: DesktopHealth | null;
  lastChecked: number;
  set: (state: Partial<DesktopState>) => void;
}

export const useDesktopStore = create<DesktopState>((set) => ({
  transport: 'none',
  health: null,
  lastChecked: 0,
  set: (state) => set(state),
}));
