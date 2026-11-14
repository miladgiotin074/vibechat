import { create } from 'zustand';
import { api, ApiError } from '@/api/client';
import { getMe, queryClient, keys } from '@/api/queries';
import type { Card, Me, SwipeResult } from '@/api/types';

export type SwipeAction = 'like' | 'pass' | 'superlike';

interface DeckState {
  cards: Card[];
  loading: boolean;
  exhausted: boolean;
  /** the user's own area ran dry (province / whole country), or people passed long ago came back */
  widened: 'province' | 'country' | 'recycled' | null;
  error: string | null;
  /**
   * Set when a like/super like was refused: `like` = a man's free likes are used up (add friends
   * or go premium), `likeDaily` = a member's cap for today, `superlike` = no super likes left.
   */
  limit: { kind: 'like' | 'likeDaily' | 'superlike'; resetInSeconds?: number } | null;
  load: (force?: boolean) => Promise<void>;
  swipe: (card: Card, action: SwipeAction) => Promise<SwipeResult | null>;
  rewind: () => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
  clearLimit: () => void;
}

const seen = new Set<string>();

/**
 * The card queue. The server keeps the real deck in Redis; we hold a few cards ahead so swiping
 * never waits for the network, and top up in the background when it runs low.
 */
export const useDeck = create<DeckState>((set, get) => ({
  cards: [],
  loading: false,
  exhausted: false,
  widened: null,
  error: null,
  limit: null,
  load: async (force) => {
    const s = get();
    if (s.loading || (!force && s.cards.length >= 5)) return;
    set({ loading: true, error: null });
    try {
      const r = await api.get<{ items: Card[]; exhausted: boolean; widened?: 'province' | 'country' | 'recycled' | null }>('/v1/discover?limit=12');
      const fresh = r.items.filter((c) => !seen.has(c.id) && !get().cards.some((x) => x.id === c.id));
      // warm the image cache so the next cards appear instantly
      for (const c of fresh.slice(0, 4)) c.photos.slice(0, 2).forEach((p) => (new Image().src = p.md));
      set((st) => ({
        cards: [...st.cards, ...fresh],
        exhausted: r.exhausted && st.cards.length + fresh.length === 0,
        widened: r.widened ?? null,
        loading: false,
      }));
    } catch (e) {
      set({ loading: false, error: e instanceof ApiError ? e.message : 'خطا در دریافت پروفایل‌ها' });
    }
  },
  swipe: async (card, action) => {
    seen.add(card.id);
    set((st) => ({ cards: st.cards.filter((c) => c.id !== card.id) }));
    if (get().cards.length < 5) void get().load();
    try {
      const r = await api.post<SwipeResult>('/v1/swipes', { targetId: card.id, action });
      // if this person had liked me, the Likes page shows my answer on their like
      void queryClient.invalidateQueries({ queryKey: keys.likes });
      const me = getMe();
      if (me) {
        queryClient.setQueryData<Me>(keys.me, {
          ...me,
          limits: {
            ...me.limits,
            likesLeft: r.likesLeft !== undefined ? r.likesLeft : me.limits.likesLeft,
            superLikesLeft: r.superLikesLeft ?? me.limits.superLikesLeft,
            bonusSuperLikes: r.bonusSuperLikes ?? me.limits.bonusSuperLikes,
          },
        });
      }
      return r;
    } catch (e) {
      // put the card back on top and explain
      seen.delete(card.id);
      set((st) => ({ cards: [card, ...st.cards] }));
      if (e instanceof ApiError && (e.code === 'like_limit' || e.code === 'like_daily_limit' || e.code === 'superlike_limit')) {
        const details = e.details as { resetInSeconds?: number } | undefined;
        const kind = e.code === 'like_limit' ? 'like' : e.code === 'like_daily_limit' ? 'likeDaily' : 'superlike';
        set({ limit: { kind, resetInSeconds: details?.resetInSeconds } });
        return null;
      }
      throw e;
    }
  },
  rewind: async () => {
    const r = await api.post<{ item: Card | null }>('/v1/swipes/rewind');
    void queryClient.invalidateQueries({ queryKey: keys.likes });
    if (r.item) {
      seen.delete(r.item.id);
      set((st) => ({ cards: [r.item!, ...st.cards.filter((c) => c.id !== r.item!.id)] }));
    }
  },
  reset: async () => {
    await api.post('/v1/discover/reset').catch(() => undefined);
    seen.clear();
    set({ cards: [], exhausted: false });
    await get().load(true);
  },
  /**
   * Pull to refresh: the server rebuilds the deck (people who joined or changed since it was
   * built come in, the order is worked out again) and the card on screen stays where it is.
   */
  refresh: async () => {
    await api.post('/v1/discover/reset').catch(() => undefined);
    set((st) => ({ cards: st.cards.slice(0, 1), exhausted: false, error: null }));
    await get().load(true);
  },
  clearLimit: () => set({ limit: null }),
}));
