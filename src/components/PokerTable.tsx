import { useEffect, useMemo, useRef, useState } from "react";
import type { GameAction, GameState } from "../game/types";
import { BIG_BLIND, SMALL_BLIND } from "../game/types";
import { sbBbSeats } from "../game/engine";
import { chooseBotAction } from "../game/bot";
import { CardView } from "./Card";
import { bestHandScore } from "../game/handEvaluator";
import { REACTIONS, type ReactionId, reactionById } from "../reactions";
import { TABLE_THEMES, TABLE_THEME_STORAGE_KEY } from "../tableThemes";

type ReactionToast = {
  id: string;
  targetSeat: number;
  reactionId: ReactionId;
  fromName: string;
};

const SEAT_POS: Record<number, { top: string; left: string }> = {
  0: { top: "88%", left: "50%" },
  1: { top: "78%", left: "85%" },
  2: { top: "42%", left: "94%" },
  3: { top: "12%", left: "50%" },
  4: { top: "42%", left: "6%" },
  5: { top: "78%", left: "15%" },
};

type Props = {
  state: GameState;
  dispatch: (a: GameAction) => void;
  onLeave: () => void;
};

export function PokerTable({ state, dispatch, onLeave }: Props) {
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (state.pendingRunOut) return;
    const seat = state.activeSeat;
    if (seat === null) return;
    const actor = state.players.find((p) => p.seat === seat);
    if (!actor || actor.isHuman) return;
    const delay = 450 + Math.random() * 650;
    const id = window.setTimeout(() => {
      const cur = stateRef.current;
      const s = cur.activeSeat;
      if (s === null) return;
      dispatch(chooseBotAction(cur, s));
    }, delay);
    return () => window.clearTimeout(id);
  }, [state.activeSeat, state.pendingRunOut, dispatch]);

  useEffect(() => {
    if (!state.pendingRunOut) return;
    const id = window.setTimeout(() => {
      dispatch({ type: "RUNOUT_STEP" });
    }, 780);
    return () => window.clearTimeout(id);
  }, [state.pendingRunOut, state.street, state.board.length, dispatch]);

  const human = state.players.find((p) => p.isHuman) ?? null;
  const isHumanTurn = human !== null && state.activeSeat === human.seat;
  const blinds = useMemo(() => sbBbSeats(state.players, state.buttonSeat), [state.players, state.buttonSeat]);
  const showBlinds = ["preflop", "flop", "turn", "river"].includes(state.street);

  const minRaiseTotal = useMemo(() => {
    if (!human) return 0;
    if (state.currentBet === 0) {
      return Math.min(BIG_BLIND, human.betStreet + human.stack);
    }
    return Math.min(state.currentBet + state.minRaiseIncrement, human.betStreet + human.stack);
  }, [human, state.currentBet, state.minRaiseIncrement]);

  const maxRaiseTotal = human ? human.betStreet + human.stack : 0;
  const [raiseTo, setRaiseTo] = useState(minRaiseTotal);

  useEffect(() => {
    setRaiseTo((v) => Math.min(Math.max(v, minRaiseTotal), maxRaiseTotal));
  }, [minRaiseTotal, maxRaiseTotal, isHumanTurn]);

  const canDeal =
    state.activeSeat === null &&
    (state.street === "hand_complete" || state.awaitingNextHand);

  const humanMadeHandName = useMemo(() => {
    if (!human || human.folded) return null;
    const hole = human.hole;
    if (!hole || hole.length !== 2) return null;
    if (state.board.length < 3) return null;
    return bestHandScore([...hole, ...state.board]).name;
  }, [human, state.board]);

  const [winnersAck, setWinnersAck] = useState(false);
  useEffect(() => {
    if (!state.winners?.length) setWinnersAck(false);
  }, [state.winners]);

  const [tableThemeId, setTableThemeId] = useState(() => {
    try {
      const saved = localStorage.getItem(TABLE_THEME_STORAGE_KEY);
      if (saved && TABLE_THEMES.some((t) => t.id === saved)) return saved;
    } catch {
      /* ignore */
    }
    return TABLE_THEMES[0].id;
  });
  useEffect(() => {
    try {
      localStorage.setItem(TABLE_THEME_STORAGE_KEY, tableThemeId);
    } catch {
      /* ignore */
    }
  }, [tableThemeId]);
  const tableTheme = TABLE_THEMES.find((t) => t.id === tableThemeId) ?? TABLE_THEMES[0];
  const tableThemeStyle = {
    "--felt-mid": tableTheme.feltMid,
    "--felt": tableTheme.felt,
    "--felt-edge": tableTheme.feltEdge,
    "--felt-rail": tableTheme.feltRail,
    "--card-back-from": tableTheme.cardBackFrom,
    "--card-back-to": tableTheme.cardBackTo,
    "--card-back-border": tableTheme.cardBackBorder,
  } as React.CSSProperties;

  const showWinnerDialog =
    Boolean(state.winners?.length) && state.awaitingNextHand && !winnersAck;

  useEffect(() => {
    if (!showWinnerDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWinnersAck(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showWinnerDialog]);

  const opponents = useMemo(() => state.players.filter((p) => !p.isHuman), [state.players]);
  const [reactionTargetSeat, setReactionTargetSeat] = useState<number | null>(null);
  const [reactionToasts, setReactionToasts] = useState<ReactionToast[]>([]);
  const [slapShakeSeat, setSlapShakeSeat] = useState<number | null>(null);
  const slapShakeTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (slapShakeTimerRef.current != null) window.clearTimeout(slapShakeTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (opponents.length === 0) {
      setReactionTargetSeat(null);
      return;
    }
    setReactionTargetSeat((cur) =>
      cur != null && opponents.some((o) => o.seat === cur) ? cur : opponents[0].seat,
    );
  }, [opponents]);

  const dismissToast = (toastId: string) => {
    setReactionToasts((prev) => prev.filter((t) => t.id !== toastId));
  };

  const sendReaction = (reactionId: ReactionId) => {
    if (!human || reactionTargetSeat == null) return;
    if (!reactionById(reactionId)) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `rx-${Date.now()}`;
    setReactionToasts((prev) => [
      ...prev,
      { id, targetSeat: reactionTargetSeat, reactionId, fromName: human.name },
    ]);
    if (reactionId === "slap") {
      if (slapShakeTimerRef.current != null) window.clearTimeout(slapShakeTimerRef.current);
      setSlapShakeSeat(reactionTargetSeat);
      slapShakeTimerRef.current = window.setTimeout(() => {
        setSlapShakeSeat(null);
        slapShakeTimerRef.current = null;
      }, 480);
    }
    window.setTimeout(() => dismissToast(id), 2800);
  };

  const toastsBySeat = useMemo(() => {
    const m = new Map<number, ReactionToast[]>();
    for (const t of reactionToasts) {
      const list = m.get(t.targetSeat) ?? [];
      list.push(t);
      m.set(t.targetSeat, list);
    }
    return m;
  }, [reactionToasts]);

  return (
    <>
    <div className="table-wrap" style={tableThemeStyle}>
      <div className="table-theme-bar">
        <label className="table-theme-label">
          Table look
          <select
            className="table-theme-select"
            value={tableThemeId}
            onChange={(e) => setTableThemeId(e.target.value)}
            aria-label="Table felt and card-back colors"
          >
            {TABLE_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="felt">
        <div className="seats">
          {state.players.map((p) => {
            const pos = SEAT_POS[p.seat] ?? SEAT_POS[0];
            const isDealer = p.seat === state.buttonSeat;
            const isSb = p.seat === blinds.sb;
            const isBb = p.seat === blinds.bb;
            const active = p.seat === state.activeSeat;
            const seatToasts = toastsBySeat.get(p.seat) ?? [];
            return (
              <div
                key={p.id}
                className={`seat${active ? " active" : ""}${isDealer ? " dealer" : ""}${
                  slapShakeSeat === p.seat ? " seat--slap-shake" : ""
                }`}
                style={{ top: pos.top, left: pos.left }}
              >
                {seatToasts.length ? (
                  <div className="reaction-toast-stack" aria-hidden>
                    {seatToasts.map((toast) => {
                      const d = reactionById(toast.reactionId);
                      if (!d) return null;
                      return (
                        <div key={toast.id} className="reaction-toast" role="status">
                          <span className="reaction-toast-emoji">{d.emoji}</span>
                          <span className="reaction-toast-text">
                            {d.toastLine ?? d.label}
                            <span className="reaction-toast-from"> · {toast.fromName}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="seat-inner">
                  <div className="seat-head">
                    <span className="seat-name">{p.name}</span>
                    <span className="dealer-btn" title="Button">
                      D
                    </span>
                  </div>
                  <div className="seat-meta mono">
                    {p.stack} chips
                    {showBlinds && isSb ? " · SB" : ""}
                    {showBlinds && isBb ? " · BB" : ""}
                  </div>
                  <div className="hole-cards">
                    {p.hole && p.hole.length === 2 ? (
                      <>
                        <CardView card={p.hole[0]} faceDown={!p.isHuman} />
                        <CardView card={p.hole[1]} faceDown={!p.isHuman} />
                      </>
                    ) : (
                      <>
                        <CardView card={null} faceDown />
                        <CardView card={null} faceDown />
                      </>
                    )}
                  </div>
                  {p.isHuman && humanMadeHandName ? (
                    <div className="seat-you-hand mono" title="Best five-card hand using your hole cards and the board">
                      {humanMadeHandName}
                    </div>
                  ) : null}
                  <div className="seat-badges">
                    {p.folded ? <span className="badge folded">Folded</span> : null}
                    {p.allIn ? <span className="badge allin">All-in</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="board-stack">
          <div className="board-meta-top">
            <div className="street-badge">{state.message}</div>
            <div className="pot-pill">Pot · {state.pot} chips</div>
          </div>
          <div className="board-cards">
            {state.board.map((c, i) => (
              <CardView key={i} card={c} />
            ))}
          </div>
          <div className="board-meta-bottom" />
        </div>
      </div>

      <div className="controls">
        <div className="controls-row" style={{ justifyContent: "space-between" }}>
          <div>
            <span className="badge">NL Hold&apos;em</span>{" "}
            <span className="badge">
              Blinds {SMALL_BLIND}/{BIG_BLIND}
            </span>{" "}
            <span className="badge">Hand #{state.handNumber}</span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>
            Leave table
          </button>
        </div>

        <div className="controls-row">
          {canDeal ? (
            <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: "NEW_HAND" })}>
              {state.handNumber === 0 ? "Deal first hand" : "Deal next hand"}
            </button>
          ) : null}
        </div>

        {human && opponents.length ? (
          <div className="reactions-panel">
            <div className="reactions-panel-head">
              <span className="reactions-panel-title">Reactions</span>
              <span className="reactions-panel-hint">For fun — local only, not sent online.</span>
            </div>
            <div className="reactions-panel-row">
              <label className="reactions-target-label">
                To
                <select
                  className="reactions-target-select"
                  value={reactionTargetSeat ?? opponents[0].seat}
                  onChange={(e) => setReactionTargetSeat(Number(e.target.value))}
                  aria-label="Player to react to"
                >
                  {opponents.map((o) => (
                    <option key={o.id} value={o.seat}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="reactions-buttons" role="group" aria-label="Send reaction">
              {REACTIONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="btn btn-secondary reaction-btn"
                  title={r.buttonLabel}
                  onClick={() => sendReaction(r.id)}
                >
                  <span className="reaction-btn-emoji" aria-hidden>
                    {r.emoji}
                  </span>
                  <span className="reaction-btn-label">{r.buttonLabel}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {human && isHumanTurn ? (
          <>
            <div className="controls-row">
              <button type="button" className="btn btn-danger" onClick={() => dispatch({ type: "FOLD" })}>
                Fold
              </button>
              {state.currentBet - human.betStreet === 0 ? (
                <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: "CHECK" })}>
                  Check
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: "CALL" })}>
                  Call {Math.min(state.currentBet - human.betStreet, human.stack)} chips
                </button>
              )}
              {minRaiseTotal <= maxRaiseTotal ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => dispatch({ type: "RAISE", totalBet: raiseTo })}
                >
                  Raise to {raiseTo}
                </button>
              ) : null}
            </div>
            {minRaiseTotal <= maxRaiseTotal ? (
              <div className="controls-row">
                <div className="raise-row">
                  <div className="raise-labels">
                    <span>Min {minRaiseTotal}</span>
                    <span>Max {maxRaiseTotal}</span>
                  </div>
                  <input
                    type="range"
                    min={minRaiseTotal}
                    max={maxRaiseTotal}
                    value={Math.min(Math.max(raiseTo, minRaiseTotal), maxRaiseTotal)}
                    onChange={(e) => setRaiseTo(Number(e.target.value))}
                  />
                </div>
              </div>
            ) : null}
          </>
        ) : state.pendingRunOut ? (
          <div className="msg-bar">Board running out…</div>
        ) : !human ? (
          <div className="msg-bar">No human seat — add yourself in the lobby to use controls.</div>
        ) : (
          <div className="msg-bar">{state.activeSeat === null ? "—" : "Opponents are thinking…"}</div>
        )}
      </div>
    </div>

    {showWinnerDialog && state.winners ? (
      <div
        className="hand-result-overlay"
        role="presentation"
        onClick={() => setWinnersAck(true)}
      >
        <div
          className="hand-result-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hand-result-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="hand-result-title" className="hand-result-title">
            {state.winners.length === 1 ? "Winner" : "Winners"}
          </h2>
          <ul className="hand-result-list">
            {state.winners.map((w) => {
              const name = state.players.find((p) => p.id === w.playerId)?.name ?? w.playerId;
              return (
                <li key={w.playerId} className="hand-result-row">
                  <span className="hand-result-name">{name}</span>
                  <span className="hand-result-amt mono">+{w.amount} chips</span>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-primary hand-result-btn" onClick={() => setWinnersAck(true)}>
            Continue
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}
