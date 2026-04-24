export type IncomingMessage =
  | { action: "joinTable"; tableId: string }
  | { action: "syncState"; tableId: string; state: unknown }
  | { action: "claimControl"; tableId: string }
  | { action: "ping" };

export type OutgoingMessage =
  | { type: "joined"; tableId: string; seq: number }
  | { type: "presence"; tableId: string; seq: number }
  | { type: "tableState"; tableId: string; seq: number; state: unknown }
  | { type: "role"; tableId: string; role: "controller" | "viewer" }
  | { type: "controlChanged"; tableId: string; seq: number }
  | { type: "pong"; t: number }
  | { type: "error"; message: string };

export type TableState = {
  sockets: Set<import("ws").WebSocket>;
  seq: number;
  state?: unknown;
  controller?: import("ws").WebSocket;
};
