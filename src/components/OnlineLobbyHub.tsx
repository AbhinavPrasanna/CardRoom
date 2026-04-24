import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { SeatKind } from "../game/engine";
import { MAX_BUY_IN, MIN_BUY_IN } from "../game/types";
import { useCardRoomWs } from "../realtime/useCardRoomWs";
import type { ServerMessage, WireLobby } from "../realtime/wsMessages";
import { createDefaultLobby, type GameStartConfig, type TableLobby } from "./LobbyHub";

type Props = {
  wsUrl: string;
  onPlay: (config: GameStartConfig) => void;
};

function countOccupied(seats: SeatKind[]) {
  return seats.filter((s) => s !== "empty").length;
}

function countHumans(seats: SeatKind[]) {
  return seats.filter((s) => s === "human").length;
}

function countOpenSeats(seats: SeatKind[]) {
  return seats.filter((s) => s === "empty").length;
}

export function OnlineLobbyHub({ wsUrl, onPlay }: Props) {
  const [lobby, setLobby] = useState<TableLobby>(() => createDefaultLobby());
  const [playerName, setPlayerName] = useState(() => {
    try {
      return localStorage.getItem("card-room-player-name") || "Player";
    } catch {
      return "Player";
    }
  });
  const [joinCode, setJoinCode] = useState("");
  const [serverHint, setServerHint] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const fromServer = useRef(false);

  const { status, lastError, connect, disconnect, send, setOnMessage } = useCardRoomWs(wsUrl);

  useEffect(() => {
    if (status !== "open") setSyncEnabled(false);
  }, [status]);

  useEffect(() => {
    const handler = (msg: ServerMessage) => {
      if (msg.type === "error") {
        setServerHint(msg.message);
        return;
      }
      if (msg.type === "lobbyCreated" || msg.type === "lobbyState") {
        fromServer.current = true;
        setServerHint(null);
        setSyncEnabled(true);
        setLobby(msg.lobby as TableLobby);
        return;
      }
      if (msg.type === "presence") {
        setServerHint(msg.joined ? "Someone joined." : msg.left ? "Someone left." : "Presence update.");
        return;
      }
      if (msg.type === "leftLobby") {
        setServerHint("You left the lobby (still connected).");
      }
    };
    setOnMessage(handler);
  }, [setOnMessage]);

  useEffect(() => {
    try {
      localStorage.setItem("card-room-player-name", playerName.slice(0, 40));
    } catch {
      /* ignore */
    }
  }, [playerName]);

  useEffect(() => {
    if (!syncEnabled || status !== "open") return;
    if (fromServer.current) {
      fromServer.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      send({ action: "syncLobby", lobby: lobby as WireLobby });
    }, 450);
    return () => window.clearTimeout(t);
  }, [lobby, status, send, syncEnabled]);

  const patchLobby = useCallback((fn: (l: TableLobby) => TableLobby) => {
    setLobby((prev) => fn(prev));
  }, []);

  const setSeat = (seat: number, kind: SeatKind) => {
    patchLobby((prev) => {
      const seats = [...prev.seats] as SeatKind[];
      if (kind === "human") {
        for (let i = 0; i < seats.length; i++) {
          if (i !== seat && seats[i] === "human") seats[i] = "empty";
        }
      }
      seats[seat] = kind;
      return { ...prev, seats };
    });
  };

  /** One human, every other seat empty — largest number of “open” seats for friends to fill. */
  const applyMaxOpenSeats = () => {
    patchLobby((prev) => {
      const seats = [...prev.seats] as SeatKind[];
      let humanIdx = seats.indexOf("human");
      if (humanIdx < 0) humanIdx = 0;
      const next = seats.map((_, i) => (i === humanIdx ? "human" : "empty")) as SeatKind[];
      return { ...prev, seats: next };
    });
  };

  /** Full six-max ring: you + five bots (good for a quick full table). */
  const applyFullRingBots = () => {
    patchLobby((prev) => {
      const n = prev.seats.length;
      const next = Array.from({ length: n }, (_, i) => (i === 0 ? "human" : "bot")) as SeatKind[];
      return { ...prev, seats: next };
    });
  };

  /** Two seats filled: you vs one bot; rest empty. */
  const applyHeadsUpVsBot = () => {
    patchLobby((prev) => {
      const n = prev.seats.length;
      const next = Array.from({ length: n }, () => "empty" as SeatKind);
      next[0] = "human";
      if (n > 1) next[1] = "bot";
      return { ...prev, seats: next };
    });
  };

  const occ = countOccupied(lobby.seats);
  const humans = countHumans(lobby.seats);
  const openSeats = countOpenSeats(lobby.seats);
  const bots = lobby.seats.filter((s) => s === "bot").length;
  const canStart = useMemo(() => occ >= 2 && humans >= 1, [occ, humans]);

  const handleCreate = () => {
    if (status !== "open") return;
    send({
      action: "createLobby",
      name: lobby.name,
      seats: [...lobby.seats],
      humanBuyIn: lobby.humanBuyIn,
      botBuyIn: lobby.botBuyIn,
      playerName: playerName.trim() || "Host",
    });
  };

  const handleJoin = () => {
    if (status !== "open") return;
    const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!code) {
      setServerHint("Enter a lobby code.");
      return;
    }
    send({ action: "joinLobby", lobbyId: code, playerName: playerName.trim() || "Player" });
  };

  const copyLobbyCode = async () => {
    if (!lobby.id) return;
    try {
      await navigator.clipboard.writeText(lobby.id);
      setServerHint("Lobby code copied — send it to your friend.");
    } catch {
      setServerHint(`Share this code manually: ${lobby.id}`);
    }
  };

  const inputStyle = {
    width: "100%" as const,
    maxWidth: 360,
    padding: "0.45rem 0.6rem",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "var(--text)",
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <h1>Abhinav&apos;s Card Room</h1>
          <p className="online-lobby-lead">
            The <strong>lobby</strong> (code + seat map + buy-ins) syncs over AWS for everyone in the same code. After
            you click play, the table can also sync live if the gameplay WebSocket endpoint is configured.
          </p>
        </div>
      </header>

      <section className="lobby lobby-wide lobby-online">
        <div className="online-lobby-friend-box">
          <h3>Play with someone on Amplify (or any link)</h3>
          <p style={{ margin: "0 0 0.5rem", color: "var(--muted)", fontSize: "0.84rem" }}>
            At the top of the app, <strong>both</strong> people must choose <strong>Online lobby (AWS)</strong> — not
            &quot;Local only&quot;. Same Amplify URL is fine; you are still two separate browsers.
          </p>
          <ol>
            <li>
              <strong>Host:</strong> Connect → <strong>Create new lobby</strong> → copy or read the{" "}
              <strong>Active lobby</strong> code below.
            </li>
            <li>
              <strong>Friend:</strong> Connect → type that code in <strong>CODE TO JOIN</strong> →{" "}
              <strong>Join lobby</strong>. They should then see the <strong>same</strong> active code and seats as you.
            </li>
          </ol>
          <p className="online-lobby-limitation">
            If your friend never clicked <strong>Join lobby</strong> with your code, they are not in your room — Amplify
            does not auto-match players. If both of you open the same lobby table, one player controls actions at a
            time and everyone else sees the same live state.
          </p>
        </div>

        <ul className="online-lobby-features">
          <li>
            <strong>Connect</strong> once with your display name, then <strong>create</strong> a code or{" "}
            <strong>join</strong> with a friend&apos;s code.
          </li>
          <li>
            <strong>Seat presets</strong> set the whole table in one click; you can still tweak individual seats below.
          </li>
          <li>
            <strong>Max open seats</strong> keeps one &quot;You&quot; seat and clears the rest so up to five friends
            (or bots you add later) can fill the ring.
          </li>
          <li>
            When ready, <strong>Open table &amp; play</strong> starts table play from this layout (shared when gameplay
            sync is connected).
          </li>
        </ul>

        <div className="online-lobby-card">
          <h2>1 · Connect</h2>
          <p className="online-lobby-card-desc">
            You must be connected before creating or joining a lobby. The card room server is configured in the app
            build (not shown here).
          </p>
          <div className="lobby-row" style={{ marginTop: "0.5rem" }}>
            <label htmlFor="playerName">Display name</label>
            <input
              id="playerName"
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div className="lobby-actions" style={{ marginTop: "0.85rem" }}>
            {status !== "open" ? (
              <button type="button" className="btn btn-primary" onClick={() => connect(playerName.trim() || "Player")}>
                Connect to card room
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-secondary" onClick={disconnect}>
                  Disconnect
                </button>
                {syncEnabled ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      send({ action: "leaveLobby" });
                      setSyncEnabled(false);
                      setLobby(createDefaultLobby());
                    }}
                  >
                    Leave lobby (stay connected)
                  </button>
                ) : null}
              </>
            )}
          </div>
          <div className="online-lobby-status-row">
            <span className="badge">WebSocket: {status}</span>
            {syncEnabled ? <span className="badge">Lobby sync on</span> : <span className="badge">Lobby sync off</span>}
            {lastError ? <span style={{ color: "var(--danger)", fontSize: "0.88rem" }}>{lastError}</span> : null}
          </div>
        </div>

        <div className="online-lobby-card">
          <h2>2 · Lobby code</h2>
          <p className="online-lobby-card-desc">
            Host creates a new code; guests paste the same code to join. Everyone in that code sees the same seat map.
          </p>
          <div className="lobby-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-primary" disabled={status !== "open"} onClick={handleCreate}>
              Create new lobby
            </button>
          </div>
          <div className="online-lobby-join-row">
            <input
              type="text"
              placeholder="CODE TO JOIN"
              value={joinCode}
              aria-label="Lobby code to join"
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              style={{
                ...inputStyle,
                minWidth: 160,
                maxWidth: 220,
                fontFamily: "JetBrains Mono, ui-monospace, monospace",
              }}
            />
            <button type="button" className="btn btn-secondary" disabled={status !== "open"} onClick={handleJoin}>
              Join lobby
            </button>
          </div>
          {syncEnabled && lobby.id ? (
            <div className="online-lobby-code-box">
              <div className="online-lobby-code-box-label">Active lobby — send this to your friend</div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.65rem" }}>
                <code>{lobby.id}</code>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyLobbyCode()}>
                  Copy code
                </button>
              </div>
            </div>
          ) : (
            <p className="online-lobby-card-desc" style={{ marginTop: "0.65rem", marginBottom: 0 }}>
              {status !== "open"
                ? "Connect first, then the host creates a lobby or you join with a code."
                : "No shared lobby on the server yet — host taps Create, or paste a code and Join."}
            </p>
          )}
          {serverHint ? <div className="online-lobby-hint-banner online-lobby-hint-banner--muted">{serverHint}</div> : null}
        </div>

        <div className="online-lobby-card">
          <h2>3 · Table name &amp; buy-ins</h2>
          <p className="online-lobby-card-desc">Table name is included when you create the lobby; buy-ins apply when you start play.</p>
          <div className="lobby-row">
            <label htmlFor="onlineTableName">Table name</label>
            <input
              id="onlineTableName"
              type="text"
              value={lobby.name}
              onChange={(e) => patchLobby((l) => ({ ...l, name: e.target.value.slice(0, 48) }))}
              style={inputStyle}
            />
          </div>
          <div className="online-lobby-quick-row">
            <span className="online-lobby-quick-label">Seat presets</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={applyMaxOpenSeats}>
              Max open seats (1 you + 5 empty)
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={applyFullRingBots}>
              Full ring (you + 5 bots)
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={applyHeadsUpVsBot}>
              Heads-up (you + 1 bot)
            </button>
          </div>
          <div className="lobby-row">
            <label htmlFor="onHumanBuy">Your buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
            <input
              id="onHumanBuy"
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
            <label htmlFor="onBotBuy">Bot buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
            <input
              id="onBotBuy"
              type="range"
              min={MIN_BUY_IN}
              max={MAX_BUY_IN}
              step={50}
              value={lobby.botBuyIn}
              onChange={(e) => patchLobby((l) => ({ ...l, botBuyIn: Number(e.target.value) }))}
            />
            <div className="lobby-value">{lobby.botBuyIn} chips each</div>
          </div>
        </div>

        <div className="online-lobby-card">
          <h2>4 · Seat map (six-max)</h2>
          <p className="online-lobby-card-desc">
            Only one seat can be <strong>You</strong>. Edits debounce and sync to other players in the same lobby.
          </p>
          <div className="online-lobby-stats">
            <span className="online-lobby-stat">
              Occupied: <strong>{occ}</strong> / {lobby.seats.length}
            </span>
            <span className="online-lobby-stat">
              Open seats: <strong>{openSeats}</strong>
            </span>
            <span className="online-lobby-stat">
              Bots: <strong>{bots}</strong>
            </span>
            <span className="online-lobby-stat">
              You: <strong>{humans >= 1 ? "seated" : "not seated"}</strong>
            </span>
          </div>
          <div className="seat-grid">
            {lobby.seats.map((kind, seat) => (
              <div key={seat} className={`seat-tile seat-tile--${kind}`}>
                <div className="seat-tile-label">Seat {seat}</div>
                <div className="seat-tile-status">
                  {kind === "empty" ? "Open" : kind === "human" ? "You (player)" : "Bot"}
                </div>
                <div className="seat-tile-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeat(seat, "human")}>
                    Sit here as you
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeat(seat, "bot")}>
                    Add bot
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSeat(seat, "empty")}>
                    Clear seat
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="online-lobby-card" style={{ borderTop: "1px solid rgba(212, 168, 83, 0.2)", paddingTop: "1.25rem" }}>
          <h2>5 · Start play</h2>
          <p className="online-lobby-card-desc">Needs at least two occupied seats and one human (you).</p>
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
              <span className="lobby-hint">Add another player or bot, and sit one seat as you.</span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
