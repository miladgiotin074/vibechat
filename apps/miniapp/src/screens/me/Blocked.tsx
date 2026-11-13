import { api } from '@/api/client';
import { keys, queryClient, useBlocks } from '@/api/queries';
import { toast } from '@/store/ui';
import { Avatar, Button, EmptyState, Loading, ScreenHeader } from '@/ui/kit';

export default function Blocked() {
  const q = useBlocks();
  const unblock = async (id: string) => {
    await api.del(`/v1/blocks/${id}`).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: keys.blocks });
    toast('از مسدودی خارج شد', '✅');
  };
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="مسدودشده‌ها" />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.items.length ? (
          <EmptyState emoji="🕊️" title="کسی را مسدود نکرده‌ای" />
        ) : (
          <ul className="overflow-hidden rounded-card border border-line bg-surface-1">
            {q.data.items.map((u) => (
              <li key={u.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <Avatar src={u.photo} name={u.name} size={46} />
                <span className="flex-1 truncate text-[15px] font-medium">{u.name}</span>
                <Button size="sm" variant="soft" onClick={() => unblock(u.id)}>
                  رفع مسدودی
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
