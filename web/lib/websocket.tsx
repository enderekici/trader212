'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
    const proto =
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:'
        ? 'wss:'
        : 'ws:';
    const host =
      typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return `${proto}//${host}:3001/ws`;
  }
}

type Listener = (msg: WSMessage) => void;

interface WebSocketContextValue {
  connected: boolean;
  subscribe: (listener: Listener) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

/**
 * WebSocketProvider opens a single WebSocket connection and makes it
 * available to all child components via context. Components subscribe
 * to messages through the `useWebSocket` hook.
 */
export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listenersRef = useRef<Set<Listener>>(new Set());

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    async function connect() {
      if (disposed) return;
      if (
        wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }

      const wsUrl = await getAuthenticatedWsUrl();
      if (disposed) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!disposed) setConnected(true);
      };

      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const msg: WSMessage = JSON.parse(ev.data);
          for (const listener of listenersRef.current) {
            listener(msg);
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

  // Stable context value: `connected` changes, but `subscribe` is stable via useCallback
  const value = useRef<WebSocketContextValue>({
    connected: false,
    subscribe,
  });
  value.current.connected = connected;

  // We need to pass a new object when connected changes so consumers re-render
  const contextValue = { connected, subscribe };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

/**
 * Hook to subscribe to WebSocket messages. Maintains the same interface as
 * the previous per-component hook so existing consumers don't break.
 *
 * @param events - Optional array of event types to filter for
 * @returns { lastMessage, connected }
 */
export function useWebSocket(events?: string[]) {
  const ctx = useContext(WebSocketContext);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!ctx) return;

    const unsubscribe = ctx.subscribe((msg: WSMessage) => {
      const filter = eventsRef.current;
      if (!filter || filter.includes(msg.event)) {
        setLastMessage(msg);
      }
    });

    return unsubscribe;
  }, [ctx]);

  return {
    lastMessage,
    connected: ctx?.connected ?? false,
  };
}
