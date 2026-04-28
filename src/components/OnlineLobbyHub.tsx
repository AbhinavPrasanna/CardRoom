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

function normalizeLobbyFromServer(raw: TableLobby): TableLobby {
  const d = createDefaultLobby();
  const seatBuyIns = Array.from({ length: 6 }, (_, i) => {
    const v = raw.seatBuyIns?.[i];
    return typeof v === "number" && Number.isFinite(v) ? v : d.seatBuyIns[i];
  });
  return {
    ...d,
    ...raw,
    minBuyIn: raw.minBuyIn ?? raw.humanBuyIn ?? d.minBuyIn,
    maxBuyIn: raw.maxBuyIn ?? raw.botBuyIn ?? d.maxBuyIn,
    smallBlind: raw.smallBlind ?? d.smallBlind,
    bigBlind: raw.bigBlind ?? d.bigBlind,
    seatBuyIns,
  };
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
  /** After Create / Join, until the first lobby snapshot — avoids stale “no shared lobby” copy. */
  const [pendingLobbySync, setPendingLobbySync] = useState<"create" | "join" | null>(null);
  const pendingLobbySyncRef = useRef<"create" | "join" | null>(null);
  const [lobbyRole, setLobbyRole] = useState<"host" | "guest" | null>(null);
  const fromServer = useRef(false);
  /** After Join lobby, first server snapshot shows this hint (then cleared on later syncs). */
  const postJoinHintRef = useRef(false);

  const { status, lastError, connect, disconnect, send, setOnMessage } = useCardRoomWs(wsUrl);

  useEffect(() => {
    if (status !== "open") {
      setSyncEnabled(false);
      pendingLobbySyncRef.current = null;
      setPendingLobbySync(null);
      setLobbyRole(null);
    }
  }, [status]);

  const startFromLobby = useCallback(
    (liveLobby: TableLobby) => {
      onPlay({
        lobbyId: liveLobby.id,
        lobbyName: liveLobby.name,
        seats: [...liveLobby.seats],
        minBuyIn: liveLobby.minBuyIn,
        maxBuyIn: liveLobby.maxBuyIn,
        smallBlind: liveLobby.smallBlind,
        bigBlind: liveLobby.bigBlind,
        seatBuyIns: [...liveLobby.seatBuyIns],
      });
    },
    [onPlay],
  );

  useEffect(() => {
    const handler = (msg: ServerMessage) => {
      if (msg.type === "error") {
        postJoinHintRef.current = false;
        pendingLobbySyncRef.current = null;
        setPendingLobbySync(null);
        setServerHint(msg.message);
        return;
      }
      if (msg.type === "lobbyCreated" || msg.type === "lobbyState") {
        fromServer.current = true;
        setSyncEnabled(true);
        const pending = pendingLobbySyncRef.current;
        pendingLobbySyncRef.current = null;
        setPendingLobbySync(null);
        if (pending === "create") setLobbyRole("host");
        else if (pending === "join") setLobbyRole("guest");
        const liveLobby = normalizeLobbyFromServer(msg.lobby as TableLobby);
        setLobby(liveLobby);
        if (postJoinHintRef.current) {
          postJoinHintRef.current = false;
          setServerHint(
            "You're in this lobby. The host finishes the seat map (needs at least two player seats to open). Then everyone taps Open table & play — including you.",
          );
        } else {
          setServerHint(null);
        }
        return;
      }
      if (msg.type === "presence") {
        setServerHint(msg.joined ? "Someone joined." : msg.left ? "Someone left." : "Presence update.");
        // When someone joins, push latest lobby snapshot again to reduce stale-seat race windows.
        if (msg.joined && syncEnabled && status === "open") {
          send({ action: "syncLobby", lobby: lobby as WireLobby });
        }
        return;
      }
      if (msg.type === "leftLobby") {
        pendingLobbySyncRef.current = null;
        setPendingLobbySync(null);
        setLobbyRole(null);
        setSyncEnabled(false);
        setLobby(createDefaultLobby());
        setServerHint("You left the lobby (still connected).");
      }
    };
    setOnMessage(handler);
  }, [setOnMessage, lobby, send, status, syncEnabled]);

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

  /** Full six-max ring: six human seats to be claimed by players. */
  const applyFullRingPlayers = () => {
    patchLobby((prev) => {
      const n = prev.seats.length;
      const next = Array.from({ length: n }, () => "human" as SeatKind);
      return { ...prev, seats: next };
    });
  };

  /** Two-player lobby: two human seats, rest empty. */
  const applyHeadsUpPlayers = () => {
    patchLobby((prev) => {
      const n = prev.seats.length;
      const next = Array.from({ length: n }, () => "empty" as SeatKind);
      next[0] = "human";
      if (n > 1) next[1] = "human";
      return { ...prev, seats: next };
    });
  };

  const occ = countOccupied(lobby.seats);
  const humans = countHumans(lobby.seats);
  const openSeats = countOpenSeats(lobby.seats);
  const canStart = useMemo(() => occ >= 2 && humans >= 2, [occ, humans]);

  const handleCreate = () => {
    if (status !== "open") return;
    pendingLobbySyncRef.current = "create";
    setPendingLobbySync("create");
    send({
      action: "createLobby",
      name: lobby.name,
      seats: [...lobby.seats],
      humanBuyIn: lobby.minBuyIn,
      botBuyIn: lobby.maxBuyIn,
      smallBlind: lobby.smallBlind,
      bigBlind: lobby.bigBlind,
      minBuyIn: lobby.minBuyIn,
      maxBuyIn: lobby.maxBuyIn,
      seatBuyIns: [...lobby.seatBuyIns],
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
    postJoinHintRef.current = true;
    pendingLobbySyncRef.current = "join";
    setPendingLobbySync("join");
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
              <strong>Host:</strong> Tap <strong>Connect to card room</strong> (section 1) →{" "}
              <strong>Create new lobby</strong> (section 2). The lobby code appears as <strong>plain text</strong> in
              section 2 under &quot;Active lobby&quot; (and in the status line under section 1). Share it verbally or use{" "}
              <strong>Copy code</strong> if the clipboard works in your browser.
            </li>
            <li>
              <strong>Friend:</strong> Same site, <strong>Online lobby (AWS)</strong> →{" "}
              <strong>Connect to card room</strong> → enter the code in <strong>CODE TO JOIN</strong> →{" "}
              <strong>Join lobby</strong>. Both screens should list the <strong>same</strong> code and seat map.
            </li>
            <li>
              In section 4, set at least <strong>two player seats</strong>. Then <strong>each person</strong> taps{" "}
              <strong>Open table &amp; play</strong> in section 5. There is no auto-jump — both must click.
            </li>
          </ol>
          <p className="online-lobby-limitation">
            Amplify does not auto-match strangers. Your friend must use <strong>Join lobby</strong> with your exact code.
          </p>
          <p className="online-lobby-limitation" style={{ marginTop: "0.5rem" }}>
            The table opens only after the lobby has two or more player seats <strong>and</strong> each person has
            tapped <strong>Open table &amp; play</strong>. Otherwise one browser can reach the table while the other
            stays here.
          </p>
        </div>

        <ul className="online-lobby-features">
          <li>
            Tap <strong>Connect to card room</strong> once with your display name, then <strong>create</strong> a code
            or <strong>join</strong> with a friend&apos;s code.
          </li>
          <li>
            <strong>Seat presets</strong> set the whole table in one click; you can still tweak individual seats below.
          </li>
          <li>
            <strong>Max open seats</strong> keeps one &quot;You&quot; seat and clears the rest so up to five friends
            can fill the ring.
          </li>
          <li>
            When ready, <strong>Open table &amp; play</strong> starts the table from this layout. Live dealing on the
            table requires the separate gameplay WebSocket in the build — lobby connection alone is not full table
            sync.
          </li>
        </ul>

        <div className="online-lobby-card">
          <h2>1 · Connect</h2>
          <p className="online-lobby-card-desc">
            You must be connected before creating or joining a lobby. This deployment already points at a lobby server
            (no URL field here). If the status stays stuck on <strong>connecting</strong> or <strong>closed</strong>,
            check network, VPN, or that you are on the same site build as your friend.
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
                      pendingLobbySyncRef.current = null;
                      setPendingLobbySync(null);
                      setLobbyRole(null);
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
          {status === "open" ? (
            <div className="online-lobby-session-summary" role="status" aria-live="polite">
              <span className="online-lobby-session-summary-label">Session</span>
              <span>
                Connected as <strong>{(playerName.trim() || "Player").slice(0, 40)}</strong>
                {syncEnabled && lobby.id ? (
                  <>
                    {" "}
                    · Lobby <code className="online-lobby-session-code">{lobby.id}</code> ·{" "}
                    {lobbyRole === "host" ? (
                      <span>You are the host</span>
                    ) : lobbyRole === "guest" ? (
                      <span>You joined as guest</span>
                    ) : (
                      <span>Shared lobby active</span>
                    )}{" "}
                    · <span>{humans} player seats</span>
                  </>
                ) : pendingLobbySync === "create" ? (
                  <> · Waiting for server to confirm your new lobby…</>
                ) : pendingLobbySync === "join" ? (
                  <> · Waiting for server to confirm join…</>
                ) : (
                  <> · No lobby yet — use section 2 after you connect.</>
                )}
              </span>
            </div>
          ) : null}
        </div>

        <div className="online-lobby-card">
          <h2>2 · Lobby code</h2>
          <p className="online-lobby-card-desc">
            Host creates a new code; guests paste the same code to join. Everyone in that code sees the same seat map.
          </p>
          <div className="online-lobby-hint-banner online-lobby-hint-banner--muted" style={{ marginBottom: "0.7rem" }}>
            <strong>Same lobby check:</strong> After join/create, section 1 <strong>Session</strong> and the box below
            should show the <strong>same lobby id</strong> on both browsers. If only one side shows a code, that side is
            not in the other&apos;s room yet.
          </div>
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
            <div
              className="online-lobby-code-box"
              role="region"
              aria-labelledby="active-lobby-code-heading"
            >
              <div id="active-lobby-code-heading" className="online-lobby-code-box-label">
                Active lobby — code (readable on screen; copy is optional)
              </div>
              <div className="online-lobby-code-row" aria-live="polite" aria-atomic="true">
                <code className="online-lobby-code-plain" aria-label={`Lobby code: ${lobby.id}`}>
                  {lobby.id}
                </code>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-label={`Copy lobby code ${lobby.id} to clipboard`}
                  onClick={() => void copyLobbyCode()}
                >
                  Copy code
                </button>
              </div>
            </div>
          ) : (
            <p className="online-lobby-card-desc" style={{ marginTop: "0.65rem", marginBottom: 0 }}>
              {status !== "open"
                ? "Tap Connect to card room in section 1 first, then create a lobby or join with a code here."
                : pendingLobbySync === "create"
                  ? "Creating your lobby on the server… The code will appear here and in the Session line (section 1) as soon as the server responds."
                  : pendingLobbySync === "join"
                    ? "Joining that lobby… The shared code and seat map appear here when the server confirms you are in the room."
                    : "No shared lobby on the server yet — host taps Create new lobby, or paste a code and tap Join lobby."}
            </p>
          )}
          {serverHint ? <div className="online-lobby-hint-banner online-lobby-hint-banner--muted">{serverHint}</div> : null}
        </div>

        <div className="online-lobby-card">
          <h2>3 · Table rules &amp; buy-ins</h2>
          <p className="online-lobby-card-desc">Host sets blinds and buy-in limits before opening the table.</p>
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
            <button type="button" className="btn btn-secondary btn-sm" onClick={applyFullRingPlayers}>
              Full ring (6 player seats)
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={applyHeadsUpPlayers}>
              Heads-up (2 players)
            </button>
          </div>
          <div className="lobby-row">
            <label htmlFor="onHumanBuy">Minimum buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
            <input
              id="onHumanBuy"
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
            <label htmlFor="onBotBuy">Maximum buy-in ({MIN_BUY_IN}–{MAX_BUY_IN})</label>
            <input
              id="onBotBuy"
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
          <div className="lobby-row">
            <label htmlFor="onSmallBlind">Small blind</label>
            <input
              id="onSmallBlind"
              type="number"
              min={1}
              max={1000}
              value={lobby.smallBlind}
              onChange={(e) =>
                patchLobby((l) => {
                  const sb = Math.max(1, Number(e.target.value) || 1);
                  return { ...l, smallBlind: sb, bigBlind: Math.max(sb * 2, l.bigBlind) };
                })
              }
              style={inputStyle}
            />
          </div>
          <div className="lobby-row">
            <label htmlFor="onBigBlind">Big blind</label>
            <input
              id="onBigBlind"
              type="number"
              min={2}
              max={2000}
              value={lobby.bigBlind}
              onChange={(e) =>
                patchLobby((l) => {
                  const bb = Math.max(2, Number(e.target.value) || 2);
                  return { ...l, bigBlind: bb, smallBlind: Math.min(l.smallBlind, Math.max(1, Math.floor(bb / 2))) };
                })
              }
              style={inputStyle}
            />
          </div>
        </div>

        <div className="online-lobby-card">
          <h2>4 · Seat map (six-max)</h2>
          <p className="online-lobby-card-desc">
            Player seats are reserved in lobby before play. Each player should claim one seat and set their buy-in.
          </p>
          <div className="online-lobby-stats">
            <span className="online-lobby-stat">
              Occupied: <strong>{occ}</strong> / {lobby.seats.length}
            </span>
            <span className="online-lobby-stat">
              Open seats: <strong>{openSeats}</strong>
            </span>
            <span className="online-lobby-stat">
              Players seated: <strong>{humans}</strong>
            </span>
          </div>
          <div className="seat-grid">
            {lobby.seats.map((kind, seat) => (
              <div key={seat} className={`seat-tile seat-tile--${kind}`}>
                <div className="seat-tile-label">Seat {seat}</div>
                <div className="seat-tile-status">
                  {kind === "empty" ? "Open" : "Player seat"}
                </div>
                <div className="seat-tile-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeat(seat, "human")}>
                    Mark as player seat
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSeat(seat, "empty")}>
                    Clear seat
                  </button>
                  {kind === "human" ? (
                    <input
                      type="number"
                      min={lobby.minBuyIn}
                      max={lobby.maxBuyIn}
                      value={lobby.seatBuyIns[seat] ?? lobby.minBuyIn}
                      onChange={(e) =>
                        patchLobby((l) => {
                          const next = [...l.seatBuyIns];
                          const v = Number(e.target.value) || l.minBuyIn;
                          next[seat] = Math.min(l.maxBuyIn, Math.max(l.minBuyIn, v));
                          return { ...l, seatBuyIns: next };
                        })
                      }
                      style={{ ...inputStyle, maxWidth: 180 }}
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="online-lobby-card" style={{ borderTop: "1px solid rgba(212, 168, 83, 0.2)", paddingTop: "1.25rem" }}>
          <h2>5 · Start play</h2>
          <p className="online-lobby-card-desc">
            Needs at least two seats marked <strong>player seat</strong> in section 4. Host deals the first hand. Each
            person must tap this button on their own device — it does not open for the other player automatically.
          </p>
          <div className="lobby-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canStart}
              onClick={() =>
                startFromLobby(lobby)
              }
            >
            Open table &amp; play
            </button>
            {!canStart ? (
              <span className="lobby-hint">
                In section 4, use seat presets (e.g. Heads-up) or mark at least two seats as player seat. Currently{" "}
                {humans} player seat{humans === 1 ? "" : "s"}.
              </span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
