import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { LobbyHub, createDefaultLobby, type GameStartConfig, type TableLobby } from "./components/LobbyHub";
import { OnlineLobbyHub } from "./components/OnlineLobbyHub";
import { MusicPlayer } from "./components/MusicPlayer";
import { PokerTable } from "./components/PokerTable";
import { createInitialStateFromSeats, reduceGame } from "./game/engine";
import type { GameAction, GameState } from "./game/types";
import { getCardRoomWsUrl } from "./config/cardRoomWs";
import { getGamePlayWsUrl } from "./config/gamePlayWs";

const CARD_ROOM_WS_URL = getCardRoomWsUrl();
const GAME_PLAY_WS_URL = getGamePlayWsUrl();

export default function App() {
  const [lobby, setLobby] = useState<TableLobby>(createDefaultLobby);
  const [game, setGame] = useState<GameStartConfig | null>(null);
  const [tableSource, setTableSource] = useState<"local" | "online">("local");

  return (
    <>
      <MusicPlayer />
      {CARD_ROOM_WS_URL && !game ? (
        <div className="app-shell" style={{ paddingTop: "0.75rem", paddingBottom: 0 }}>
          <div className="lobby-toolbar" style={{ marginBottom: "0.5rem" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>Lobby mode</span>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className={tableSource === "local" ? "btn btn-primary" : "btn btn-secondary"}
                onClick={() => setTableSource("local")}
              >
                Local only
              </button>
              <button
                type="button"
                className={tableSource === "online" ? "btn btn-primary" : "btn btn-secondary"}
                onClick={() => setTableSource("online")}
              >
                Online lobby (AWS)
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {game ? (
        <GameSession
          key={`${game.lobbyId}-${tableSource}-${game.seats.join("")}`}
          config={game}
          gamePlayWsUrl={tableSource === "online" ? GAME_PLAY_WS_URL : undefined}
          onLeave={() => setGame(null)}
        />
      ) : tableSource === "online" && CARD_ROOM_WS_URL ? (
        <OnlineLobbyHub wsUrl={CARD_ROOM_WS_URL} onPlay={setGame} />
      ) : (
        <LobbyHub lobby={lobby} setLobby={setLobby} onPlay={setGame} />
      )}
    </>
  );
}

type GameWsIncoming =
  | { type: "joined"; tableId: string; seq: number }
  | { type: "presence"; tableId: string; seq: number }
  | { type: "tableState"; tableId: string; seq: number; state: unknown }
  | { type: "role"; tableId: string; role: "controller" | "viewer" }
  | { type: "controlChanged"; tableId: string; seq: number }
  | { type: "pong"; t: number }
  | { type: "error"; message: string };

function looksLikeGameState(v: unknown): v is GameState {
  if (!v || typeof v !== "object") return false;
  const o = v as Partial<GameState>;
  return Array.isArray(o.players) && Array.isArray(o.board) && typeof o.street === "string";
}

function GameSession({
  config,
  gamePlayWsUrl,
  onLeave,
}: {
  config: GameStartConfig;
  gamePlayWsUrl?: string;
  onLeave: () => void;
}) {
  const multiplayerEnabled = Boolean(gamePlayWsUrl && config.lobbyId);
  const [state, setState] = useState<GameState>(() =>
    createInitialStateFromSeats(config.seats, config.humanBuyIn, config.botBuyIn),
  );
  const [isGameWsConnected, setIsGameWsConnected] = useState(!multiplayerEnabled);
  const [isController, setIsController] = useState(!multiplayerEnabled);
  const [syncHint, setSyncHint] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const receivedRemoteStateRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const publishState = useCallback(
    (nextState: GameState) => {
      if (!multiplayerEnabled || !isController) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          action: "syncState",
          tableId: config.lobbyId,
          state: nextState,
        }),
      );
    },
    [multiplayerEnabled, isController, config.lobbyId],
  );

  const requestControl = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !multiplayerEnabled) return;
    ws.send(JSON.stringify({ action: "claimControl", tableId: config.lobbyId }));
  }, [multiplayerEnabled, config.lobbyId]);

  const dispatch = useCallback(
    (action: GameAction) => {
      if (multiplayerEnabled && !isController) return;
      setState((prev) => {
        const next = reduceGame(prev, action);
        publishState(next);
        return next;
      });
    },
    [multiplayerEnabled, isController, publishState],
  );

  useEffect(() => {
    if (!multiplayerEnabled || !gamePlayWsUrl) return;
    const playerName =
      (typeof localStorage !== "undefined" && localStorage.getItem("card-room-player-name")) || "Player";
    const sep = gamePlayWsUrl.includes("?") ? "&" : "?";
    const ws = new WebSocket(`${gamePlayWsUrl}${sep}playerName=${encodeURIComponent(playerName)}`);
    wsRef.current = ws;
    receivedRemoteStateRef.current = false;

    ws.onopen = () => {
      setIsGameWsConnected(true);
      setSyncHint(null);
      ws.send(JSON.stringify({ action: "joinTable", tableId: config.lobbyId }));
    };
    ws.onclose = () => {
      setIsGameWsConnected(false);
      setSyncHint("Gameplay sync disconnected.");
      if (wsRef.current === ws) wsRef.current = null;
    };
    ws.onerror = () => {
      setSyncHint("Gameplay sync error.");
    };
    ws.onmessage = (ev) => {
      let msg: GameWsIncoming;
      try {
        msg = JSON.parse(String(ev.data)) as GameWsIncoming;
      } catch {
        return;
      }
      if (msg.type === "error") {
        setSyncHint(msg.message);
        return;
      }
      if (msg.type === "role" && msg.tableId === config.lobbyId) {
        const controller = msg.role === "controller";
        setIsController(controller);
        if (controller) setSyncHint("You control this table.");
        return;
      }
      if (msg.type === "tableState" && msg.tableId === config.lobbyId && looksLikeGameState(msg.state)) {
        receivedRemoteStateRef.current = true;
        setState(msg.state);
        return;
      }
      if (msg.type === "controlChanged" && msg.tableId === config.lobbyId) {
        setSyncHint("Control changed.");
      }
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [multiplayerEnabled, gamePlayWsUrl, config.lobbyId]);

  useEffect(() => {
    if (!multiplayerEnabled || !isController || !isGameWsConnected) return;
    if (receivedRemoteStateRef.current) return;
    publishState(stateRef.current);
  }, [multiplayerEnabled, isController, isGameWsConnected, publishState]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <h1>Abhinav&apos;s Card Room</h1>
          <p>
            No Limit Texas Hold&apos;em · {config.lobbyName} · Blinds 1 / 2 · You {config.humanBuyIn} chips · Bots{" "}
            {config.botBuyIn} chips
          </p>
          {multiplayerEnabled ? (
            <p style={{ marginTop: "0.35rem", color: "var(--muted)" }}>
              Live sync: {isGameWsConnected ? "connected" : "disconnected"} · Role:{" "}
              {isController ? "controller" : "viewer"}
              {syncHint ? ` · ${syncHint}` : ""}
            </p>
          ) : null}
        </div>
      </header>
      <PokerTable
        state={state}
        dispatch={dispatch}
        onLeave={onLeave}
        isController={isController}
        onTakeControl={multiplayerEnabled ? requestControl : undefined}
      />
    </div>
  );
}
