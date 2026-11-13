'use client';

import clsx from 'clsx';
import {
  Bell,
  CreditCard,
  Flag,
  Gem,
  Images,
  Megaphone,
  Radio,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useApi } from '@/lib/api';
import { fmtNum, ROLE_LABEL } from '@/lib/format';
import type { AdminInfo } from '@/lib/session';

type Role = AdminInfo['role'];
interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  roles: Role[];
  badge?: 'reports';
}

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'نمای کلی',
    items: [{ href: '/', label: 'داشبورد', icon: <LayoutDashboard className="size-4" />, roles: ['superadmin', 'moderator', 'support'] }],
  },
  {
    title: 'کاربران و محتوا',
    items: [
      { href: '/users', label: 'کاربران', icon: <Users className="size-4" />, roles: ['superadmin', 'moderator', 'support'] },
      { href: '/wall', label: 'دیوار', icon: <Megaphone className="size-4" />, roles: ['superadmin', 'moderator'] },
      { href: '/reports', label: 'گزارش‌ها', icon: <Flag className="size-4" />, roles: ['superadmin', 'moderator'], badge: 'reports' },
    ],
  },
  {
    title: 'درآمد',
    items: [
      { href: '/payments', label: 'پرداخت‌ها', icon: <CreditCard className="size-4" />, roles: ['superadmin', 'support'] },
      { href: '/plans', label: 'طرح‌های ویژه', icon: <Gem className="size-4" />, roles: ['superadmin', 'support'] },
    ],
  },
  {
    title: 'سیستم',
    items: [
      { href: '/announcements', label: 'اطلاعیه‌ها', icon: <Bell className="size-4" />, roles: ['superadmin'] },
      { href: '/required-chats', label: 'عضویت اجباری', icon: <Radio className="size-4" />, roles: ['superadmin'] },
      { href: '/bot-media', label: 'تصاویر ربات', icon: <Images className="size-4" />, roles: ['superadmin'] },
      { href: '/settings', label: 'تنظیمات', icon: <Settings className="size-4" />, roles: ['superadmin'] },
      { href: '/admins', label: 'مدیران', icon: <ShieldCheck className="size-4" />, roles: ['superadmin'] },
      { href: '/audit', label: 'گزارش فعالیت', icon: <ScrollText className="size-4" />, roles: ['superadmin'] },
    ],
  },
];

interface Overview {
  pending: { reports: number; shadow?: number };
}

export function Shell({ admin, children }: { admin: AdminInfo; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data } = useApi<Overview>('admin/v1/stats/overview', { refreshInterval: 60_000 });
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'Vibe Chat';

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-l border-line bg-surface/95 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="brand-gradient grid size-10 place-items-center rounded-2xl text-lg shadow-lg shadow-brand/30">❤</div>
        <div>
          <div className="font-bold">{appName}</div>
          <div className="text-xs text-muted">پنل مدیریت</div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((group) => {
          const items = group.items.filter((i) => i.roles.includes(admin.role));
          if (!items.length) return null;
          return (
            <div key={group.title}>
              <div className="px-3 pb-1.5 text-[11px] font-medium text-faint">{group.title}</div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  const count = item.badge ? data?.pending[item.badge] : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={clsx(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                        active ? 'bg-gradient-to-l from-brand/20 to-transparent text-ink' : 'text-muted hover:bg-white/5 hover:text-ink',
                      )}
                    >
                      <span className={clsx(active && 'text-brand')}>{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {!!count && <span className="brand-gradient rounded-full px-2 py-0.5 text-[11px] font-bold text-white">{fmtNum(count)}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="grid size-9 place-items-center rounded-full bg-violet/20 text-sm font-bold text-violet">
            {(admin.displayName ?? admin.username)[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{admin.displayName ?? admin.username}</div>
            <div className="text-xs text-muted">{ROLE_LABEL[admin.role]}</div>
          </div>
          <button onClick={logout} title="خروج" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-danger">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      <div className="sticky top-0 hidden h-screen shrink-0 lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>{sidebar}</div>
          <div className="flex-1 bg-black/50" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg p-2 hover:bg-white/5">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="font-bold">{appName}</span>
        </div>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
