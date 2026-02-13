'use client';

import { useEffect, useRef, useState } from 'react';
import type { WSMessage } from './types';

const WS_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(
  /^http/,
  'ws',
);

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

      const ws = new WebSocket(`${WS_URL}/ws`);
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
