import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONN = process.env.CONNECTIONS_TABLE;
const LOBBY = process.env.LOBBIES_TABLE;

function mgmt(event) {
  const { domainName, stage } = event.requestContext;
  return new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });
}

function randomLobbyId() {
  const u = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return u.slice(0, 8);
}

const defaultSeats = ["human", "bot", "bot", "bot", "bot", "bot"];

async function postJson(client, connectionId, obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: data,
      }),
    );
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 410 || e?.name === "GoneException") {
      await ddb.send(new DeleteCommand({ TableName: CONN, Key: { connectionId } }));
    } else {
      console.error("postToConnection", connectionId, e);
    }
  }
}

async function broadcastLobby(event, lobbyId, message) {
  const client = mgmt(event);
  const res = await ddb.send(
    new QueryCommand({
      TableName: CONN,
      IndexName: "byLobby",
      KeyConditionExpression: "lobbyId = :l",
      ExpressionAttributeValues: { ":l": lobbyId },
    }),
  );
  const targets = res.Items ?? [];
  await Promise.all(targets.map((row) => postJson(client, row.connectionId, message)));
}

/** @param {import('aws-lambda').APIGatewayProxyWebsocketEventV2} event */
export async function connect(event) {
  const connectionId = event.requestContext.connectionId;
  const qs = event.queryStringParameters || {};
  const playerName = (qs.playerName || "Player").slice(0, 40);
  await ddb.send(
    new PutCommand({
      TableName: CONN,
      Item: {
        connectionId,
        playerName,
        connectedAt: Date.now(),
      },
    }),
  );
  return { statusCode: 200, body: "connected" };
}

/** @param {import('aws-lambda').APIGatewayProxyWebsocketEventV2} event */
export async function disconnect(event) {
  const connectionId = event.requestContext.connectionId;
  let lobbyId = null;
  try {
    const cur = await ddb.send(new GetCommand({ TableName: CONN, Key: { connectionId } }));
    lobbyId = cur.Item?.lobbyId;
    if (lobbyId) {
      await broadcastLobby(event, lobbyId, {
        type: "presence",
        lobbyId,
        connectionId,
        left: true,
      });
    }
  } catch (e) {
    console.error("disconnect read", e);
  }
  try {
    await ddb.send(new DeleteCommand({ TableName: CONN, Key: { connectionId } }));
  } catch (e) {
    console.error("disconnect delete", e);
  }
  return { statusCode: 200, body: "disconnected" };
}

/** @param {import('aws-lambda').APIGatewayProxyWebsocketEventV2} event */
export async function defaultHandler(event) {
  const connectionId = event.requestContext.connectionId;
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, body: "invalid json" };
  }

  const action = body.action;
  const client = mgmt(event);

  try {
    switch (action) {
      case "createLobby": {
        const lobbyId = randomLobbyId();
        const lobby = {
          id: lobbyId,
          name: typeof body.name === "string" ? body.name.slice(0, 60) : "Your table",
          seats: Array.isArray(body.seats) && body.seats.length === 6 ? body.seats : [...defaultSeats],
          humanBuyIn: Number(body.humanBuyIn) || 1000,
          botBuyIn: Number(body.botBuyIn) || 1000,
        };
        await ddb.send(
          new PutCommand({
            TableName: LOBBY,
            Item: { lobbyId, payload: JSON.stringify(lobby), updatedAt: Date.now() },
          }),
        );
        await ddb.send(
          new PutCommand({
            TableName: CONN,
            Item: {
              connectionId,
              lobbyId,
              playerName: body.playerName || "Host",
              connectedAt: Date.now(),
            },
          }),
        );
        await postJson(client, connectionId, { type: "lobbyCreated", lobby });
        await broadcastLobby(event, lobbyId, { type: "lobbyState", lobby });
        break;
      }
      case "joinLobby": {
        const lobbyId = String(body.lobbyId || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 12);
        if (!lobbyId) {
          await postJson(client, connectionId, { type: "error", message: "lobbyId required" });
          break;
        }
        const got = await ddb.send(new GetCommand({ TableName: LOBBY, Key: { lobbyId } }));
        if (!got.Item?.payload) {
          await postJson(client, connectionId, { type: "error", message: "Lobby not found" });
          break;
        }
        const lobby = JSON.parse(got.Item.payload);
        await ddb.send(
          new PutCommand({
            TableName: CONN,
            Item: {
              connectionId,
              lobbyId,
              playerName: body.playerName || "Player",
              connectedAt: Date.now(),
            },
          }),
        );
        await broadcastLobby(event, lobbyId, { type: "lobbyState", lobby });
        await broadcastLobby(event, lobbyId, {
          type: "presence",
          lobbyId,
          connectionId,
          joined: true,
        });
        break;
      }
      case "syncLobby": {
        const lobby = body.lobby;
        if (!lobby?.id) {
          await postJson(client, connectionId, { type: "error", message: "lobby required" });
          break;
        }
        const lobbyId = String(lobby.id).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
        const curConn = await ddb.send(new GetCommand({ TableName: CONN, Key: { connectionId } }));
        if (curConn.Item?.lobbyId !== lobbyId) {
          await postJson(client, connectionId, { type: "error", message: "Join lobby before syncing" });
          break;
        }
        const normalized = {
          id: lobbyId,
          name: typeof lobby.name === "string" ? lobby.name.slice(0, 60) : "Your table",
          seats: Array.isArray(lobby.seats) && lobby.seats.length === 6 ? lobby.seats : [...defaultSeats],
          humanBuyIn: Math.min(2000, Math.max(500, Number(lobby.humanBuyIn) || 1000)),
          botBuyIn: Math.min(2000, Math.max(500, Number(lobby.botBuyIn) || 1000)),
        };
        await ddb.send(
          new PutCommand({
            TableName: LOBBY,
            Item: { lobbyId, payload: JSON.stringify(normalized), updatedAt: Date.now() },
          }),
        );
        await broadcastLobby(event, lobbyId, { type: "lobbyState", lobby: normalized });
        break;
      }
      case "leaveLobby": {
        const cur = await ddb.send(new GetCommand({ TableName: CONN, Key: { connectionId } }));
        const lobbyId = cur.Item?.lobbyId;
        await ddb.send(
          new UpdateCommand({
            TableName: CONN,
            Key: { connectionId },
            UpdateExpression: "REMOVE lobbyId",
          }),
        );
        if (lobbyId) {
          await broadcastLobby(event, lobbyId, {
            type: "presence",
            lobbyId,
            connectionId,
            left: true,
          });
        }
        await postJson(client, connectionId, { type: "leftLobby" });
        break;
      }
      case "ping": {
        await postJson(client, connectionId, { type: "pong", t: Date.now() });
        break;
      }
      default:
        await postJson(client, connectionId, { type: "error", message: `Unknown action: ${action}` });
    }
  } catch (e) {
    console.error("defaultHandler", action, e);
    try {
      await postJson(client, connectionId, { type: "error", message: String(e?.message || e) });
    } catch (_) {
      /* ignore */
    }
  }

  return { statusCode: 200, body: "ok" };
}
