import { create } from 'zustand';
import type { UserProfile } from '@/lib/auth/types';

interface AuthState {
  user: UserProfile | null;
  isAdmin: boolean;
  status: 'unknown' | 'signed-in' | 'signed-out' | 'signing-in';
  error: string | null;
  setUser: (user: UserProfile | null) => void;
  setIsAdmin: (b: boolean) => void;
  setStatus: (status: AuthState['status']) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAdmin: false,
  status: 'unknown',
  error: null,
  setUser: (user) => set({ user, status: user ? 'signed-in' : 'signed-out' }),
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
}));
