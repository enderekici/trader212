'use client';

import { useEffect, useRef, useState } from 'react';
import type { WSMessage } from './types';

// Derive the WebSocket URL at runtime from the browser's current location.
// The backend WebSocket runs on port 3001 (same host, different port).
// Override with NEXT_PUBLIC_WS_URL if the backend is on a different host.
function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.hostname}:3001`;
  }
  return 'ws://localhost:3001';
}

export function useWebSocket(events?: string[]) {
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

      const ws = new WebSocket(`${getWsUrl()}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!disposed) setConnected(true);
      };

      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const msg: WSMessage = JSON.parse(ev.data);
          const filter = eventsRef.current;
          if (!filter || filter.includes(msg.event)) {
            setLastMessage(msg);
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { lastMessage, connected };
}
