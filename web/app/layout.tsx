import type { Metadata } from 'next';
import { Sidebar } from '@/components/sidebar';
import { HeaderBar } from '@/components/header-bar';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trader212 Dashboard',
  description: 'Autonomous trading bot dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <Providers>
          <Sidebar />
          <main className="ml-56 min-h-screen p-6">
            <HeaderBar />
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
