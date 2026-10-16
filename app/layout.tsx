import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChickenSee Synced Portal | Optiplex & Vercel Blob',
  description: 'Vercel portal for synchronized poultry behavior reports, environmental sensor readings, videos, and SQLite data',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f7f8fa] text-slate-900 antialiased selection:bg-orange-200 selection:text-orange-950">
        {children}
      </body>
    </html>
  );
}
