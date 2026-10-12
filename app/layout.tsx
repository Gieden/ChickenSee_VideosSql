import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChickenSee Synced Portal | Optiplex & Vercel Blob',
  description: 'Automated video & SQLite database synchronization portal from local Optiplex server to Vercel',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
