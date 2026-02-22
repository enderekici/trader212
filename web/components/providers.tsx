'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from '@/lib/toast-context';
import { WebSocketProvider } from '@/lib/websocket';
import { ToastContainer } from '@/components/toast-container';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <WebSocketProvider>
        {children}
        <ToastContainer />
      </WebSocketProvider>
    </ToastProvider>
  );
}
