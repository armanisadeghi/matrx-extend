import type { UserProfile } from '@/lib/auth/types';
import { create } from 'zustand';

interface AuthState {
  user: UserProfile | null;
  status: 'unknown' | 'signed-in' | 'signed-out' | 'signing-in';
  error: string | null;
  setUser: (user: UserProfile | null) => void;
  setStatus: (status: AuthState['status']) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'unknown',
  error: null,
  setUser: (user) => set({ user, status: user ? 'signed-in' : 'signed-out' }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
}));
