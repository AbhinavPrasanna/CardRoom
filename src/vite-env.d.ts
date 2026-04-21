/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** e.g. wss://abc123.execute-api.us-east-1.amazonaws.com/prod */
  readonly VITE_CARD_ROOM_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

