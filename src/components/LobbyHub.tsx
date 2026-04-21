import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import type { SeatKind } from "../game/engine";
import { MAX_BUY_IN, MIN_BUY_IN } from "../game/types";

export type TableLobby = {
  id: string;
  name: string;
  seats: SeatKind[];
  humanBuyIn: number;
  botBuyIn: number;
};

export type GameStartConfig = {
  lobbyId: string;
  lobbyName: string;
  seats: SeatKind[];
  humanBuyIn: number;
  botBuyIn: number;
};

export function createDefaultLobby(): TableLobby {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lobby-${Date.now()}`,
    name: "Your table",
    seats: ["human", "bot", "bot", "bot", "bot", "bot"],
    humanBuyIn: 1000,
    botBuyIn: 1000,
  };
}

function countOccupied(seats: SeatKind[]) {
  return seats.filter((s) => s !== "empty").length;
}

function countHumans(seats: SeatKind[]) {
  return seats.filter((s) => s === "human").length;
}

type Props = {
  lobby: TableLobby;
  setLobby: Dispatch<SetStateAction<TableLobby>>;
  onPlay: (config: GameStartConfig) => void;
};

export function LobbyHub({ lobby, setLobby, onPlay }: Props) {
  const patchLobby = useCallback(
    (fn: (l: TableLobby) => TableLobby) => {
      setLobby((prev) => fn(prev));
    },
    [setLobby],
  );

  const setSeat = (seat: number, kind: SeatKind) => {
    patchLobby((prev) => {
      const seats = [...prev.seats] as SeatKind[];
      if (kind === "human") {
        for (let i = 0; i < 6; i++) {
          if (i !== seat && seats[i] === "human") seats[i] = "empty";
        }
      }
      seats[seat] = kind;
      return { ...prev, seats };
    });
  };

  const occ = countOccupied(lobby.seats);
  const humans = countHumans(lobby.seats);
  const canStart = useMemo(() => occ >= 2 && humans >= 1, [occ, humans]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <h1>Abhinav&apos;s Card Room</h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>
            One table this session — configure seats, then play. NL Hold&apos;em · {MIN_BUY_IN}–{MAX_BUY_IN} chips · 1 /
            2
          </p>
        </div>
      </header>

      <section className="lobby lobby-wide">
        <h2 style={{ margin: "0 0 0.5rem" }}>Seat map (six-max)</h2>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          One seat can be <strong>you</strong> (player). Other seats can be <strong>bots</strong> or empty. Only one
          &quot;You&quot; per table.
        </p>

        <div className="lobby-row">
          <label htmlFor="hubHumanBuy">Your buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
          <input
            id="hubHumanBuy"
            type="range"
            min={MIN_BUY_IN}
            max={MAX_BUY_IN}
            step={50}
            value={lobby.humanBuyIn}
            onChange={(e) => patchLobby((l) => ({ ...l, humanBuyIn: Number(e.target.value) }))}
          />
          <div className="lobby-value">{lobby.humanBuyIn} chips</div>
        </div>
        <div className="lobby-row">
          <label htmlFor="hubBotBuy">Bot buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
          <input
            id="hubBotBuy"
            type="range"
            min={MIN_BUY_IN}
            max={MAX_BUY_IN}
            step={50}
            value={lobby.botBuyIn}
            onChange={(e) => patchLobby((l) => ({ ...l, botBuyIn: Number(e.target.value) }))}
          />
          <div className="lobby-value">{lobby.botBuyIn} chips each</div>
        </div>

        <div className="seat-grid">
          {lobby.seats.map((kind, seat) => (
            <div key={seat} className={`seat-tile seat-tile--${kind}`}>
              <div className="seat-tile-label">Seat {seat}</div>
              <div className="seat-tile-status">
                {kind === "empty" ? "Empty" : kind === "human" ? "You (player)" : "Bot"}
              </div>
              <div className="seat-tile-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeat(seat, "human")}>
                  Sit as player
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeat(seat, "bot")}>
                  Add bot
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSeat(seat, "empty")}>
                  Clear
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="lobby-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canStart}
            onClick={() =>
              onPlay({
                lobbyId: lobby.id,
                lobbyName: lobby.name,
                seats: [...lobby.seats],
                humanBuyIn: lobby.humanBuyIn,
                botBuyIn: lobby.botBuyIn,
              })
            }
          >
            Open table &amp; play
          </button>
          {!canStart ? (
            <span className="lobby-hint">Need at least two seated players and one human (you).</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
