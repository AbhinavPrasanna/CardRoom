import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { IncomingMessage, OutgoingMessage, TableState } from "./types";

const tables = new Map<string, TableState>();

function getOrCreateTable(tableId: string): TableState {
  let t = tables.get(tableId);
  if (!t) {
    t = { sockets: new Set(), seq: 0 };
    tables.set(tableId, t);
  }
  return t;
}

function removeSocketFromAllTables(socket: WebSocket, log: FastifyBaseLogger) {
  for (const [tableId, table] of tables) {
    if (!table.sockets.has(socket)) continue;
    table.sockets.delete(socket);
    log.info({ tableId, remaining: table.sockets.size }, "socket left table");
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
        const table = getOrCreateTable(tableId);
        table.sockets.add(socket);
        table.seq += 1;
        const joined: OutgoingMessage = { type: "joined", tableId, seq: table.seq };
        socket.send(JSON.stringify(joined));
        if (table.sockets.size > 1) {
          table.seq += 1;
          broadcast(tableId, { type: "presence", tableId, seq: table.seq }, socket);
        }
        return;
      }

      socket.send(JSON.stringify({ type: "error", message: "unknown action" } satisfies OutgoingMessage));
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
