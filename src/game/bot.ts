import type { Card, GameAction, GameState } from "./types";
import { BIG_BLIND } from "./types";
import { bestHandScore } from "./handEvaluator";

function powerPreflop(hole: Card[]): number {
  const [a, b] = [...hole].sort((x, y) => y.rank - x.rank);
  const suited = a.suit === b.suit;
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  let score = hi * 3 + lo * 0.4;
  if (a.rank === b.rank) score += 18;
  if (suited) score += 4;
  if (a.rank >= 12 && b.rank >= 12) score += 6;
  return score;
}

function powerPostflop(hole: Card[], board: Card[]): number {
  const { score } = bestHandScore([...hole, ...board]);
  return score[0] * 20 + (score[1] ?? 0) * 0.3;
}

function tryRaise(state: GameState, seat: number, desiredTotal: number): GameAction | null {
  const p = state.players.find((x) => x.seat === seat)!;
  const maxTotal = p.betStreet + p.stack;
  const minOpen =
    state.currentBet === 0
      ? Math.min(BIG_BLIND, maxTotal)
      : Math.min(state.currentBet + state.minRaiseIncrement, maxTotal);
  const target = Math.min(Math.max(desiredTotal, p.betStreet), maxTotal);
  const allIn = target === maxTotal;
  if (target < minOpen && !allIn) return null;
  return { type: "RAISE", totalBet: target };
}

export function chooseBotAction(state: GameState, seat: number): GameAction {
  const p = state.players.find((x) => x.seat === seat);
  if (!p || !p.hole || p.hole.length !== 2) return { type: "FOLD" };
  const toCall = Math.max(0, state.currentBet - p.betStreet);
  const potOdds = state.pot / (toCall + 0.01);
  const streetPow =
    state.street === "preflop"
      ? powerPreflop(p.hole)
      : powerPostflop(p.hole, state.board);
  const rnd = Math.random();
  const fear = Math.min(0.45, toCall / (p.stack + toCall + 1));

  if (toCall === 0) {
    const open = BIG_BLIND * 2 + Math.floor(Math.random() * 3) * BIG_BLIND;
    const want = p.betStreet + Math.min(open, p.stack);
    if (streetPow > 32 + rnd * 10 && p.stack > 0) {
      const r = tryRaise(state, seat, want);
      if (r) return r;
    }
    return { type: "CHECK" };
  }

  if (streetPow < 22 && toCall >= BIG_BLIND * 2 && rnd < 0.55 + fear) {
    return { type: "FOLD" };
  }
  if (streetPow < 28 && potOdds < 1.2 && rnd < 0.35) {
    return { type: "FOLD" };
  }
  if (streetPow > 40 && rnd > 0.35 && p.stack > toCall) {
    const bump = state.minRaiseIncrement + Math.floor(rnd * 2) * BIG_BLIND;
    const want = p.betStreet + toCall + bump;
    const r = tryRaise(state, seat, want);
    if (r) return r;
  }
  return { type: "CALL" };
}
