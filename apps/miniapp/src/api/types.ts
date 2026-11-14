/** Shapes returned by the Vibe Chat API (apps/server). */

export type Gender = 'male' | 'female';
export type InterestedIn = Gender | 'everyone';

export interface Option {
  id: string;
  label: string;
  emoji?: string;
}

export interface City {
  id: number;
  name: string;
  provinceId: number;
}

export interface Province {
  id: number;
  name: string;
  cities: City[];
}

export interface Meta {
  goals: Option[];
  interests: Option[];
  education: Option[];
  smoking: Option[];
  marital: Option[];
  reportReasons: Option[];
  provinces: Province[];
  minAge: number;
  maxPhotos: number;
  maxInterests: number;
  support: { telegram: string; channel: string; termsUrl: string; privacyUrl: string };
  maintenance: { enabled: boolean; message: string };
  signupOpen: boolean;
  /** inviting friends (adding them to the Wall group) is on */
  referral: { enabled: boolean };
  bot: { username: string; appLink: string };
  wall: {
    enabled: boolean;
    categories: Option[];
    ttlHours: number;
    freeDailyPosts: number;
    group: { link: string | null } | null;
  };
}

export interface Photo {
  id: string;
  url: string;
  md: string;
  thumb: string;
  blur: string;
  width: number;
  height: number;
  color: string | null;
}

export interface MyPhoto extends Photo {
  status: 'pending' | 'approved' | 'rejected';
  visible: boolean;
  rejectReason: string | null;
}

export interface Me {
  id: string;
  status: 'onboarding' | 'active' | 'suspended' | 'banned' | 'deleted';
  telegram: { id: string; username: string | null; firstName: string | null; premium: boolean; canDm: boolean };
  refCode: string;
  name: string | null;
  gender: Gender | null;
  birthdate: string | null;
  age: number | null;
  interestedIn: InterestedIn | null;
  goal: string | null;
  bio: string | null;
  job: string | null;
  education: string | null;
  heightCm: number | null;
  smoking: string | null;
  maritalStatus: string | null;
  interests: string[];
  provinceId: number | null;
  province: string | null;
  cityId: number | null;
  city: string | null;
  hasLocation: boolean;
  /**
   * active: the member perks apply. until: a paid membership's end. offered: whether membership is
   * shown at all (cards, upsells) — false for someone who has the perks without buying them.
   */
  premium: { active: boolean; until: string | null; offered: boolean };
  boostUntil: string | null;
  /** boosts bought in the store, and whether today's free one (premium) is still there */
  boost: { credits: number; freeAvailable: boolean };
  privacy: { showTelegram: boolean; hideAge: boolean; hideDistance: boolean; incognito: boolean; discoverable: boolean };
  preferences: {
    minAge: number;
    maxAge: number;
    scope: 'city' | 'province' | 'country' | 'nearby';
    maxKm: number;
    /** false: the age range is only a suggestion around my age; nothing is filtered by it yet */
    ageSet: boolean;
  };
  notifications: { matches: boolean; messages: boolean; likes: boolean };
  photos: MyPhoto[];
  limits: {
    dailyLikes: number | null;
    likesLeft: number | null;
    dailySuperLikes: number;
    superLikesLeft: number;
    bonusSuperLikes: number;
    maxPhotos: number;
  };
  createdAt: string;
  activatedAt: string | null;
}

export interface Card {
  id: string;
  /** (discovery) this person super-liked me */
  superLikedYou?: boolean;
  name: string;
  age: number | null;
  gender: Gender | null;
  bio: string | null;
  goal: string | null;
  job: string | null;
  education: string | null;
  heightCm: number | null;
  smoking: string | null;
  maritalStatus: string | null;
  interests: string[];
  provinceId: number | null;
  province: string | null;
  cityId: number | null;
  city: string | null;
  premium: boolean;
  newcomer: boolean;
  photos: Photo[];
  lastActiveAt: string;
  distanceKm: number | null;
  online: boolean;
  telegramUsername: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  isNew: boolean;
  user: Me;
}

export interface SwipeResult {
  matched: boolean;
  matchId?: string | null;
  duplicate?: boolean;
  likesLeft?: number | null;
  superLikesLeft?: number;
  bonusSuperLikes?: number;
}

/** Where a like stands: not answered yet, a chat is open, I liked back (the match ended) or I passed. */
export type LikeState = 'new' | 'matched' | 'liked' | 'passed';

export interface LikeItem {
  superLike: boolean;
  blur: string | null;
  user: Card | null;
  likedAt?: string;
  /** one of the first likes, shown without premium */
  free?: boolean;
  state: LikeState;
  /** the open chat, when `state` is matched */
  matchId?: string;
}

export interface LikesPage {
  locked: boolean;
  /** everyone who liked me (up to 1000) */
  total: number;
  items: LikeItem[];
  /** pass it as `before` for the next page; null on the last one */
  nextBefore: string | null;
  /** how many first likes are free to see (non-premium) */
  freeRevealed?: number;
}

