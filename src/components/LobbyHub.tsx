import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import type { SeatKind } from "../game/engine";
import { MAX_BUY_IN, MIN_BUY_IN } from "../game/types";

export type TableLobby = {
  id: string;
  name: string;
  seats: SeatKind[];
  /** Legacy fields kept for server wire compatibility. */
  humanBuyIn?: number;
  botBuyIn?: number;
  minBuyIn: number;
  maxBuyIn: number;
  smallBlind: number;
  bigBlind: number;
  seatBuyIns: number[];
};

export type GameStartConfig = {
  lobbyId: string;
  lobbyName: string;
  seats: SeatKind[];
  minBuyIn: number;
  maxBuyIn: number;
  smallBlind: number;
  bigBlind: number;
  seatBuyIns: number[];
};

export function createDefaultLobby(): TableLobby {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lobby-${Date.now()}`,
    name: "Your table",
    seats: ["human", "empty", "empty", "empty", "empty", "empty"],
    minBuyIn: 500,
    maxBuyIn: 2000,
    smallBlind: 1,
    bigBlind: 2,
    seatBuyIns: [1000, 1000, 1000, 1000, 1000, 1000],
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
      seats[seat] = kind;
      return { ...prev, seats };
    });
  };

  const occ = countOccupied(lobby.seats);
  const humans = countHumans(lobby.seats);
  const canStart = useMemo(() => occ >= 2 && humans >= 2, [occ, humans]);

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
          <label htmlFor="hubHumanBuy">Table min buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
          <input
            id="hubHumanBuy"
            type="range"
            min={MIN_BUY_IN}
            max={MAX_BUY_IN}
            step={50}
            value={lobby.minBuyIn}
            onChange={(e) =>
              patchLobby((l) => ({
                ...l,
                minBuyIn: Number(e.target.value),
                maxBuyIn: Math.max(Number(e.target.value), l.maxBuyIn),
              }))
            }
          />
          <div className="lobby-value">{lobby.minBuyIn} chips</div>
        </div>
        <div className="lobby-row">
          <label htmlFor="hubBotBuy">Table max buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
          <input
            id="hubBotBuy"
            type="range"
            min={MIN_BUY_IN}
            max={MAX_BUY_IN}
            step={50}
            value={lobby.maxBuyIn}
            onChange={(e) =>
              patchLobby((l) => ({
                ...l,
                maxBuyIn: Number(e.target.value),
                minBuyIn: Math.min(l.minBuyIn, Number(e.target.value)),
              }))
            }
          />
          <div className="lobby-value">{lobby.maxBuyIn} chips</div>
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
                minBuyIn: lobby.minBuyIn,
                maxBuyIn: lobby.maxBuyIn,
                smallBlind: lobby.smallBlind,
                bigBlind: lobby.bigBlind,
                seatBuyIns: [...lobby.seatBuyIns],
              })
            }
          >
            Open table &amp; play
          </button>
          {!canStart ? (
            <span className="lobby-hint">Need at least two seated human players.</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
