import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '@/api/client';
import { useMeta, useUser, useWallPost } from '@/api/queries';
import type { WallPost } from '@/api/types';
import { fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { Button, EmptyState, Img, Loading, Pill, ScreenHeader, SectionTitle } from '@/ui/kit';
import { PullRefresh } from '@/ui/PullRefresh';
import { PostCard } from './PostCard';
import { LikersSheet, WallMessageSheet } from './Sheets';

/**
 * One request on its own: opened from the Telegram group, a notification, or my list. For someone
 * else's request it also shows who they are (photo, about) to help decide before writing.
 */
export default function WallPostScreen({ postId }: { postId: string }) {
  const q = useWallPost(postId);
  const [writeTo, setWriteTo] = useState<WallPost | null>(null);
  const [likersOf, setLikersOf] = useState<WallPost | null>(null);

  if (q.isLoading) return <Loading />;
  if (!q.data) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 410);
    return (
      <EmptyState
        emoji="🧱"
        title={gone ? 'این درخواست دیگر روی دیوار نیست' : 'دریافت نشد'}
        subtitle={gone ? 'شاید زمانش تمام شده یا صاحبش حذفش کرده. درخواست‌های تازه رو ببین!' : undefined}
        action={
          <Button className="w-full" onClick={() => nav.reset('wall')}>
            رفتن به دیوار
          </Button>
        }
      />
    );
  }
  const p = q.data;
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={p.mine ? 'درخواست من' : 'درخواست روی دیوار'} />
      <PullRefresh onRefresh={() => q.refetch()} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {!p.mine && p.author?.photo ? <AuthorHero post={p} /> : null}
        <PostCard post={p} onMessage={setWriteTo} onLikers={setLikersOf} />
        {p.mine ? (
          <p className="mt-5 px-2 text-center text-[12px] leading-6 text-faint">
            {p.inGroup ? 'این درخواست در گروه دیوار تلگرام هم منتشر شده. ' : ''}
            هر کس بخواد، می‌تونه از همین‌جا برات پیام بفرسته و گفتگو باز می‌شه.
          </p>
        ) : (
          <AboutAuthor post={p} />
        )}
        {!p.mine ? (
          <Button variant="soft" className="mt-5 w-full" onClick={() => nav.reset('wall')}>
            🧱 درخواست‌های دیگه روی دیوار
          </Button>
        ) : null}
      </PullRefresh>
      <WallMessageSheet post={writeTo} onClose={() => setWriteTo(null)} />
      <LikersSheet post={likersOf} onClose={() => setLikersOf(null)} />
    </div>
  );
}

function AuthorHero({ post }: { post: WallPost }) {
  const a = post.author!;
  return (
    <button
      onClick={() => nav.push({ name: 'profile', userId: a.id })}
      className="relative mb-3 block aspect-[4/3.6] w-full overflow-hidden rounded-panel border border-line"
    >
      <Img src={a.photo} color={a.color} className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-t from-night via-night/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 p-4 text-right">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[24px] font-black">
            {a.name}
            {a.age ? <span className="font-light">{fa(a.age)}</span> : null}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/15 px-3 py-1.5 text-[12.5px] font-semibold backdrop-blur-md">
          پروفایل کامل <ChevronLeft className="size-4" />
        </span>
      </div>
    </button>
  );
}

function AboutAuthor({ post }: { post: WallPost }) {
  const user = useUser(post.author?.id ?? '');
  const meta = useMeta().data;
  const c = user.data;
  const marital = c?.maritalStatus ? meta?.marital.find((o) => o.id === c.maritalStatus) : undefined;
  if (!c || (!c.bio && !marital)) return null;
  return (
    <section className="mt-4 rounded-card border border-line bg-surface-1 p-4">
      <SectionTitle tight>درباره‌ی {c.name}</SectionTitle>
      {c.bio ? <p className="mt-2 whitespace-pre-wrap text-[14.5px] leading-7">{c.bio}</p> : null}
      {marital ? (
        <div className="mt-3">
          <Pill className="border border-line bg-surface-2">{marital.label}</Pill>
        </div>
      ) : null}
    </section>
  );
}
