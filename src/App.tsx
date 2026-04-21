import { useReducer, useState } from "react";
import "./App.css";
import { LobbyHub, createDefaultLobby, type GameStartConfig, type TableLobby } from "./components/LobbyHub";
import { OnlineLobbyHub } from "./components/OnlineLobbyHub";
import { MusicPlayer } from "./components/MusicPlayer";
import { PokerTable } from "./components/PokerTable";
import { createInitialStateFromSeats, reduceGame } from "./game/engine";
import { getCardRoomWsUrl } from "./config/cardRoomWs";

const WS_URL = getCardRoomWsUrl();

export default function App() {
  const [lobby, setLobby] = useState<TableLobby>(createDefaultLobby);
  const [game, setGame] = useState<GameStartConfig | null>(null);
  const [tableSource, setTableSource] = useState<"local" | "online">("local");

  return (
    <>
      <MusicPlayer />
      {WS_URL && !game ? (
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
        <GameSession key={`${game.lobbyId}-${game.seats.join("")}`} config={game} onLeave={() => setGame(null)} />
      ) : tableSource === "online" && WS_URL ? (
        <OnlineLobbyHub wsUrl={WS_URL} onPlay={setGame} />
      ) : (
        <LobbyHub lobby={lobby} setLobby={setLobby} onPlay={setGame} />
      )}
    </>
  );
}

function GameSession({ config, onLeave }: { config: GameStartConfig; onLeave: () => void }) {
  const [state, dispatch] = useReducer(
    reduceGame,
    undefined,
    () => createInitialStateFromSeats(config.seats, config.humanBuyIn, config.botBuyIn),
  );

  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <h1>Abhinav&apos;s Card Room</h1>
          <p>
            No Limit Texas Hold&apos;em · {config.lobbyName} · Blinds 1 / 2 · You {config.humanBuyIn} chips · Bots{" "}
            {config.botBuyIn} chips
          </p>
        </div>
      </header>
      <PokerTable state={state} dispatch={dispatch} onLeave={onLeave} />
    </div>
  );
}
