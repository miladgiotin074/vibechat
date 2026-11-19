import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { Card } from '@/api/types';

/**
 * Navigation without a router: four tabs that stay mounted (state and scroll survive switching) plus
 * a stack of screens on top. Telegram's own Back button (in the action bar) pops the stack; sheets and
 * dialogs register back handlers so Back closes them first.
 */
export type Tab = 'discover' | 'wall' | 'chats' | 'me';

export type Screen =
  | { name: 'chat'; matchId: string }
  | { name: 'profile'; userId: string; card?: Card; actions?: 'discover' | 'none' }
  | { name: 'editProfile' }
  | { name: 'verify' }
  | { name: 'notifications' }
  | { name: 'blocked' }
  | { name: 'wallPost'; postId: string }
  | { name: 'wallMine' }
  | { name: 'wallCompose'; editId?: string };

export type StackEntry = Screen & { key: string };

interface NavState {
  tab: Tab;
  stack: StackEntry[];
  /** Back handlers of open sheets/dialogs, newest last. */
  handlers: { id: number; fn: () => void }[];
  setTab: (tab: Tab) => void;
  push: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  pop: () => void;
  popTo: (name: Screen['name']) => void;
  reset: (tab?: Tab) => void;
}

let seq = 0;
const key = () => `s${++seq}`;

export const useNav = create<NavState>((set) => ({
  tab: 'discover',
  stack: [],
  handlers: [],
  setTab: (tab) => set({ tab }),
  push: (screen) =>
    set((s) => {
      // Opening the same chat/profile twice in a row is a no-op (double taps, notification + tap).
      const top = s.stack[s.stack.length - 1];
      if (top && JSON.stringify({ ...top, key: '' }) === JSON.stringify({ ...screen, key: '' })) return s;
      return { stack: [...s.stack, { ...screen, key: key() }] };
    }),
  replace: (screen) => set((s) => ({ stack: [...s.stack.slice(0, -1), { ...screen, key: key() }] })),
  pop: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  popTo: (name) =>
    set((s) => {
      const i = s.stack.map((x) => x.name).lastIndexOf(name);
      return { stack: i >= 0 ? s.stack.slice(0, i + 1) : s.stack };
    }),
  reset: (tab) => set((s) => ({ stack: [], tab: tab ?? s.tab })),
}));

export const nav = {
  push: (s: Screen) => useNav.getState().push(s),
  pop: () => useNav.getState().pop(),
  replace: (s: Screen) => useNav.getState().replace(s),
  setTab: (t: Tab) => useNav.getState().setTab(t),
  reset: (t?: Tab) => useNav.getState().reset(t),
};

let handlerSeq = 0;

/** While `active`, Telegram's Back button (and Android's back) calls `onBack` instead of popping a screen. */
export function useBackHandler(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    const id = ++handlerSeq;
    useNav.setState((s) => ({ handlers: [...s.handlers, { id, fn: () => ref.current() }] }));
    return () => useNav.setState((s) => ({ handlers: s.handlers.filter((h) => h.id !== id) }));
  }, [active]);
}

/** What Telegram's Back button does right now. */
export function handleBack() {
  const s = useNav.getState();
  const h = s.handlers[s.handlers.length - 1];
  if (h) return h.fn();
  if (s.stack.length) return s.pop();
  if (s.tab !== 'discover') return s.setTab('discover');
}
