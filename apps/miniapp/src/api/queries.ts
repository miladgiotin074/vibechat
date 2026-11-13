import { QueryClient, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from './client';
import type {
  Card,
  Conversation,
  LikesPage,
  Me,
  Message,
  Meta,
  NotificationItem,
  PlansResponse,
  GateStatus,
  Referrals,
  Summary,
  MyWall,
  VibeNight,
  WallChatRequest,
  WallRequestBox,
  WallFilters,
  WallPage,
  WallPost,
} from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

export const keys = {
  me: ['me'] as const,
  meta: ['meta'] as const,
  plans: ['plans'] as const,
  referrals: ['referrals'] as const,
  gate: ['gate'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  likes: ['likes'] as const,
  notifications: ['notifications'] as const,
  summary: ['summary'] as const,
  user: (id: string) => ['user', id] as const,
  blocks: ['blocks'] as const,
  wall: ['wall'] as const,
  wallFeed: (f: WallFilters) => ['wall', 'feed', f] as const,
  wallMine: ['wall', 'mine'] as const,
  wallPost: (id: string) => ['wall', 'post', id] as const,
  wallRequests: (id: string) => ['wall', 'requests', id] as const,
  wallInbox: (box: 'in' | 'out') => ['wall', 'inbox', box] as const,
  vibeNight: ['vibe-night'] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/v1/me'), staleTime: 60_000 });
export const setMe = (me: Me) => queryClient.setQueryData(keys.me, me);
export const getMe = () => queryClient.getQueryData<Me>(keys.me);

export const useMeta = () =>
  useQuery({ queryKey: keys.meta, queryFn: () => api.get<Meta>('/v1/meta'), staleTime: 10 * 60_000 });

export const usePlans = () => useQuery({ queryKey: keys.plans, queryFn: () => api.get<PlansResponse>('/v1/plans') });

export const useReferrals = () => useQuery({ queryKey: keys.referrals, queryFn: () => api.get<Referrals>('/v1/referrals') });

/** Channels/groups to join before using the app. Checked on every launch (never cached across them). */
export const fetchGate = () => api.get<GateStatus>('/v1/gate');
export const useGate = (enabled: boolean) => useQuery({ queryKey: keys.gate, queryFn: fetchGate, enabled, staleTime: Infinity, retry: 1 });

export const useSummary = () =>
  useQuery({ queryKey: keys.summary, queryFn: () => api.get<Summary>('/v1/notifications/summary'), refetchInterval: 60_000 });

export const useConversations = () =>
  useQuery({
    queryKey: keys.conversations,
    queryFn: () => api.get<{ items: Conversation[]; nextBefore: string | null; archivedCount?: number }>('/v1/conversations?limit=50'),
  });

/** Matches where nobody ever wrote, moved out of the main list after two weeks. */
export const useArchivedConversations = (enabled: boolean) =>
  useQuery({
    queryKey: ['conversations', 'archived'] as const,
    queryFn: () => api.get<{ items: Conversation[] }>('/v1/conversations?limit=50&archived=1'),
    enabled,
  });

export const useConversation = (id: string) =>
  useQuery({ queryKey: keys.conversation(id), queryFn: () => api.get<Conversation>(`/v1/conversations/${id}`) });

export const useMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: keys.messages(id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<{ items: Message[]; hasMore: boolean }>(`/v1/conversations/${id}/messages?limit=40${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.hasMore ? (last.items[last.items.length - 1]?.id ?? null) : null),
    staleTime: 0,
  });

export const useLikes = () => useQuery({ queryKey: keys.likes, queryFn: () => api.get<LikesPage>('/v1/likes?limit=50') });

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.get<{ items: NotificationItem[]; hasMore: boolean }>('/v1/notifications?limit=50'),
  });

export const useUser = (id: string, initial?: Card) =>
  useQuery({ queryKey: keys.user(id), queryFn: () => api.get<Card>(`/v1/users/${id}`), initialData: initial, staleTime: 60_000, enabled: !!id });

export const useBlocks = () =>
  useQuery({ queryKey: keys.blocks, queryFn: () => api.get<{ items: { id: string; name: string; photo: string | null }[] }>('/v1/blocks') });

/** PATCH /v1/me and friends: the server answers with the full profile, which becomes the cache. */
export function useUpdateMe(path = '/v1/me') {
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Me>(path, body),
    onSuccess: (me) => setMe(me),
  });
}

/** Messages are stored newest-first in pages; this adds/replaces one everywhere it should appear. */
export function upsertMessage(matchId: string, msg: Message) {
  queryClient.setQueryData<{ pages: { items: Message[]; hasMore: boolean }[]; pageParams: unknown[] }>(keys.messages(matchId), (old) => {
    if (!old) return old;
    const pages = old.pages.map((p) => ({ ...p, items: [...p.items] }));
    for (const p of pages) {
      const i = p.items.findIndex((m) => m.id === msg.id || (msg.clientId && m.clientId === msg.clientId));
      if (i >= 0) {
        p.items[i] = msg;
        return { ...old, pages };
      }
    }
    if (pages[0]) pages[0].items.unshift(msg);
    return { ...old, pages };
  });
}

export function patchConversation(matchId: string, fn: (c: Conversation) => Conversation) {
  queryClient.setQueryData<{ items: Conversation[]; nextBefore: string | null }>(keys.conversations, (old) => {
    if (!old) return old;
    const items = old.items.map((c) => (c.id === matchId ? fn(c) : c));
    items.sort((a, b) => sortTime(b) - sortTime(a));
    return { ...old, items };
  });
  queryClient.setQueryData<Conversation>(keys.conversation(matchId), (old) => (old ? fn(old) : old));
}

const sortTime = (c: Conversation) => new Date(c.lastMessage?.createdAt ?? c.createdAt).getTime();

// ---- the Wall ----

export function wallParams(f: WallFilters, limit: number, cursor?: string | null) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (f.forMe) q.set('forMe', '1');
  if (f.gender) q.set('gender', f.gender);
  if (f.category) q.set('category', f.category);
  if (f.city) q.set('city', '1');
  if (cursor) q.set('cursor', cursor);
  return q;
}

export const useWallFeed = (f: WallFilters) =>
  useInfiniteQuery({
    queryKey: keys.wallFeed(f),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<WallPage>(`/v1/wall?${wallParams(f, 15, pageParam)}`),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 20_000,
  });

export const useMyWall = () =>
  useQuery({ queryKey: keys.wallMine, queryFn: () => api.get<MyWall>('/v1/wall/mine') });

/** Conversation requests on one of my posts (author only). */
export const useWallRequests = (postId: string | null) =>
  useQuery({
    queryKey: keys.wallRequests(postId ?? ''),
    queryFn: () => api.get<{ items: WallChatRequest[] }>(`/v1/wall/${postId}/requests`),
    enabled: !!postId,
  });

/** «شب Vibe» state; asking while it's on also collects tonight's gift (once). */
export const useVibeNight = (enabled = true) =>
  useQuery({
    queryKey: keys.vibeNight,
    queryFn: () => api.get<VibeNight>('/v1/vibe-night'),
    enabled,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

/** Every conversation request I received (or sent) through the Wall. */
export const useWallInbox = (box: 'in' | 'out') =>
  useQuery({ queryKey: keys.wallInbox(box), queryFn: () => api.get<WallRequestBox>(`/v1/wall/requests?box=${box}`) });

export const useWallPost = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.wallPost(id), queryFn: () => api.get<WallPost>(`/v1/wall/${id}`), enabled });

/** Applies a change to a request wherever it is cached (feed pages, my list, detail). */
export function patchWallPost(id: string, fn: (p: WallPost) => WallPost) {
  queryClient.setQueriesData<{ pages: WallPage[]; pageParams: unknown[] }>({ queryKey: ['wall', 'feed'] }, (old) =>
    old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => (p.id === id ? fn(p) : p)) })) } : old,
  );
  queryClient.setQueryData<MyWall>(keys.wallMine, (old) =>
    old ? { ...old, items: old.items.map((p) => (p.id === id ? fn(p) : p)) } : old,
  );
  queryClient.setQueryData<WallPost>(keys.wallPost(id), (old) => (old ? fn(old) : old));
}
