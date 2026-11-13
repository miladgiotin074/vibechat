import { create } from 'zustand';
import type { Conversation } from '@/api/types';

export interface Toast {
  id: number;
  text: string;
  emoji?: string;
  tone?: 'default' | 'success' | 'error';
  onClick?: () => void;
}

interface UiState {
  toasts: Toast[];
  /** "It's a match!" overlay. */
  match: (Conversation & { superLike?: boolean }) | null;
  /** Live badge counters (kept fresh by the socket). */
  badges: { likes: number; chats: number; notifications: number };
  /** Someone is typing, per match id → timestamp. */
  typing: Record<string, number>;
  /** The home-page spotlight tutorial is showing. */
  tour: boolean;
  setTour: (open: boolean) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  showMatch: (m: UiState['match']) => void;
  setBadges: (b: Partial<UiState['badges']>) => void;
  setTyping: (matchId: string) => void;
}

let seq = 0;

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  match: null,
  badges: { likes: 0, chats: 0, notifications: 0 },
  typing: {},
  tour: false,
  setTour: (tour) => set({ tour }),
  toast: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  showMatch: (match) => set({ match }),
  setBadges: (b) => set((s) => ({ badges: { ...s.badges, ...b } })),
  setTyping: (matchId) => set((s) => ({ typing: { ...s.typing, [matchId]: Date.now() } })),
}));

export const toast = (text: string, emoji?: string, tone?: Toast['tone']) => useUi.getState().toast({ text, emoji, tone });
