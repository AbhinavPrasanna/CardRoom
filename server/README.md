# Card Room — WebSocket backend (API Gateway + Lambda + DynamoDB)

This folder contains a **SAM** stack that powers **real-time lobbies**: create/join a room code, sync seat map + buy-ins in **DynamoDB**, and broadcast updates to every WebSocket connection in the lobby.

The React app (Vite) talks to it when `VITE_CARD_ROOM_WS_URL` is set (see `.env.example` in the project root).

## What is deployed

- **API Gateway WebSocket API** (`$connect`, `$disconnect`, `$default`, plus explicit routes for each JSON `action` value)
- **Route selection:** `RouteSelectionExpression` is `$request.body.action`, so every client message must be JSON with a top-level `"action"` field (e.g. `"createLobby"`). Omitting `RouteSelectionExpression` causes **Invalid routeSelectionExpression** on create.
- **Three Lambda functions** (Node.js 20, arm64) in `ws-handlers/`
- **DynamoDB** (on-demand):
  - `LobbiesTable` — partition key `lobbyId`, stores JSON lobby payload
  - `ConnectionsTable` — partition key `connectionId`, GSI `byLobby` (`lobbyId` + `connectionId`) for fan-out

## Wire protocol (summary)

Client sends JSON on the `$default` route:

| `action`      | Purpose                                      |
| ------------- | -------------------------------------------- |
| `createLobby` | New lobby code + host connection             |
| `joinLobby`   | Attach connection to an existing `lobbyId`   |
| `syncLobby`   | Upsert lobby document + broadcast `lobbyState` |
| `leaveLobby`  | Remove `lobbyId` from connection (GSI row)   |
| `ping`        | Server replies `{ type: "pong" }`           |

Server → client messages include `lobbyCreated`, `lobbyState`, `presence`, `error`, etc. (see `src/realtime/wsMessages.ts`).

## Prerequisites

- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- AWS credentials configured (`aws configure` or environment variables)
- Node.js 20+ (for local `npm install` in `ws-handlers`)

## Build and deploy

From **this directory** (`poker-app/server`):

```bash
cd ws-handlers
npm install
cd ../sam
sam build
sam deploy --guided
```

On first deploy, choose a stack name (e.g. `card-room-ws`), region, and confirm defaults. After deploy, copy the **WebSocketUrl** output and set it in the frontend as:

```bash
VITE_CARD_ROOM_WS_URL=wss://xxxxxxxx.execute-api.us-east-1.amazonaws.com/prod
```

Then rebuild the Vite app (`npm run build` in `poker-app`) and host it (Amplify, S3, etc.) with that environment variable.

## Next steps (not implemented here)

- **Authoritative poker**: route `fold` / `call` / `raise` / `newHand` through Lambda, run the same rules engine server-side, and broadcast `gameState` snapshots (or deltas) so clients are thin views.
- **Auth**: validate `$connect` with Cognito JWT in query string or use a custom authorizer.
- **Abuse controls**: rate limits, max lobby size, host-only `syncLobby`.
