/**
 * True multiplayer gameplay WebSocket endpoint (Fargate/ALB service).
 * Override via VITE_GAME_PLAY_WS_URL in Amplify/environment.
 */
const EMBEDDED_GAME_PLAY_WS_URL = "wss://game.abspokergame.click/ws";

export function getGamePlayWsUrl(): string | undefined {
  const fromEnv = import.meta.env.VITE_GAME_PLAY_WS_URL;
  if (typeof fromEnv === "string") {
    const t = fromEnv.trim();
    if (t.length > 0) return t;
  }
  const embedded = EMBEDDED_GAME_PLAY_WS_URL.trim();
  return embedded.length > 0 ? embedded : undefined;
}

