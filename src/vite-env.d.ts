/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** e.g. wss://abc123.execute-api.us-east-1.amazonaws.com/prod */
  readonly VITE_CARD_ROOM_WS_URL?: string;
  /** e.g. wss://game.example.com/ws */
  readonly VITE_GAME_PLAY_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