/** «شب Vibe»: the nightly peak window. `granted`: super likes just given for showing up tonight. */
export interface VibeNight {
  enabled: boolean;
  active: boolean;
  startsAt: string;
  endsAt: string;
  bonus: number;
  granted: number;
  claimed: boolean;
}

export interface ConversationPeer {
  id: string;
  name: string;
  age: number | null;
  photo: string | null;
  online: boolean;
  telegramUsername: string | null;
}

/** How a conversation started (shown above its first message). */
export type ChatOrigin =
  | { kind: 'like' | 'superlike'; by?: string }
  // 'random' is legacy: the random chat is gone, but matches made there keep their origin
  | { kind: 'random' }
  | { kind: 'wall'; postId?: string; author?: string; requester?: string; text?: string; category?: string };

export interface Conversation {
  id: string;
  peer: ConversationPeer | null;
  createdAt: string;
  origin: ChatOrigin;
  active: boolean;
  lastMessage: { id: string; kind: string | null; preview: string | null; senderId: string | null; createdAt: string | null } | null;
  unread: number;
  muted: boolean;
  peerLastReadId: string;
  superLike?: boolean;
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  kind: 'text' | 'image' | 'system';
  body: string | null;
  media: { url: string; thumb: string; blur: string; width: number; height: number; color: string | null } | null;
  replyTo: string | null;
  clientId: string | null;
  deleted: boolean;
  createdAt: string;
  /** client-only: not yet confirmed by the server */
  pending?: boolean;
  failed?: boolean;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

export interface Plan {
  id: string;
  title: string;
  description: string | null;
  durationDays: number;
  priceToman: number;
  oldPriceToman: number | null;
  badge: string | null;
}

export interface PlansResponse {
  items: Plan[];
  paymentsEnabled: boolean;
  features: { icon: string; title: string }[];
}

/** Invites: friends added to the Wall group earn likes. */
export interface Referrals {
  enabled: boolean;
  group: { link: string } | null;
  adds: number;
  minAdds: number;
  /** likes for every minAdds friends */
  rewardLikes: number;
  earnedLikes: number;
  /** more friends needed for the next reward */
  untilNext: number;
  /** likes are capped for this user (a man without membership): the invite pitch is theirs */
  limited: boolean;
}

export interface GateChat {
  id: string;
  title: string;
  kind: 'channel' | 'group';
  link: string;
  joined: boolean;
}

export interface GateStatus {
  ok: boolean;
  chats: GateChat[];
}

export interface Summary {
  unreadChats: number;
  unreadMessages: number;
  unreadNotifications: number;
  newLikes: number;
  latestId: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface WallAuthor {
  id: string;
  name: string;
  age: number | null;
  gender: Gender | null;
  premium: boolean;
  online: boolean;
  newcomer: boolean;
  photo: string | null;
  thumb: string | null;
  color: string | null;
}

export interface WallPost {
  id: string;
  text: string;
  category: string;
  lookingFor: InterestedIn;
  status: 'active' | 'expired' | 'deleted' | 'removed';
  likeCount: number;
  /** author only: conversation requests received / waiting for an answer / accepted */
  requestCount?: number;
  pendingCount?: number;
  acceptedCount?: number;
  liked: boolean;
  mine: boolean;
  /** an open conversation with the author */
  matchId: string | null;
  /** the conversation request I sent for this post */
  myRequest: 'pending' | 'accepted' | 'declined' | null;
  editedAt?: string | null;
  /** a newcomer's very first request (spotlighted on top of the Wall) */
  firstRequest?: boolean;
  removedReason: string | null;
  showPhoto: boolean;
  inGroup: boolean;
  createdAt: string;
  /** moved back to the top by its author (members); the feed shows this time */
  bumpedAt?: string | null;
  /** mine: when the next bump is allowed (null: now) */
  nextBumpAt?: string | null;
  expiresAt: string;
  city: string | null;
  author: WallAuthor | null;
}

export interface MyWall {
  items: WallPost[];
  postsLeft: number;
  dailyPosts: number;
  /** conversation requests waiting for my answer, across my requests */
  pendingRequests: number;
  /** how many requests I may have live at once; whether I can post now, and if not (a pause), when */
  activeLimit?: number;
  canPost?: boolean;
  nextPostAt?: string | null;
  /** I'm new and haven't posted yet: my first request would get the spotlight */
  spotlightFirst?: boolean;
}

export interface WallChatRequest {
  id: string;
  /** expired: the post ended before its author answered */
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  text: string;
  matchId: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    age: number | null;
    gender: Gender | null;
    premium: boolean;
    online: boolean;
    city: string | null;
    photo: string | null;
    color: string | null;
  };
  /** the Wall request it was sent for */
  post: { id: string; text: string; category: string; live: boolean; available: boolean };
}

/** Conversation requests received (box «in») or sent (box «out») through the Wall. */
export interface WallRequestBox {
  items: WallChatRequest[];
  pending: number;
}

export interface WallPage {
  items: WallPost[];
  /** first page only: newcomers' first requests, pinned on top */
  spotlight?: WallPost[];
  nextCursor: string | null;
}

export interface WallFilters {
  forMe?: boolean;
  gender?: Gender;
  category?: string;
  city?: boolean;
}
