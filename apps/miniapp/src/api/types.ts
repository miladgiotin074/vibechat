/** Shapes returned by the Vibe Chat API (apps/server). */

export type Gender = 'male' | 'female';
export type InterestedIn = Gender | 'everyone';

export interface Option {
  id: string;
  label: string;
  emoji?: string;
}

export interface Meta {
  marital: Option[];
  reportReasons: Option[];
  minAge: number;
  maxPhotos: number;
  support: { telegram: string; channel: string; termsUrl: string; privacyUrl: string };
  maintenance: { enabled: boolean; message: string };
  signupOpen: boolean;
  bot: { username: string; appLink: string };
  wall: {
    enabled: boolean;
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
  bio: string | null;
  maritalStatus: string | null;
  privacy: { showTelegram: boolean; hideAge: boolean; discoverable: boolean };
  preferences: {
    minAge: number;
    maxAge: number;
    /** false: the age range is only a suggestion; nothing is filtered by it yet */
    ageSet: boolean;
  };
  notifications: { messages: boolean };
  photos: MyPhoto[];
  limits: {
    /** new conversations a day, the same for everyone (0 = no limit) */
    dailyNewChats: number;
    newChatsLeft: number | null;
    maxPhotos: number;
  };
  createdAt: string;
  activatedAt: string | null;
}

export interface Card {
  id: string;
  name: string;
  age: number | null;
  gender: Gender | null;
  bio: string | null;
  maritalStatus: string | null;
  newcomer: boolean;
  photos: Photo[];
  lastActiveAt: string;
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

/** Writing to someone from their card, or from a Wall request. */
export interface ChatStarted {
  matchId: string;
  /** the conversation was already open */
  existing: boolean;
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
  | { kind: 'message'; by?: string }
  | { kind: 'wall'; postId?: string; author?: string; requester?: string; text?: string; category?: string }
  // from before the app was simplified: old conversations still say where they began
  | { kind: 'like' | 'superlike'; by?: string }
  | { kind: 'random' };

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
  online: boolean;
  newcomer: boolean;
  photo: string | null;
  thumb: string | null;
  color: string | null;
}

export interface WallPost {
  id: string;
  text: string;
  lookingFor: InterestedIn;
  status: 'active' | 'expired' | 'deleted' | 'removed';
  likeCount: number;
  /** author only: how many conversations started from this request */
  chatCount?: number;
  liked: boolean;
  mine: boolean;
  /** an open conversation with the author */
  matchId: string | null;
  editedAt?: string | null;
  removedReason: string | null;
  showPhoto: boolean;
  inGroup: boolean;
  createdAt: string;
  expiresAt: string;
  author: WallAuthor | null;
}

export interface MyWall {
  items: WallPost[];
  postsLeft: number;
  dailyPosts: number;
  /** how many requests I may have live at once; whether I can post now, and if not (a pause), when */
  activeLimit?: number;
  canPost?: boolean;
  nextPostAt?: string | null;
}

export interface WallPage {
  items: WallPost[];
  nextCursor: string | null;
}

export interface WallFilters {
  forMe?: boolean;
  gender?: Gender;
}
