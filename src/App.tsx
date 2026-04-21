import { useReducer, useState } from "react";
import "./App.css";
import { LobbyHub, initialLobbies, type GameStartConfig, type TableLobby } from "./components/LobbyHub";
import { MusicPlayer } from "./components/MusicPlayer";
import { PokerTable } from "./components/PokerTable";
import { createInitialStateFromSeats, reduceGame } from "./game/engine";

export default function App() {
  const [lobbies, setLobbies] = useState<TableLobby[]>(initialLobbies);
  const [game, setGame] = useState<GameStartConfig | null>(null);

  return (
    <>
      <MusicPlayer />
      {game ? (
        <GameSession key={`${game.lobbyId}-${game.seats.join("")}`} config={game} onLeave={() => setGame(null)} />
      ) : (
        <LobbyHub lobbies={lobbies} setLobbies={setLobbies} onPlay={setGame} />
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
