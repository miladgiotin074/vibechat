'use client';

import { Lock, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'Vibe Chat';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? 'ورود ناموفق بود');
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-brand/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-20 size-[28rem] rounded-full bg-violet/20 blur-[120px]" />
      <form onSubmit={submit} className="card relative w-full max-w-sm space-y-5 p-8 shadow-2xl">
        <div className="text-center">
          <div className="brand-gradient mx-auto mb-4 grid size-16 place-items-center rounded-3xl text-3xl shadow-xl shadow-brand/30">❤</div>
          <h1 className="text-xl font-bold">
            پنل مدیریت <span className="text-gradient">{appName}</span>
          </h1>
          <p className="mt-1 text-sm text-muted">برای ادامه وارد شوید</p>
        </div>
        <div className="relative">
          <User className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            className="field pr-9"
            placeholder="نام کاربری"
            autoComplete="username"
            dir="ltr"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            className="field pr-9"
            placeholder="رمز عبور"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-center text-sm text-danger">{error}</div>}
        <Button variant="primary" className="w-full" loading={loading} type="submit">
          ورود
        </Button>
      </form>
    </div>
  );
}
