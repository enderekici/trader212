'use client';

import { useEffect, useRef, useState } from 'react';
import type { WSMessage } from './types';

/**
 * Fetches the authenticated WebSocket URL from the server.
 * The server-side API route adds the auth token to the URL.
 */
async function getAuthenticatedWsUrl(): Promise<string> {
  try {
    const response = await fetch('/api/ws-url');
    if (!response.ok) {
      throw new Error(`Failed to get WebSocket URL: ${response.statusText}`);
    }
    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('Failed to fetch authenticated WebSocket URL:', error);
    // Fallback to unauthenticated connection
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `${proto}//${host}:3001/ws`;
  }
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

    async function connect() {
      if (disposed) return;
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

      // Fetch authenticated WebSocket URL from server
      const wsUrl = await getAuthenticatedWsUrl();
      const ws = new WebSocket(wsUrl);
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
