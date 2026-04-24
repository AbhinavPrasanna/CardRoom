export type IncomingMessage =
  | { action: "joinTable"; tableId: string }
  | { action: "ping" };

export type OutgoingMessage =
  | { type: "joined"; tableId: string; seq: number }
  | { type: "presence"; tableId: string; seq: number }
  | { type: "pong"; t: number }
  | { type: "error"; message: string };

export type TableState = {
  sockets: Set<import("ws").WebSocket>;
  seq: number;
};
