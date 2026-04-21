/**
 * Production WebSocket URL for the online lobby (API Gateway WebSocket stage).
 * Update this after `sam deploy` if the stack output `WebSocketUrl` changes, unless you
 * always set `VITE_CARD_ROOM_WS_URL` in `.env` / CI (recommended for multiple environments).
 */
const EMBEDDED_CARD_ROOM_WS_URL = "wss://qxwayltts8.execute-api.us-west-1.amazonaws.com/prod";

/**
 * Resolves the card-room WebSocket URL: environment variable wins, then embedded default.
 */
export function getCardRoomWsUrl(): string | undefined {
  const fromEnv = import.meta.env.VITE_CARD_ROOM_WS_URL;
  if (typeof fromEnv === "string") {
    const t = fromEnv.trim();
    if (t.length > 0) return t;
  }
  const embedded = EMBEDDED_CARD_ROOM_WS_URL.trim();
  return embedded.length > 0 ? embedded : undefined;
}
