import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  | { type: "role"; tableId: string; role: "controller" | "viewer"; playerName?: string }
  | { type: "seatOwners"; tableId: string; seatOwners: Record<string, string> }
  | { type: "actionAccepted"; tableId: string; seat: number; gameAction: unknown; seq: number }
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
    createInitialStateFromSeats(
      config.seats,
      config.minBuyIn,
      config.maxBuyIn,
      config.smallBlind,
      config.bigBlind,
      config.seatBuyIns,
    ),
  );
  const [playerName] = useState(() => {
    if (typeof localStorage === "undefined") return "Player";
    return (localStorage.getItem("card-room-player-name") || "Player").slice(0, 40);
  });
  const [seatOwners, setSeatOwners] = useState<Record<string, string>>({});
  const [isGameWsConnected, setIsGameWsConnected] = useState(!multiplayerEnabled);
  const [isController, setIsController] = useState(!multiplayerEnabled);
  const [syncHint, setSyncHint] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const receivedRemoteStateRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const isControllerRef = useRef(isController);
  isControllerRef.current = isController;

  const publishState = useCallback(
    (nextState: GameState) => {
      if (!multiplayerEnabled || !isControllerRef.current) return;
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
    [multiplayerEnabled, config.lobbyId],
  );

  const localSeat = useMemo(() => {
    if (multiplayerEnabled) {
      const entry = Object.entries(seatOwners).find(([, owner]) => owner === playerName);
      if (!entry) return null;
      const n = Number(entry[0]);
      return Number.isInteger(n) ? n : null;
    }
    const fromState = state.players.find((p) => p.isLocal)?.seat;
    return typeof fromState === "number" ? fromState : null;
  }, [multiplayerEnabled, seatOwners, playerName, state.players]);

  const requestControl = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !multiplayerEnabled) return;
    ws.send(JSON.stringify({ action: "claimControl", tableId: config.lobbyId }));
  }, [multiplayerEnabled, config.lobbyId]);

  const takeSeat = useCallback(
    (seat: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !multiplayerEnabled) return;
      ws.send(JSON.stringify({ action: "takeSeat", tableId: config.lobbyId, seat }));
    },
    [multiplayerEnabled, config.lobbyId],
  );

  const leaveSeat = useCallback(
    (seat: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !multiplayerEnabled) return;
      ws.send(JSON.stringify({ action: "leaveSeat", tableId: config.lobbyId, seat }));
    },
    [multiplayerEnabled, config.lobbyId],
  );

  const dispatch = useCallback(
    (action: GameAction) => {
      if (!multiplayerEnabled) {
        setState((prev) => reduceGame(prev, action));
        return;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const controllerOnly = action.type === "NEW_HAND" || action.type === "RUNOUT_STEP";
      if (controllerOnly) {
        if (!isControllerRef.current) return;
        ws.send(
          JSON.stringify({
            action: "gameAction",
            tableId: config.lobbyId,
            seat: localSeat ?? 0,
            gameAction: action,
          }),
        );
        return;
      }
      if (localSeat == null) return;
      ws.send(JSON.stringify({ action: "gameAction", tableId: config.lobbyId, seat: localSeat, gameAction: action }));
    },
    [multiplayerEnabled, localSeat, config.lobbyId],
  );

  const publishStateRef = useRef(publishState);
  publishStateRef.current = publishState;

  const applyControllerAction = useCallback((action: GameAction) => {
    if (!isControllerRef.current) return;
    flushSync(() => {
      setState((prev) => reduceGame(prev, action));
    });
    publishStateRef.current(stateRef.current);
  }, []);

  useEffect(() => {
    if (!multiplayerEnabled || !gamePlayWsUrl) return;
    const sep = gamePlayWsUrl.includes("?") ? "&" : "?";
    const ws = new WebSocket(`${gamePlayWsUrl}${sep}playerName=${encodeURIComponent(playerName)}`);
    wsRef.current = ws;
    receivedRemoteStateRef.current = false;

    ws.onopen = () => {
      setIsGameWsConnected(true);
      setSyncHint(null);
      ws.send(JSON.stringify({ action: "joinTable", tableId: config.lobbyId, playerName }));
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
      if (msg.type === "seatOwners" && msg.tableId === config.lobbyId) {
        setSeatOwners(msg.seatOwners ?? {});
        return;
      }
      if (msg.type === "role" && msg.tableId === config.lobbyId) {
        const controller = msg.role === "controller";
        setIsController(controller);
        if (controller) {
          setSyncHint("You are the table controller (deal cards; your browser applies everyone’s plays).");
        } else {
          setSyncHint("Connected — claim a seat to act on your turn.");
        }
        return;
      }
      if (msg.type === "actionAccepted" && msg.tableId === config.lobbyId) {
        if (looksLikeGameAction(msg.gameAction)) {
          applyControllerAction(msg.gameAction);
        }
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
  }, [multiplayerEnabled, gamePlayWsUrl, config.lobbyId, playerName, applyControllerAction]);

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
            No Limit Texas Hold&apos;em · {config.lobbyName} · Blinds {config.smallBlind} / {config.bigBlind} · Buy-in{" "}
            {config.minBuyIn}–{config.maxBuyIn}
          </p>
          {multiplayerEnabled ? (
            <p style={{ marginTop: "0.35rem", color: "var(--muted)" }}>
              Live sync: {isGameWsConnected ? "connected" : "disconnected"} · Role:{" "}
              {isController ? "controller" : "viewer"}
              {localSeat != null ? ` · Seat ${localSeat}` : " · No seat claimed"}
              {syncHint ? ` · ${syncHint}` : ""}
            </p>
          ) : null}
          {multiplayerEnabled ? (
            <div style={{ marginTop: "0.45rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {[0, 1, 2, 3, 4, 5].map((seat) => {
                const owner = seatOwners[String(seat)];
                const mine = owner === playerName;
                const canClaim = !owner || mine;
                return (
                  <button
                    key={seat}
                    type="button"
                    className={mine ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                    disabled={!canClaim}
                    onClick={() => (mine ? leaveSeat(seat) : takeSeat(seat))}
                    title={owner ? `Owned by ${owner}` : "Unclaimed"}
                  >
                    Seat {seat}: {mine ? "Leave" : owner ? owner : "Claim"}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </header>
      <PokerTable
        state={state}
        dispatch={dispatch}
        onLeave={onLeave}
        isController={isController}
        onTakeControl={multiplayerEnabled ? requestControl : undefined}
        localSeat={localSeat}
        seatOwners={seatOwners}
        playerName={playerName}
        onClaimSeat={multiplayerEnabled ? takeSeat : undefined}
        onLeaveSeat={multiplayerEnabled ? leaveSeat : undefined}
      />
    </div>
  );
}

function looksLikeGameAction(v: unknown): v is GameAction {
  if (!v || typeof v !== "object") return false;
  const t = (v as { type?: unknown }).type;
  return (
    t === "NEW_HAND" ||
    t === "FOLD" ||
    t === "CHECK" ||
    t === "CALL" ||
    t === "RUNOUT_STEP" ||
    t === "RAISE"
  );
}
