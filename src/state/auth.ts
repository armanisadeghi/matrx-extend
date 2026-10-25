import type { UserProfile } from '@/lib/auth/types';
import { create } from 'zustand';

interface AuthState {
  user: UserProfile | null;
  isAdmin: boolean;
  status: 'unknown' | 'signed-in' | 'signed-out' | 'signing-in';
  error: string | null;
  /**
   * A saved account exists on this device but could not be restored or verified
   * (usually an expired session). The panel runs as a guest until the person
   * signs in again or chooses to keep going as a guest.
   */
  sessionEnded: boolean;
  setUser: (user: UserProfile | null) => void;
  setIsAdmin: (b: boolean) => void;
  setStatus: (status: AuthState['status']) => void;
  setError: (error: string | null) => void;
  setSessionEnded: (ended: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAdmin: false,
  status: 'unknown',
  error: null,
  sessionEnded: false,
  setUser: (user) => set({ user, status: user ? 'signed-in' : 'signed-out' }),
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setSessionEnded: (sessionEnded) => set({ sessionEnded }),
}));
