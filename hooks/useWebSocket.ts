import { useCallback, useEffect, useRef, useState } from 'react';
import { createWebSocketClient, type WebSocketClient } from '@/lib/websocket';

// Strict interfaces for WebSocket events
interface WebSocketMessage<T = unknown> {
  type: string;
  data: T;
  timestamp: number;
}

interface ConnectionEvent {
  status: 'connected' | 'disconnected' | 'error';
  message?: string;
}

interface BountyUpdate {
  id: string;
  title: string;
  status: 'open' | 'in-progress' | 'completed' | 'cancelled';
  applicants: number;
  updatedAt: string;
}

interface CreatorUpdate {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  updatedAt: string;
}

interface ApplicationUpdate {
  id: string;
  bountyId: string;
  creatorId: string;
  status: 'pending' | 'accepted' | 'rejected';
  appliedAt: string;
}

type WebSocketEventType = BountyUpdate | CreatorUpdate | ApplicationUpdate;

interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: WebSocketMessage<WebSocketEventType>) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (event: ConnectionEvent) => void;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

/**
 * Custom React hook for managing WebSocket connections with automatic reconnection and lifecycle handling.
 *
 * This hook is a thin React wrapper around the shared `lib/websocket` client so
 * there is a single websocket implementation (reconnect + auth) across the app.
 *
 * Key capabilities:
 * - Automatically connects to the provided WebSocket URL and cleans up on unmount
 * - Handles reconnection with configurable attempt counts and backoff delay
 * - Parses incoming messages and dispatches errors when parsing fails
 * - Tracks connection state (`isConnected`) and notifies on connection transitions
 * - Provides a safe `send` method that validates socket readiness
 * - Provides a manual `disconnect` method that prevents zombie reconnect loops
 *
 * @param options - Configuration options for the WebSocket connection
 * @param options.url - The WebSocket server endpoint URL
 * @param options.onMessage - Optional callback invoked when a parsed message is received
 * @param options.onError - Optional callback invoked on connection or message parsing error
 * @param options.onConnectionChange - Optional callback invoked on connection state transitions
 * @param options.reconnectAttempts - Maximum number of reconnection attempts before giving up (default: 5)
 * @param options.reconnectDelay - Delay in milliseconds between reconnection attempts (default: 3000)
 * @returns An object containing `isConnected` status, `send` function to transmit messages, and `disconnect` function
 */
export function useWebSocket({
  url,
  onMessage,
  onError,
  onConnectionChange,
  reconnectAttempts = 5,
  reconnectDelay = 3000,
}: UseWebSocketOptions) {
  const clientRef = useRef<WebSocketClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Store callbacks in refs so the client doesn't need to depend on them
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onConnectionChangeRef = useRef(onConnectionChange);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    onConnectionChangeRef.current = onConnectionChange;
  }, [onMessage, onError, onConnectionChange]);

  const send = useCallback(
    (message: WebSocketMessage<WebSocketEventType>) => {
      const client = clientRef.current;
      if (client?.isConnected()) {
        client.send(message);
      } else {
        const error = new Error('WebSocket is not connected');
        onErrorRef.current?.(error);
      }
    },
    []
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setIsConnected(false);
  }, []);

  useEffect(() => {
    const client = createWebSocketClient({
      url,
      reconnectAttempts,
      reconnectDelay,
      onMessage: (message) => {
        onMessageRef.current?.(message as WebSocketMessage<WebSocketEventType>);
      },
      onError: (error) => {
        onErrorRef.current?.(error);
      },
      onConnectionChange: (event) => {
        setIsConnected(event.status === 'connected');
        onConnectionChangeRef.current?.(event);
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [url, reconnectAttempts, reconnectDelay]);

  return {
    isConnected,
    send,
    disconnect,
  };
}
