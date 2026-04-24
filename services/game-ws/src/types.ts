export type IncomingMessage =
  | { action: "joinTable"; tableId: string; playerName?: string }
  | { action: "takeSeat"; tableId: string; seat: number }
  | { action: "leaveSeat"; tableId: string; seat: number }
  | { action: "gameAction"; tableId: string; seat: number; gameAction: unknown }
  | { action: "syncState"; tableId: string; state: unknown }
  | { action: "claimControl"; tableId: string }
  | { action: "ping" };

export type OutgoingMessage =
  | { type: "joined"; tableId: string; seq: number }
  | { type: "presence"; tableId: string; seq: number }
  | { type: "tableState"; tableId: string; seq: number; state: unknown }
  | { type: "role"; tableId: string; role: "controller" | "viewer"; playerName?: string }
  | { type: "seatOwners"; tableId: string; seatOwners: Record<string, string> }
  | { type: "actionAccepted"; tableId: string; seat: number; gameAction: unknown; seq: number }
  | { type: "controlChanged"; tableId: string; seq: number }
  | { type: "pong"; t: number }
  | { type: "error"; message: string };

export type TableState = {
  sockets: Set<import("ws").WebSocket>;
  seq: number;
  state?: unknown;
  controllerName?: string;
  seatOwners: Record<string, string>;
};
