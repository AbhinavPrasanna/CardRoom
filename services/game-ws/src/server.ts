import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { IncomingMessage, OutgoingMessage, TableState } from "./types";

const tables = new Map<string, TableState>();
const socketTable = new WeakMap<WebSocket, string>();
const socketPlayer = new WeakMap<WebSocket, string>();

function normalizePlayerName(raw: unknown): string {
  const t = String(raw ?? "Player").trim();
  return (t.length > 0 ? t : "Player").slice(0, 40);
}

function getOrCreateTable(tableId: string): TableState {
  let t = tables.get(tableId);
  if (!t) {
    t = { sockets: new Set(), seq: 0, seatOwners: {} };
    tables.set(tableId, t);
  }
  return t;
}

function sendRole(tableId: string, table: TableState, socket: WebSocket) {
  const playerName = socketPlayer.get(socket) ?? "Player";
  const msg: OutgoingMessage = {
    type: "role",
    tableId,
    role: table.controllerName === playerName ? "controller" : "viewer",
    playerName,
  };
  socket.send(JSON.stringify(msg));
}

function sendRolesToTable(tableId: string, table: TableState) {
  for (const s of table.sockets) {
    if (s.readyState !== 1) continue;
    sendRole(tableId, table, s);
  }
}

function sendSeatOwners(tableId: string, table: TableState, socket?: WebSocket) {
  const msg: OutgoingMessage = { type: "seatOwners", tableId, seatOwners: table.seatOwners };
  if (socket) {
    if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    return;
  }
  broadcast(tableId, msg);
}

function removeSocketFromAllTables(socket: WebSocket, log: FastifyBaseLogger) {
  for (const [tableId, table] of tables) {
    if (!table.sockets.has(socket)) continue;
    const leavingName = socketPlayer.get(socket) ?? "Player";
    table.sockets.delete(socket);
    socketTable.delete(socket);
    socketPlayer.delete(socket);
    log.info({ tableId, remaining: table.sockets.size }, "socket left table");
    if (table.controllerName === leavingName) {
      const stillHasOwner = [...table.sockets].some((s) => (socketPlayer.get(s) ?? "Player") === leavingName);
      if (!stillHasOwner) {
        table.controllerName = table.sockets.size ? socketPlayer.get(table.sockets.values().next().value as WebSocket) : undefined;
        table.seq += 1;
        if (table.controllerName) {
          broadcast(tableId, { type: "controlChanged", tableId, seq: table.seq });
        }
      }
      sendRolesToTable(tableId, table);
    }
    let ownersChanged = false;
    for (const [seat, owner] of Object.entries(table.seatOwners)) {
      if (owner !== leavingName) continue;
      const stillHasOwner = [...table.sockets].some((s) => (socketPlayer.get(s) ?? "Player") === leavingName);
      if (!stillHasOwner) {
        delete table.seatOwners[seat];
        ownersChanged = true;
      }
    }
    if (ownersChanged) sendSeatOwners(tableId, table);
    if (table.sockets.size > 0) {
      table.seq += 1;
      broadcast(tableId, { type: "presence", tableId, seq: table.seq }, socket);
    } else {
      tables.delete(tableId);
      log.info({ tableId }, "removed empty table");
    }
  }
}

function broadcast(tableId: string, msg: OutgoingMessage, exclude?: WebSocket) {
  const table = tables.get(tableId);
  if (!table) return;
  const raw = JSON.stringify(msg);
  for (const s of table.sockets) {
    if (s === exclude) continue;
    if (s.readyState === 1) s.send(raw);
  }
}

