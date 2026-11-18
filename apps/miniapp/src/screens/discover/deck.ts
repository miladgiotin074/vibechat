import { create } from 'zustand';
import { api, ApiError } from '@/api/client';
import { keys, queryClient } from '@/api/queries';
import type { Card, ChatStarted } from '@/api/types';

interface DeckState {
  cards: Card[];
  loading: boolean;
  exhausted: boolean;
  /** people skipped long ago are being shown again (there was nobody new left) */
  recycled: boolean;
  error: string | null;
  load: (force?: boolean) => Promise<void>;
  /** Not for me: take the card away and remember it. */
  skip: (card: Card) => Promise<void>;
  /** Write to them: the conversation opens with this as its first message. */
  message: (card: Card, text: string) => Promise<ChatStarted>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
}

const seen = new Set<string>();

/**
 * The card queue. The server keeps the real deck in Redis; we hold a few cards ahead so the next
 * one is there instantly, and top up in the background when it runs low.
 */
export const useDeck = create<DeckState>((set, get) => ({
  cards: [],
  loading: false,
  exhausted: false,
  recycled: false,
  error: null,
  load: async (force) => {
    const s = get();
    if (s.loading || (!force && s.cards.length >= 5)) return;
    set({ loading: true, error: null });
    try {
      const r = await api.get<{ items: Card[]; exhausted: boolean; widened?: 'recycled' | null }>('/v1/discover?limit=12');
      const fresh = r.items.filter((c) => !seen.has(c.id) && !get().cards.some((x) => x.id === c.id));
      // warm the image cache so the next cards appear instantly
      for (const c of fresh.slice(0, 4)) c.photos.slice(0, 2).forEach((p) => (new Image().src = p.md));
      set((st) => ({
        cards: [...st.cards, ...fresh],
        exhausted: r.exhausted && st.cards.length + fresh.length === 0,
        recycled: r.widened === 'recycled',
        loading: false,
      }));
    } catch (e) {
      set({ loading: false, error: e instanceof ApiError ? e.message : 'خطا در دریافت پروفایل‌ها' });
    }
  },
  skip: async (card) => {
    seen.add(card.id);
    set((st) => ({ cards: st.cards.filter((c) => c.id !== card.id) }));
    if (get().cards.length < 5) void get().load();
    try {
      await api.post('/v1/discover/skip', { targetId: card.id });
    } catch {
      // the card is gone from this screen either way; the server will simply offer them again
    }
  },
  message: async (card, text) => {
    const r = await api.post<ChatStarted>('/v1/discover/chat', { targetId: card.id, text });
    seen.add(card.id);
    set((st) => ({ cards: st.cards.filter((c) => c.id !== card.id) }));
    void queryClient.invalidateQueries({ queryKey: keys.conversations });
    void queryClient.invalidateQueries({ queryKey: keys.me });
    if (get().cards.length < 5) void get().load();
    return r;
  },
  reset: async () => {
    await api.post('/v1/discover/reset').catch(() => undefined);
    seen.clear();
    set({ cards: [], exhausted: false });
    await get().load(true);
  },
  /** Pull to refresh: the server builds the deck again and the card on screen stays. */
  refresh: async () => {
    await api.post('/v1/discover/reset').catch(() => undefined);
    set((st) => ({ cards: st.cards.slice(0, 1), exhausted: false, error: null }));
    await get().load(true);
  },
}));
