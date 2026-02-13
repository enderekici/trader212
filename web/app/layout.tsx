import type { Metadata } from 'next';
import { Sidebar } from '@/components/sidebar';
import { HeaderBar } from '@/components/header-bar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trader212 Dashboard',
  description: 'AI-powered autonomous trading bot dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <Sidebar />
        <main className="ml-56 min-h-screen p-6">
          <HeaderBar />
          {children}
        </main>
      </body>
    </html>
  );
}
