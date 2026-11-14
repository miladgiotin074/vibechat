import clsx from 'clsx';
import { Flame, Megaphone, MessageCircle, User } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { lazy, type ReactNode, Suspense, useEffect } from 'react';
import { useConversations, useMyWall, useSummary } from '@/api/queries';
import { type StackEntry, type Tab, useNav } from '@/store/nav';
import { useUi } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Loading } from '@/ui/kit';
import { Chats } from './chats/Chats';
import { Discover } from './discover/Discover';
import { MatchModal } from './discover/MatchModal';
import { MeScreen } from './me/Me';
import { Wall } from './wall/Wall';

// Secondary screens load on first use: the first paint only needs the tabs.
const Chat = lazy(() => import('./chat/Chat'));
const Profile = lazy(() => import('./profile/Profile'));
const EditProfile = lazy(() => import('./me/EditProfile'));
const Premium = lazy(() => import('./premium/Premium'));
const PaymentResult = lazy(() => import('./premium/PaymentResult'));
const Invite = lazy(() => import('./invite/Invite'));
const Blocked = lazy(() => import('./me/Blocked'));
const Notifications = lazy(() => import('./me/Notifications'));
const WallPostScreen = lazy(() => import('./wall/WallPostScreen'));
const WallCompose = lazy(() => import('./wall/Compose'));
const WallMine = lazy(() => import('./wall/MyRequests'));
const WallInbox = lazy(() => import('./wall/Inbox'));
const Likes = lazy(() => import('./likes/Likes'));

function renderScreen(s: StackEntry): ReactNode {
  switch (s.name) {
    case 'chat':
      return <Chat matchId={s.matchId} />;
    case 'profile':
      return <Profile userId={s.userId} initial={s.card} actions={s.actions ?? 'none'} />;
    case 'editProfile':
      return <EditProfile />;
    case 'premium':
      return <Premium reason={s.reason} />;
    case 'payment':
      return <PaymentResult paymentId={s.paymentId} />;
    case 'invite':
      return <Invite />;
    case 'blocked':
      return <Blocked />;
    case 'notifications':
      return <Notifications />;
    case 'wallPost':
      return <WallPostScreen postId={s.postId} />;
    case 'wallCompose':
      return <WallCompose editId={s.editId} />;
    case 'wallMine':
      return <WallMine />;
    case 'wallInbox':
      return <WallInbox initialBox={s.box ?? 'in'} />;
    case 'likes':
      return <Likes />;
  }
}

const TABS: { id: Tab; icon: typeof Flame; label: string }[] = [
  { id: 'discover', icon: Flame, label: 'کشف' },
  { id: 'wall', icon: Megaphone, label: 'دیوار' },
  { id: 'chats', icon: MessageCircle, label: 'گفتگوها' },
  { id: 'me', icon: User, label: 'من' },
];

export function Shell() {
  const tab = useNav((s) => s.tab);
  const stack = useNav((s) => s.stack);
  const summary = useSummary();
  const conversations = useConversations();
  const setBadges = useUi((s) => s.setBadges);

  // Badges: from the server summary, then live from socket events.
  useEffect(() => {
    if (summary.data) setBadges({ likes: summary.data.newLikes, notifications: summary.data.unreadNotifications });
  }, [summary.data, setBadges]);
  useEffect(() => {
    if (conversations.data) setBadges({ chats: conversations.data.items.filter((c) => c.unread > 0 && !c.muted).length });
  }, [conversations.data, setBadges]);

  return (
    <div className="relative h-full overflow-hidden bg-night">
      {TABS.map(({ id }) => (
        <section key={id} className={clsx('absolute inset-0 flex flex-col', tab !== id && 'invisible pointer-events-none')} aria-hidden={tab !== id}>
          {id === 'discover' ? <Discover active={tab === 'discover' && stack.length === 0} /> : null}
          {id === 'wall' ? <Wall active={tab === 'wall' && stack.length === 0} /> : null}
          {id === 'chats' ? <Chats /> : null}
          {id === 'me' ? <MeScreen /> : null}
        </section>
      ))}

      <TabBar />

      <AnimatePresence initial={false}>
        {stack.map((s, i) => (
          <motion.section
            key={s.key}
            className="absolute inset-0 z-20 flex flex-col bg-night"
            // RTL: "forward" comes in from the left, like Telegram in Persian
            initial={{ x: '-100%' }}
            animate={{ x: 0, filter: i < stack.length - 1 ? 'brightness(0.7)' : 'brightness(1)' }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40, mass: 0.9 }}
          >
            <Suspense fallback={<Loading />}>{renderScreen(s)}</Suspense>
          </motion.section>
        ))}
      </AnimatePresence>

      <MatchModal />
    </div>
  );
}

function TabBar() {
  const tab = useNav((s) => s.tab);
  const setTab = useNav((s) => s.setTab);
  const badges = useUi((s) => s.badges);
  // the Wall's badge: people waiting for my answer to their conversation request
  const wallPending = useMyWall().data?.pendingRequests ?? 0;
  const count = (id: Tab) => (id === 'chats' ? badges.chats : id === 'wall' ? wallPending : 0);
  return (
    <nav className="absolute inset-x-0 bottom-0 z-10 px-4 pb-safe">
      <div data-tour="tabs" className="mb-3 flex h-[66px] items-center justify-around rounded-panel border border-line glass shadow-[0_20px_40px_-16px_rgba(0,0,0,0.8)]">
        {TABS.map(({ id, icon: Icon, label }) => {
          const active = tab === id;
          const n = count(id);
          return (
            <button
              key={id}
              aria-label={label}
              onClick={() => {
                if (!active) haptic.select();
                setTab(id);
              }}
              className="relative flex h-full flex-1 flex-col items-center justify-center gap-1"
            >
              <motion.span animate={{ scale: active ? 1.1 : 1, y: active ? -2 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }} className="relative">
                <Icon className={clsx('size-[26px] transition-colors', active ? 'fill-rose text-rose' : 'fill-faint/60 text-faint')} strokeWidth={active ? 2 : 1.8} />
                {n > 0 ? (
                  <span className="absolute -top-1.5 -left-2.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose px-1 text-[10px] font-bold text-white ring-2 ring-surface-1">
                    {n > 99 ? '۹۹+' : n.toLocaleString('fa-IR')}
                  </span>
                ) : null}
              </motion.span>
              <AnimatePresence>
                {active ? (
                  <motion.span
                    layoutId="tab-dot"
                    className="absolute bottom-2 size-1.5 rounded-full bg-rose"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                ) : null}
              </AnimatePresence>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Space the floating tab bar takes at the bottom of tab screens. */
export const TAB_BAR_SPACE = 'calc(96px + var(--safe-bottom))';
