import { Heart } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMe } from '@/api/queries';
import { nav, useBackHandler } from '@/store/nav';
import { useUi } from '@/store/ui';
import { Button } from '@/ui/kit';

/** «مچ شدید!» — floating hearts, both faces joined by a beating heart, one tap to say hi. */
export function MatchModal() {
  const match = useUi((s) => s.match);
  const close = () => useUi.getState().showMatch(null);
  const me = useMe().data;
  useBackHandler(!!match, close);
  const myPhoto = me?.photos[0]?.md;

  return (
    <AnimatePresence>
      {match ? (
        <motion.div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center overflow-hidden px-6"
          style={{ background: 'radial-gradient(120% 80% at 50% 40%, #4a1a34 0%, #1d1020 55%, #0e0a12 100%)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {Array.from({ length: 22 }, (_, i) => (
            <span
              key={i}
              className="absolute bottom-0 rounded-full bg-rose/30 animate-float-up"
              style={{
                left: `${(i * 47) % 100}%`,
                width: 16 + ((i * 13) % 40),
                height: 16 + ((i * 13) % 40),
                animationDelay: `${(i % 7) * 0.6}s`,
                animationDuration: `${5 + (i % 5)}s`,
              }}
            />
          ))}

          <motion.h1
            className="relative text-flame text-[46px] font-black"
            initial={{ scale: 0.4, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.1 }}
          >
            {match.superLike ? 'سوپر مچ! ⭐' : 'مچ شدید!'}
          </motion.h1>
          <motion.p className="relative mt-2 text-[16px] text-ink/90" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
            تو و {match.peer?.name ?? 'او'} همدیگه رو پسندیدید 💘
          </motion.p>

          <div className="relative mt-10 flex items-center" dir="ltr">
            <motion.div
              initial={{ x: -120, rotate: -20, opacity: 0 }}
              animate={{ x: 18, rotate: -8, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.2 }}
              className="size-36 overflow-hidden rounded-full border-[3px] border-rose bg-surface-3 shadow-[0_20px_50px_-10px_rgba(255,45,111,0.6)]"
            >
              {myPhoto ? <img src={myPhoto} alt="" className="size-full object-cover" /> : null}
            </motion.div>
            <motion.div
              initial={{ x: 120, rotate: 20, opacity: 0 }}
              animate={{ x: -18, rotate: 8, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.2 }}
              className="size-36 overflow-hidden rounded-full border-[3px] border-ember bg-surface-3 shadow-[0_20px_50px_-10px_rgba(255,122,69,0.6)]"
            >
              {match.peer?.photo ? <img src={match.peer.photo} alt="" className="size-full object-cover" /> : null}
            </motion.div>
            <motion.div
              className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-flame-d shadow-[0_0_40px_rgba(255,45,111,0.8)]"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.3, 1] }}
              transition={{ delay: 0.55, duration: 0.5 }}
            >
              <Heart className="size-8 fill-white text-white animate-beat" />
            </motion.div>
          </div>

          <motion.div className="relative mt-12 w-full max-w-sm space-y-3" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }}>
            <Button
              className="w-full"
              onClick={() => {
                close();
                nav.push({ name: 'chat', matchId: match.id });
              }}
            >
              سلام کن 👋
            </Button>
            <Button variant="soft" className="w-full" onClick={close}>
              ادامه‌ی گشت‌وگذار
            </Button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
