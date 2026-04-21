import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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

function newLobbyName(index: number) {
  return `Table ${index}`;
}

function makeLobby(index: number): TableLobby {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lobby-${Date.now()}-${index}`,
    name: newLobbyName(index),
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
  lobbies: TableLobby[];
  setLobbies: Dispatch<SetStateAction<TableLobby[]>>;
  onPlay: (config: GameStartConfig) => void;
};

export function LobbyHub({ lobbies, setLobbies, onPlay }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = useMemo(
    () => (editingId ? lobbies.find((l) => l.id === editingId) ?? null : null),
    [lobbies, editingId],
  );

  const patchLobby = useCallback((id: string, fn: (lobby: TableLobby) => TableLobby) => {
    setLobbies((prev) => prev.map((l) => (l.id === id ? fn(l) : l)));
  }, [setLobbies]);

  const openLobby = (id: string) => setEditingId(id);
  const closeEditor = () => setEditingId(null);

  const createLobby = () => {
    const n = lobbies.length + 1;
    const lobby = makeLobby(n);
    setLobbies((prev) => [...prev, lobby]);
    setEditingId(lobby.id);
  };

  const deleteLobby = (id: string) => {
    setLobbies((prev) => prev.filter((l) => l.id !== id));
    setEditingId((cur) => (cur === id ? null : cur));
  };

  const setSeat = (id: string, seat: number, kind: SeatKind) => {
    patchLobby(id, (lobby) => {
      const seats = [...lobby.seats] as SeatKind[];
      if (kind === "human") {
        for (let i = 0; i < 6; i++) {
          if (i !== seat && seats[i] === "human") seats[i] = "empty";
        }
      }
      seats[seat] = kind;
      return { ...lobby, seats };
    });
  };

  const renameLobby = (id: string, name: string) => {
    patchLobby(id, (l) => ({ ...l, name: name.trim() || l.name }));
  };

  if (editing) {
    const occ = countOccupied(editing.seats);
    const humans = countHumans(editing.seats);
    const canStart = occ >= 2 && humans >= 1;

    return (
      <div className="app-shell">
        <header className="site-header">
          <div>
            <h1>Abhinav&apos;s Card Room</h1>
            <p style={{ color: "var(--muted)", margin: 0 }}>
              Configure seats, then open the table. NL Hold&apos;em · {MIN_BUY_IN}–{MAX_BUY_IN} chips · 1 / 2
            </p>
          </div>
        </header>

        <section className="lobby lobby-wide">
          <div className="lobby-toolbar">
            <button type="button" className="btn btn-ghost" onClick={closeEditor}>
              ← All tables
            </button>
            <label className="lobby-rename">
              <span className="sr-only">Table name</span>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => renameLobby(editing.id, e.target.value)}
                aria-label="Table name"
              />
            </label>
          </div>

          <h2>Seat map (six-max)</h2>
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
              value={editing.humanBuyIn}
              onChange={(e) =>
                patchLobby(editing.id, (l) => ({ ...l, humanBuyIn: Number(e.target.value) }))
              }
            />
            <div className="lobby-value">{editing.humanBuyIn} chips</div>
          </div>
          <div className="lobby-row">
            <label htmlFor="hubBotBuy">Bot buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
            <input
              id="hubBotBuy"
              type="range"
              min={MIN_BUY_IN}
              max={MAX_BUY_IN}
              step={50}
              value={editing.botBuyIn}
              onChange={(e) => patchLobby(editing.id, (l) => ({ ...l, botBuyIn: Number(e.target.value) }))}
            />
            <div className="lobby-value">{editing.botBuyIn} chips each</div>
          </div>

          <div className="seat-grid">
            {editing.seats.map((kind, seat) => (
              <div key={seat} className={`seat-tile seat-tile--${kind}`}>
                <div className="seat-tile-label">Seat {seat}</div>
                <div className="seat-tile-status">
                  {kind === "empty" ? "Empty" : kind === "human" ? "You (player)" : "Bot"}
                </div>
                <div className="seat-tile-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeat(editing.id, seat, "human")}>
                    Sit as player
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeat(editing.id, seat, "bot")}>
                    Add bot
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSeat(editing.id, seat, "empty")}>
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
                  lobbyId: editing.id,
                  lobbyName: editing.name,
                  seats: [...editing.seats],
                  humanBuyIn: editing.humanBuyIn,
                  botBuyIn: editing.botBuyIn,
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

  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <h1>Abhinav&apos;s Card Room</h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Create multiple tables, pick who sits where, then play. Chips are for fun only.
          </p>
        </div>
      </header>

      <section className="lobby lobby-wide">
        <div className="lobby-toolbar">
          <h2 style={{ margin: 0 }}>Your tables</h2>
          <button type="button" className="btn btn-primary" onClick={createLobby}>
            New table
          </button>
        </div>

        {lobbies.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No tables yet — create one to get started.</p>
        ) : (
          <ul className="lobby-table-list">
            {lobbies.map((l) => (
              <li key={l.id} className="lobby-table-card">
                <div>
                  <strong>{l.name}</strong>
                  <div className="mono lobby-table-meta">
                    {countOccupied(l.seats)} seated · You {l.humanBuyIn} chips · Bots {l.botBuyIn} chips
                  </div>
                </div>
                <div className="lobby-table-card-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => openLobby(l.id)}>
                    Edit seats
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={countOccupied(l.seats) < 2 || countHumans(l.seats) < 1}
                    onClick={() =>
                      onPlay({
                        lobbyId: l.id,
                        lobbyName: l.name,
                        seats: [...l.seats],
                        humanBuyIn: l.humanBuyIn,
                        botBuyIn: l.botBuyIn,
                      })
                    }
                  >
                    Play
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => deleteLobby(l.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function initialLobbies(): TableLobby[] {
  return [makeLobby(1)];
}
