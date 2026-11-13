import clsx from 'clsx';
import { Camera, Info, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { keys, queryClient, useMe, useMeta, useMyWall, useWallPost } from '@/api/queries';
import type { InterestedIn, WallPost } from '@/api/types';
import { fa } from '@/lib/format';
import { nav, useNav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Button, Chip, ScreenHeader, SectionTitle, ToggleRow } from '@/ui/kit';
import { PostCard } from './PostCard';

/** A blank box is the hardest part: a few ready lines per topic, one tap to start from. */
const IDEAS: Record<string, string[]> = {
  chat: ['دنبال یه هم‌صحبت خوش‌اخلاق برای گپ‌های شبانه‌ام 🌙', 'حوصله‌ام سر رفته، یکی بیاد از فیلم و کتاب حرف بزنیم 🎬', 'یه نفر که اهل حرف زدن و خندیدن باشه 😄'],
  friendship: ['دنبال دوستای جدید تو شهرم هستم 🤝', 'تازه به این شهر اومدم، کی پایه‌ی آشنایی‌ه؟', 'یه دوست صمیمی و رک می‌خوام 💜'],
  dating: ['یه قرار ساده تو یه کافه‌ی دنج؟ ☕🌹', 'دنبال کسی که بشه باهاش یه شام خوب رفت 🍝', 'یه قدم زدن عصرگاهی و ببینیم چی می‌شه 🌇'],
  serious: ['دنبال یه رابطه‌ی جدی و آروم هستم 💞', 'آدم وفادار و صادق، برای یه رابطه‌ی طولانی', 'خسته از رابطه‌های کوتاه؛ دنبال یه آدم جدی‌ام'],
  outing: ['کی پایه‌ی کافه‌گردی آخر هفته‌ست؟ ☕', 'یه همراه برای سینما این هفته 🎬', 'دورهمی و بازی فکری، کی میاد؟ 🎲'],
  travel: ['یه همسفر برای سفر شمال می‌خوام 🌊', 'کی پایه‌ی یه سفر یه‌روزه‌ست؟ 🚗', 'دنبال همسفر برای تور کویر ✨'],
  sport: ['یه هم‌باشگاهی برای صبح‌ها 💪', 'کی پایه‌ی کوهنوردی جمعه‌هاست؟ ⛰️', 'دنبال یه نفر برای پیاده‌روی عصرها تو پارکم 🌳'],
  gaming: ['هم‌بازی برای کالاف و فیفا 🎮', 'یه تیم‌میت برای شب‌ها می‌خوام 🕹️', 'کی اهل بازی‌های فکری آنلاینه؟ ♟️'],
};

/**
 * Writing a Wall request: text, topic, who it's for, and how public it is. With `editId` it
 * changes a live request in place (its text, topic and audience; likes and requests stay).
 */
export default function Compose({ editId }: { editId?: string }) {
  const me = useMe().data!;
  const meta = useMeta().data;
  const mine = useMyWall();
  const editing = useWallPost(editId ?? '', !!editId).data;
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('chat');
  const [lookingFor, setLookingFor] = useState<InterestedIn>(me.interestedIn ?? (me.gender === 'male' ? 'female' : 'male'));
  const hasPhoto = me.photos.some((p) => p.status === 'approved');
  const [showPhoto, setShowPhoto] = useState(hasPhoto);
  const [toGroup, setToGroup] = useState(true);
  const [busy, setBusy] = useState(false);
  const ideas = IDEAS[category] ?? IDEAS.chat!;
  const idea = useMemo(() => ideas[Math.floor(Math.random() * ideas.length)]!, [ideas]);
  const length = [...text.trim()].length;
  const group = meta?.wall?.group;
  // a new request is possible only when none is live and the pause since the last one is over
  const blocked = !editId && mine.data?.canPost === false;

  // editing: start from what is on the Wall now
  useEffect(() => {
    if (!editing || loaded) return;
    setText(editing.text);
    setCategory(editing.category);
    setLookingFor(editing.lookingFor);
    setShowPhoto(editing.showPhoto);
    setLoaded(true);
  }, [editing, loaded]);

  const preview: WallPost = {
    id: 'preview',
    text: text.trim() || idea,
    category,
    lookingFor,
    status: 'active',
    likeCount: 0,
    requestCount: 0,
    pendingCount: 0,
    acceptedCount: 0,
    myRequest: null,
    liked: false,
    matchId: null,
    removedReason: null,
    mine: true,
    showPhoto,
    inGroup: false,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (meta?.wall?.ttlHours ?? 48) * 3_600_000).toISOString(),
    city: me.city,
    author: {
      id: me.id,
      name: me.name ?? '',
      age: me.privacy.hideAge ? null : me.age,
      gender: me.gender,
      premium: !!me.premium.until,
      online: true,
      newcomer: false,
      photo: showPhoto ? (me.photos[0]?.md ?? null) : null,
      thumb: showPhoto ? (me.photos[0]?.thumb ?? null) : null,
      color: null,
    },
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (editId) {
        await api.patch<WallPost>(`/v1/wall/${editId}`, { text: text.trim(), category, lookingFor });
        haptic.success();
        void queryClient.invalidateQueries({ queryKey: keys.wall });
        toast('درخواستت به‌روز شد ✏️', '📌', 'success');
        nav.pop();
        return;
      }
      await api.post<WallPost>('/v1/wall', { text: text.trim(), category, lookingFor, showPhoto, toGroup: !!group && toGroup });
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: keys.wall });
      toast(group && toGroup ? 'درخواستت روی دیوار و گروه تلگرام منتشر شد 🎉' : 'درخواستت روی دیوار منتشر شد 🎉', '📌', 'success');
      // land on «my requests», where the new request and the answers to it live
      const stack = useNav.getState().stack;
      if (stack[stack.length - 2]?.name === 'wallMine') nav.pop();
      else nav.replace({ name: 'wallMine' });
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={editId ? 'ویرایش درخواست' : 'درخواست تازه'} sub={editId ? 'لایک‌ها و درخواست‌های گفتگو سر جاشون می‌مونن' : undefined} />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="relative mt-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 300))}
            rows={4}
            autoFocus
            placeholder={`مثلاً: ${idea}`}
            className="w-full resize-none rounded-card border border-line bg-surface-1 px-4 pt-3.5 pb-8 text-[16px] leading-8 outline-none focus:border-rose/60"
          />
          <span className={clsx('absolute bottom-3 left-4 text-[12px] tabular', length > 280 ? 'text-ember' : 'text-faint')}>{fa(length)}/{fa(300)}</span>
        </div>
        <p className="mt-2 flex items-start gap-1.5 px-1 text-[12px] leading-6 text-faint">
          <Info className="mt-1 size-3.5 shrink-0" />
          شماره، آیدی و لینک نذار؛ بقیه همین‌جا بهت پیام می‌دن. درخواست {fa(meta?.wall?.ttlHours ?? 48)} ساعت روی دیوار می‌مونه.
        </p>
        {length === 0 ? (
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
            {ideas.map((t) => (
              <button
                key={t}
                onClick={() => {
                  haptic.select();
                  setText(t);
                }}
                className="shrink-0 rounded-2xl border border-violet/30 bg-violet/10 px-3 py-2 text-right text-[12.5px] leading-5"
                style={{ maxWidth: 230 }}
              >
                ✨ {t}
              </button>
            ))}
          </div>
        ) : null}

        <SectionTitle className="mt-4">موضوع</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {meta?.wall?.categories.map((c) => (
            <Chip key={c.id} label={c.label} emoji={c.emoji} selected={category === c.id} onClick={() => setCategory(c.id)} />
          ))}
        </div>

        <SectionTitle className="mt-4">دنبال چه کسی؟</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['male', 'آقا', '👨'],
              ['female', 'خانم', '👩'],
              ['everyone', 'فرقی نمی‌کنه', '💫'],
            ] as const
          ).map(([id, label, emoji]) => (
            <Chip key={id} label={label} emoji={emoji} selected={lookingFor === id} onClick={() => setLookingFor(id)} />
          ))}
        </div>

        <div className={clsx('mt-6 overflow-hidden rounded-card border border-line bg-surface-1', editId && 'hidden')}>
          <ToggleRow
            icon={<Camera />}
            tint="violet"
            title="نمایش عکسم"
            subtitle={hasPhoto ? 'با عکس، چند برابر بیشتر پیام می‌گیری' : 'اول یه عکس به پروفایلت اضافه کن'}
            checked={showPhoto}
            disabled={!hasPhoto}
            onChange={setShowPhoto}
          />
          {group ? (
            <ToggleRow
              icon={<Send className="-scale-x-100" />}
              tint="sky"
              title="انتشار در گروه دیوار تلگرام"
              subtitle={`اسم، سن، شهر${showPhoto ? ' و عکست' : ''} اونجا هم دیده می‌شه`}
              checked={toGroup}
              onChange={setToGroup}
            />
          ) : null}
        </div>

        <SectionTitle className="mt-4">پیش‌نمایش</SectionTitle>
        <div className="pointer-events-none">
          <PostCard post={preview} preview onMessage={() => undefined} />
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-4 pt-3 pb-safe glass">
        <Button className="mb-3 w-full" disabled={length < 10 || blocked} loading={busy} onClick={submit}>
          {blocked ? 'فعلاً نمی‌تونی درخواست تازه بذاری' : length < 10 ? `حداقل ${fa(10)} حرف بنویس` : editId ? 'ذخیره‌ی تغییرات ✏️' : 'انتشار روی دیوار 📌'}
        </Button>
      </div>
    </div>
  );
}
