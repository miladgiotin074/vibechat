import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const vazir = localFont({
  src: [
    { path: './fonts/vazirmatn_regular.ttf', weight: '400' },
    { path: './fonts/vazirmatn_medium.ttf', weight: '500' },
    { path: './fonts/vazirmatn_semibold.ttf', weight: '600' },
    { path: './fonts/vazirmatn_bold.ttf', weight: '700' },
  ],
  variable: '--font-vazir',
  display: 'swap',
});

export const metadata: Metadata = {
  title: `پنل مدیریت ${process.env.NEXT_PUBLIC_APP_NAME ?? 'Vibe Chat'}`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazir.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