async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(websocket);

  app.get("/health", async (_req, reply) => {
    await reply.type("text/plain").send("ok");
  });

  // @fastify/websocket v11+: (socket, request) — socket is a ws WebSocket
  app.get("/ws", { websocket: true }, (socket, _req) => {
    socket.on("message", (buf) => {
      let data: IncomingMessage;
      try {
        data = JSON.parse(String(buf)) as IncomingMessage;
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "invalid json" } satisfies OutgoingMessage));
        return;
      }

      if (data.action === "ping") {
        const pong: OutgoingMessage = { type: "pong", t: Date.now() };
        socket.send(JSON.stringify(pong));
        return;
      }

      if (data.action === "joinTable") {
        const tableId = String(data.tableId || "").slice(0, 64);
        if (!tableId) {
          socket.send(JSON.stringify({ type: "error", message: "tableId required" } satisfies OutgoingMessage));
          return;
        }
        const playerName = normalizePlayerName(data.playerName);
        const table = getOrCreateTable(tableId);
        table.sockets.add(socket);
        socketTable.set(socket, tableId);
        socketPlayer.set(socket, playerName);
        if (!table.controllerName) table.controllerName = playerName;
        table.seq += 1;
        const joined: OutgoingMessage = { type: "joined", tableId, seq: table.seq };
        socket.send(JSON.stringify(joined));
        sendRole(tableId, table, socket);
        sendSeatOwners(tableId, table, socket);
        if (table.state !== undefined) {
          socket.send(
            JSON.stringify({
              type: "tableState",
              tableId,
              seq: table.seq,
              state: table.state,
            } satisfies OutgoingMessage),
          );
        }
        if (table.sockets.size > 1) {
          table.seq += 1;
          broadcast(tableId, { type: "presence", tableId, seq: table.seq }, socket);
        }
        return;
      }

      if (data.action === "takeSeat") {
        const tableId = socketTable.get(socket);
        const seat = Number(data.seat);
        if (!tableId || tableId !== data.tableId || !Number.isInteger(seat) || seat < 0 || seat > 5) {
          socket.send(JSON.stringify({ type: "error", message: "invalid seat claim" } satisfies OutgoingMessage));
          return;
        }
        const table = tables.get(tableId);
        if (!table) return;
        const playerName = socketPlayer.get(socket) ?? "Player";
        const current = table.seatOwners[String(seat)];
        if (current && current !== playerName) {
          socket.send(JSON.stringify({ type: "error", message: "seat already owned" } satisfies OutgoingMessage));
          return;
        }
        table.seatOwners[String(seat)] = playerName;
        table.seq += 1;
        sendSeatOwners(tableId, table);
        return;
      }

      if (data.action === "leaveSeat") {
        const tableId = socketTable.get(socket);
        const seat = Number(data.seat);
        if (!tableId || tableId !== data.tableId || !Number.isInteger(seat) || seat < 0 || seat > 5) {
          socket.send(JSON.stringify({ type: "error", message: "invalid seat release" } satisfies OutgoingMessage));
          return;
        }
        const table = tables.get(tableId);
        if (!table) return;
        const playerName = socketPlayer.get(socket) ?? "Player";
        if (table.seatOwners[String(seat)] !== playerName) {
          socket.send(JSON.stringify({ type: "error", message: "you do not own this seat" } satisfies OutgoingMessage));
          return;
        }
        delete table.seatOwners[String(seat)];
        table.seq += 1;
        sendSeatOwners(tableId, table);
        return;
      }

      if (data.action === "gameAction") {
        const tableId = socketTable.get(socket);
        const seat = Number(data.seat);
        if (!tableId || tableId !== data.tableId || !Number.isInteger(seat) || seat < 0 || seat > 5) {
          socket.send(JSON.stringify({ type: "error", message: "invalid action seat" } satisfies OutgoingMessage));
          return;
        }
        const table = tables.get(tableId);
        if (!table) return;
        const playerName = socketPlayer.get(socket) ?? "Player";
        if (table.seatOwners[String(seat)] !== playerName) {
          socket.send(JSON.stringify({ type: "error", message: "you do not own this seat" } satisfies OutgoingMessage));
          return;
        }
        const st = table.state as { activeSeat?: number | null } | undefined;
        const at = st?.activeSeat;
        if (typeof at === "number" && at !== seat && (data.gameAction as { type?: string })?.type !== "NEW_HAND") {
          socket.send(JSON.stringify({ type: "error", message: "not your turn" } satisfies OutgoingMessage));
          return;
        }
        table.seq += 1;
        broadcast(
          tableId,
          {
            type: "actionAccepted",
            tableId,
            seat,
            gameAction: data.gameAction,
            seq: table.seq,
          } satisfies OutgoingMessage,
        );
        return;
      }

      if (data.action === "syncState") {
        const tableId = socketTable.get(socket);
        if (!tableId || tableId !== data.tableId) {
          socket.send(JSON.stringify({ type: "error", message: "join table first" } satisfies OutgoingMessage));
          return;
        }
        const table = tables.get(tableId);
        if (!table) return;
        const playerName = socketPlayer.get(socket) ?? "Player";
        if (table.controllerName !== playerName) {
          socket.send(JSON.stringify({ type: "error", message: "only controller can sync" } satisfies OutgoingMessage));
          return;
        }
        table.state = data.state;
        table.seq += 1;
        broadcast(
          tableId,
          {
            type: "tableState",
            tableId,
            seq: table.seq,
            state: table.state,
          },
        );
        return;
      }

      if (data.action === "claimControl") {
        const tableId = socketTable.get(socket);
        if (!tableId || tableId !== data.tableId) {
          socket.send(JSON.stringify({ type: "error", message: "join table first" } satisfies OutgoingMessage));
          return;
        }
        const table = tables.get(tableId);
        if (!table) return;
        const playerName = socketPlayer.get(socket) ?? "Player";
        if (table.controllerName !== playerName) {
          table.controllerName = playerName;
          table.seq += 1;
          broadcast(tableId, { type: "controlChanged", tableId, seq: table.seq });
        }
        sendRolesToTable(tableId, table);
        return;
      }

      // Helpful backward-compat response when lobby actions are accidentally sent here.
      if (
        (data as { action?: string }).action === "createLobby" ||
        (data as { action?: string }).action === "joinLobby" ||
        (data as { action?: string }).action === "syncLobby" ||
        (data as { action?: string }).action === "leaveLobby"
      ) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "This endpoint is for gameplay sync only. Use the card-room endpoint for lobby actions.",
          } satisfies OutgoingMessage),
        );
        return;
      }

      const action = (data as { action?: string }).action;
      app.log.warn({ action }, "unknown action received");
      socket.send(
        JSON.stringify(
          {
            type: "error",
            message: `unknown action${typeof action === "string" ? `: ${action}` : ""}`,
          } satisfies OutgoingMessage,
        ),
      );
    });

    socket.on("close", () => removeSocketFromAllTables(socket, app.log));
    socket.on("error", () => removeSocketFromAllTables(socket, app.log));
  });

  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT) || 8080;
  const host = "0.0.0.0";

  const shutdown = async () => {
    app.log.info("shutting down");
    for (const table of tables.values()) {
      for (const s of table.sockets) {
        try {
          s.close(1001, "server stop");
        } catch {
          /* ignore */
        }
      }
    }
    tables.clear();
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  await app.listen({ port, host });
  app.log.info({ port, host }, "listening");
}

void main();
