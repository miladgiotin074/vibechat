import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { currentAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  if (!admin) redirect('/login');
  return <Shell admin={admin}>{children}</Shell>;
}
