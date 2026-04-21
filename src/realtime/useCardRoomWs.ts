import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientAction, ServerMessage } from "./wsMessages";

export type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

function buildWsUrl(base: string, playerName: string): string {
  const u = base.trim().replace(/\/$/, "");
  const qs = new URLSearchParams();
  qs.set("playerName", playerName.slice(0, 40) || "Player");
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}${qs.toString()}`;
}

export function useCardRoomWs(wsBaseUrl: string | undefined) {
  const [status, setStatus] = useState<WsStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef<(msg: ServerMessage) => void>(() => {});

  const setOnMessage = useCallback((fn: (msg: ServerMessage) => void) => {
    onMessageRef.current = fn;
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("closed");
  }, []);

  const connect = useCallback(
    (playerName: string) => {
      if (!wsBaseUrl) {
        setLastError("WebSocket URL not configured");
        setStatus("error");
        return;
      }
      disconnect();
      setLastError(null);
      setStatus("connecting");
      const url = buildWsUrl(wsBaseUrl, playerName);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => setStatus("open");
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setStatus((s) => (s === "connecting" ? "closed" : "closed"));
      };
      ws.onerror = () => {
        setLastError("WebSocket error");
        setStatus("error");
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as ServerMessage;
          onMessageRef.current(msg);
        } catch {
          setLastError("Invalid message from server");
        }
      };
    },
    [wsBaseUrl, disconnect],
  );

  const send = useCallback((action: ClientAction) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(action));
    return true;
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return { status, lastError, connect, disconnect, send, setOnMessage };
}
