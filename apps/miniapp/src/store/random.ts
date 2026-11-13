import { create } from 'zustand';
import { api } from '@/api/client';
import type { RandomCredits, RandomMessage, RandomSession } from '@/api/types';

export type Want = 'female' | 'male' | 'everyone';
const WANT_KEY = 'vibe.random.want';
function savedWant(): Want | null {
  try {
    const v = localStorage.getItem(WANT_KEY);
    return v === 'female' || v === 'male' || v === 'everyone' ? v : null;
  } catch {
    return null;
  }
}

type Status = 'idle' | 'waiting' | 'chatting' | 'ended';

interface RandomState {
  status: Status;
  session: RandomSession | null;
  messages: RandomMessage[];
  /** chats left (men without membership); null until known */
  credits: RandomCredits | null;
  /** who to look for this time; null = what the profile says */
  want: Want | null;
  setWant: (w: Want) => void;
  setState: (p: Partial<RandomState>) => void;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  sync: () => Promise<void>;
  onPaired: (s: RandomSession) => void;
  onUpdate: (s: RandomSession) => void;
  onMessage: (sessionId: string, m: RandomMessage) => void;
  onEnded: (sessionId: string) => void;
}

/** Random chat lives in Redis on the server; this mirrors it and is kept current by socket events. */
export const useRandom = create<RandomState>((set, get) => ({
  status: 'idle',
  session: null,
  messages: [],
  credits: null,
  want: savedWant(),
  setWant: (w) => {
    set({ want: w });
    try {
      localStorage.setItem(WANT_KEY, w);
    } catch {
      // private mode: remembered for this session only
    }
  },
  setState: (p) => set(p),
  join: async () => {
    set({ status: 'waiting', messages: [], session: null });
    const want = get().want;
    const r = await api.post<{ status: 'waiting' | 'chatting'; session?: RandomSession }>('/v1/random/join', want ? { want } : {});
    if (r.status === 'chatting' && r.session) {
      set({ status: 'chatting', session: r.session });
      const m = await api.get<{ items: RandomMessage[] }>('/v1/random/messages');
      set({ messages: m.items });
    }
  },
  leave: async () => {
    set({ status: 'idle', session: null, messages: [] });
    await api.post('/v1/random/leave').catch(() => undefined);
  },
  sync: async () => {
    const r = await api.get<{ status: 'idle' | 'waiting' | 'chatting'; session?: RandomSession; credits?: RandomCredits }>('/v1/random/state');
    if (r.credits) set({ credits: r.credits });
    if (r.status === 'chatting' && r.session) {
      const fresh = get().session?.id !== r.session.id;
      set({ status: 'chatting', session: r.session });
      if (fresh) {
        const m = await api.get<{ items: RandomMessage[] }>('/v1/random/messages');
        set({ messages: m.items });
      }
    } else if (r.status === 'waiting') {
      set({ status: 'waiting' });
    } else if (get().status === 'chatting') {
      set({ status: 'ended' });
    } else if (get().status === 'waiting') {
      set({ status: 'idle' });
    }
  },
  onPaired: (s) => set({ status: 'chatting', session: s, messages: [] }),
  onUpdate: (s) => set((st) => (st.session?.id === s.id ? { session: s } : st)),
  onMessage: (sessionId, m) =>
    set((st) => (st.session?.id === sessionId && !st.messages.some((x) => x.id === m.id) ? { messages: [...st.messages, m] } : st)),
  onEnded: (sessionId) => set((st) => (st.session?.id === sessionId ? { status: 'ended' } : st)),
}));
