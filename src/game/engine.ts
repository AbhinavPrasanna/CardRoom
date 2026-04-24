import { freshDeck, shuffle } from "./deck";
import { bestHandScore } from "./handEvaluator";
import type { Card, GameAction, GameState, Player, SidePot } from "./types";
import { BIG_BLIND, SMALL_BLIND } from "./types";

function bySeat(a: Player, b: Player): number {
  return a.seat - b.seat;
}

export function nextOccupiedSeat(players: Player[], fromSeat: number): number {
  const sorted = [...players].sort(bySeat);
  const seats = sorted.map((p) => p.seat);
  const idx = Math.max(0, seats.indexOf(fromSeat));
  for (let i = 1; i <= seats.length; i++) {
    const s = seats[(idx + i) % seats.length];
    if (s !== undefined) return s;
  }
  return fromSeat;
}

function getPlayer(state: GameState, seat: number): Player {
  const p = state.players.find((x) => x.seat === seat);
  if (!p) throw new Error("seat");
  return p;
}

function inHand(p: Player): boolean {
  return !p.folded;
}

function canVoluntaryAct(p: Player): boolean {
  return !p.folded && !p.allIn && p.stack > 0;
}

function buildSidePots(players: Player[]): SidePot[] {
  const rows = players
    .filter((p) => p.potCommit > 0)
    .map((p) => ({ id: p.id, c: p.potCommit, folded: p.folded }))
    .sort((a, b) => a.c - b.c);
  const pots: SidePot[] = [];
  let prev = 0;
  let pool = [...rows];
  while (pool.length) {
    const min = pool[0].c;
    const layer = min - prev;
    const amount = layer * pool.length;
    const eligibleIds = pool.filter((x) => !x.folded).map((x) => x.id);
    pots.push({ amount, eligibleIds: [...new Set(eligibleIds)] });
    prev = min;
    pool = pool.map((x) => ({ ...x, c: x.c - min })).filter((x) => x.c > 0);
  }
  return pots;
}

function resetStreetBets(players: Player[]): Player[] {
  return players.map((p) => ({ ...p, betStreet: 0 }));
}

function totalPotFromCommits(players: Player[]): number {
  return players.reduce((s, p) => s + p.potCommit, 0);
}

export function sbBbSeats(players: Player[], buttonSeat: number): { sb: number; bb: number } {
  const playing = players.filter((p) => p.stack + p.betStreet > 0 || inHand(p)).sort(bySeat);
  const aliveStacks = players.filter((p) => p.stack > 0).sort(bySeat);
  const basis = aliveStacks.length ? aliveStacks : playing;
  if (basis.length === 2) {
    const seats = basis.map((p) => p.seat);
    const idxBtn = seats.indexOf(buttonSeat);
    const other = seats[(idxBtn + 1) % 2];
    return { sb: buttonSeat, bb: other };
  }
  const sb = nextOccupiedSeat(basis, buttonSeat);
  const bb = nextOccupiedSeat(basis, sb);
  return { sb, bb };
}

function firstPreflopActor(players: Player[], buttonSeat: number): number {
  const { bb } = sbBbSeats(players, buttonSeat);
  const alive = players.filter((p) => p.stack + p.betStreet > 0 && !p.folded).sort(bySeat);
  return nextOccupiedSeat(alive, bb);
}

function firstPostflopActor(players: Player[], buttonSeat: number): number {
  const alive = players.filter((p) => !p.folded).sort(bySeat);
  return nextOccupiedSeat(alive, buttonSeat);
}

function orderedFrom(players: Player[], startSeat: number): number[] {
  const alive = players.filter((p) => !p.folded).sort(bySeat).map((p) => p.seat);
  if (!alive.length) return [];
  const idx = alive.indexOf(startSeat);
  if (idx < 0) return alive;
  return [...alive.slice(idx), ...alive.slice(0, idx)];
}

function initialBettingQueue(state: GameState): number[] {
  const start =
    state.street === "preflop"
      ? firstPreflopActor(state.players, state.buttonSeat)
      : firstPostflopActor(state.players, state.buttonSeat);
  return orderedFrom(state.players, start).filter((seat) => canVoluntaryAct(getPlayer(state, seat)));
}

function rebuildQueueAfterRaise(state: GameState, raiserSeat: number): number[] {
  const start = nextOccupiedSeat(state.players.filter((p) => !p.folded).sort(bySeat), raiserSeat);
  return orderedFrom(state.players, start).filter((seat) => {
    if (seat === raiserSeat) return false;
    return canVoluntaryAct(getPlayer(state, seat));
  });
}

function maxBet(state: GameState): number {
  return Math.max(0, ...state.players.filter(inHand).map((p) => p.betStreet));
}

function bettingSettled(state: GameState): boolean {
  const M = maxBet(state);
  for (const p of state.players) {
    if (!inHand(p)) continue;
    if (p.allIn) continue;
    if (p.betStreet !== M) return false;
  }
  return true;
}

function applyContribution(p: Player, add: number): Player {
  const pay = Math.min(add, p.stack);
  const stack = p.stack - pay;
  const betStreet = p.betStreet + pay;
  const potCommit = p.potCommit + pay;
  const allIn = stack === 0;
  return { ...p, stack, betStreet, potCommit, allIn };
}

function returnUncalledBet(state: GameState): GameState {
  const M = maxBet(state);
  const tops = state.players.filter((p) => inHand(p) && p.betStreet === M);
  if (tops.length !== 1) return state;
  const winner = tops[0];
  let extra = 0;
  for (const p of state.players) {
    if (!inHand(p)) continue;
    if (p.betStreet > M) extra += p.betStreet - M;
  }
  if (extra <= 0) return state;
  const players = state.players.map((p) =>
    p.id === winner.id
      ? {
          ...p,
          stack: p.stack + extra,
          betStreet: p.betStreet - extra,
          potCommit: p.potCommit - extra,
        }
      : p,
  );
  return { ...state, players, pot: totalPotFromCommits(players) };
}

function countInHand(players: Player[]): number {
  return players.filter(inHand).length;
}

/** One six-max seat: empty, local human, or bot. */
export type SeatKind = "empty" | "human" | "bot";

/** Build initial game state from exactly six seat slots (empty seats are omitted from play). */
export function createInitialStateFromSeats(
  seats: SeatKind[],
  humanBuyIn: number,
  botBuyIn: number,
): GameState {
  if (seats.length !== 6) throw new Error("Expected six seats");
  const players: Player[] = [];
  let botOrdinal = 0;
  let humanOrdinal = 0;
  let assignedLocal = false;
  for (let seat = 0; seat < 6; seat++) {
    const kind = seats[seat] ?? "empty";
    if (kind === "empty") continue;
    if (kind === "human") {
      humanOrdinal++;
      const isLocal = !assignedLocal;
      if (isLocal) assignedLocal = true;
      players.push({
        id: `human-${seat}`,
        name: isLocal ? "You" : `Player ${humanOrdinal}`,
        isHuman: true,
        isLocal,
        seat,
        stack: humanBuyIn,
        hole: null,
        folded: false,
        allIn: false,
        betStreet: 0,
        potCommit: 0,
      });
    } else {
      botOrdinal++;
      players.push({
        id: `bot-${seat}`,
        name: `Bot ${botOrdinal}`,
        isHuman: false,
        isLocal: false,
        seat,
        stack: botBuyIn,
        hole: null,
        folded: false,
        allIn: false,
        betStreet: 0,
        potCommit: 0,
      });
    }
  }
  return {
    players,
    board: [],
    street: "hand_complete",
    buttonSeat: 0,
    activeSeat: null,
    deck: [],
    pot: 0,
    currentBet: 0,
    minRaiseIncrement: BIG_BLIND,
    lastRaiseSize: BIG_BLIND,
    bettingQueue: [],
    message: "Set your buy-in, then deal a hand.",
    handNumber: 0,
    winners: null,
    awaitingNextHand: false,
    pendingRunOut: false,
  };
}

/** Classic layout: seat 0 human, next `numBots` seats bots, rest empty. */
export function createInitialState(humanBuyIn: number, botBuyIn: number, numBots: number): GameState {
  const seats: SeatKind[] = ["human"];
  for (let i = 0; i < numBots; i++) seats.push("bot");
  while (seats.length < 6) seats.push("empty");
  return createInitialStateFromSeats(seats, humanBuyIn, botBuyIn);
}

function maybeOneWinner(state: GameState): GameState | null {
  if (countInHand(state.players) !== 1) return null;
  const left = state.players.find((p) => inHand(p))!;
  const pot = totalPotFromCommits(state.players);
  const players = state.players.map((p) =>
    p.id === left.id
      ? {
          ...p,
          stack: p.stack + pot,
          betStreet: 0,
          potCommit: 0,
          folded: false,
          allIn: false,
        }
      : { ...p, betStreet: 0, potCommit: 0, folded: true, allIn: false },
  );
  return {
    ...state,
    players,
    street: "hand_complete",
    board: [],
    deck: [],
    pot: 0,
    currentBet: 0,
    winners: [{ playerId: left.id, amount: pot }],
    message: `${left.name} wins ${pot} chips.`,
    awaitingNextHand: true,
    activeSeat: null,
    bettingQueue: [],
    pendingRunOut: false,
  };
}

function resolveShowdown(state: GameState): GameState {
  const s0 = returnUncalledBet(state);
  const pots = buildSidePots(s0.players);
  const totals = new Map<string, number>();
  const board = s0.board;
  for (const pot of pots) {
    if (pot.amount <= 0) continue;
    const contenders = s0.players.filter((p) => pot.eligibleIds.includes(p.id) && inHand(p));
    if (contenders.length === 0) continue;
    if (contenders.length === 1) {
      totals.set(contenders[0].id, (totals.get(contenders[0].id) ?? 0) + pot.amount);
      continue;
    }
    let best = contenders[0];
    let bestScore = bestHandScore([...(best.hole ?? []), ...board]).score;
    const group = [best];
    for (let i = 1; i < contenders.length; i++) {
      const p = contenders[i];
      const sc = bestHandScore([...(p.hole ?? []), ...board]).score;
      const cmp = sc.map((v, j) => v - (bestScore[j] ?? 0)).find((d) => d !== 0) ?? 0;
      if (cmp > 0) {
        best = p;
        bestScore = sc;
        group.length = 0;
        group.push(p);
      } else if (cmp === 0) {
        group.push(p);
      }
    }
    const share = Math.floor(pot.amount / group.length);
    let rem = pot.amount - share * group.length;
    for (const p of group) {
      const extra = rem > 0 ? 1 : 0;
      if (rem > 0) rem--;
      totals.set(p.id, (totals.get(p.id) ?? 0) + share + extra);
    }
  }
  const players = s0.players.map((p) => {
    const stack = p.stack + (totals.get(p.id) ?? 0);
    return {
      ...p,
      stack,
      betStreet: 0,
      potCommit: 0,
      folded: stack <= 0,
      allIn: false,
      hole: p.hole,
    };
  });
  const msgParts = [...totals.entries()].map(([id, amt]) => {
    const name = players.find((x) => x.id === id)?.name ?? id;
    return `${name} +${amt}`;
  });
  return {
    ...s0,
    players,
    street: "hand_complete",
    board: [],
    deck: [],
    pot: 0,
    currentBet: 0,
    winners: [...totals.entries()].map(([playerId, amount]) => ({ playerId, amount })),
    message: msgParts.length ? msgParts.join(" · ") : "Hand complete.",
    awaitingNextHand: true,
    activeSeat: null,
    bettingQueue: [],
    pendingRunOut: false,
  };
}

/** Deal the next community card(s) for one street only (preflop→flop, flop→turn, turn→river). */
function dealNextCommunityStreet(state: GameState): GameState {
  const cleared = returnUncalledBet(state);
  let deck = [...cleared.deck];
  let board = [...cleared.board];
  const burn = () => {
    deck.shift();
  };
  const players = resetStreetBets(cleared.players);
  let street: GameState["street"] = cleared.street;
  if (cleared.street === "preflop") {
    burn();
    board.push(deck.shift()!, deck.shift()!, deck.shift()!);
    street = "flop";
  } else if (cleared.street === "flop") {
    burn();
    board.push(deck.shift()!);
    street = "turn";
  } else if (cleared.street === "turn") {
    burn();
    board.push(deck.shift()!);
    street = "river";
  } else {
    return cleared;
  }
  const pot = totalPotFromCommits(players);
  return {
    ...cleared,
    players,
    board,
    deck,
    street,
    pot,
    currentBet: 0,
    minRaiseIncrement: BIG_BLIND,
    lastRaiseSize: BIG_BLIND,
    activeSeat: null,
    bettingQueue: [],
    message: street.toUpperCase(),
    pendingRunOut: false,
  };
}

function runOutMessage(street: GameState["street"]): string {
  switch (street) {
    case "flop":
      return "Flop · board runs out";
    case "turn":
      return "Turn · board runs out";
    case "river":
      return "River · board runs out";
    default:
      return "Board runs out";
  }
}

/** After UI pause: deal next street or resolve if board is complete. */
function advanceRunOutOne(state: GameState): GameState {
  if (!state.pendingRunOut) return state;
  if (state.street === "river") {
    return { ...resolveShowdown(state), pendingRunOut: false };
  }
  const dealt = dealNextCommunityStreet(state);
  const q = initialBettingQueue(dealt);
  const withQueue: GameState = { ...dealt, bettingQueue: q, pendingRunOut: false };
  const m = maybeOneWinner(withQueue);
  if (m) return { ...m, pendingRunOut: false };
  if (q.length > 0) {
    return pickActor(withQueue);
  }
  if (withQueue.street === "river") {
    return {
      ...withQueue,
      activeSeat: null,
      bettingQueue: [],
      message: runOutMessage("river"),
      pendingRunOut: true,
    };
  }
  return {
    ...withQueue,
    activeSeat: null,
    bettingQueue: [],
    message: runOutMessage(withQueue.street),
    pendingRunOut: true,
  };
}

function startNewHand(state: GameState): GameState {
  const seated = state.players.filter((p) => p.stack > 0);
  if (seated.length < 2) {
    return { ...state, message: "Need at least two stacks to deal.", awaitingNextHand: false, pendingRunOut: false };
  }
  let buttonSeat = state.buttonSeat;
  if (!seated.some((p) => p.seat === buttonSeat)) {
    buttonSeat = seated.sort(bySeat)[0].seat;
  } else {
    buttonSeat = nextOccupiedSeat(seated, buttonSeat);
  }
  let deck = shuffle(freshDeck());
  const players0 = state.players.map((p) => ({
    ...p,
    hole: null,
    folded: p.stack <= 0,
    allIn: false,
    betStreet: 0,
    potCommit: 0,
  }));
  const dealt = players0.map((p) => {
    if (p.stack <= 0) return { ...p, hole: [] as Card[] };
    const c1 = deck.shift()!;
    const c2 = deck.shift()!;
    return { ...p, hole: [c1, c2] };
  });
  const { sb, bb } = sbBbSeats(dealt, buttonSeat);
  let players = [...dealt];
  const post = (seat: number, amt: number) => {
    const i = players.findIndex((p) => p.seat === seat);
    if (i < 0) return;
    const p = players[i];
    const pay = Math.min(amt, p.stack);
    players[i] = {
      ...p,
      stack: p.stack - pay,
      betStreet: p.betStreet + pay,
      potCommit: p.potCommit + pay,
      allIn: p.stack - pay === 0,
    };
  };
  post(sb, SMALL_BLIND);
  post(bb, BIG_BLIND);
  const currentBet = BIG_BLIND;
  const pot = totalPotFromCommits(players);
  const base: GameState = {
    ...state,
    players,
    board: [],
    street: "preflop",
    buttonSeat,
    deck,
    pot,
    currentBet,
    minRaiseIncrement: BIG_BLIND,
    lastRaiseSize: BIG_BLIND,
    winners: null,
    message: "Preflop",
    handNumber: state.handNumber + 1,
    awaitingNextHand: false,
    activeSeat: null,
    bettingQueue: [],
    pendingRunOut: false,
  };
  const withQueue: GameState = {
    ...base,
    bettingQueue: initialBettingQueue(base),
  };
  const m = maybeOneWinner(withQueue);
  if (m) return m;
  return pickActor(withQueue);
}

function pickActor(state: GameState): GameState {
  const m0 = maybeOneWinner(state);
  if (m0) return { ...m0, pendingRunOut: false };

  const queue = state.bettingQueue;

  if (queue.length > 0) {
    const [head, ...rest] = queue;
    const p = getPlayer(state, head);
    const toCall = state.currentBet - p.betStreet;
    if (!canVoluntaryAct(p)) {
      return pickActor({ ...state, bettingQueue: rest, pendingRunOut: false });
    }
    if (toCall > p.stack) {
      return { ...state, activeSeat: head, bettingQueue: [head, ...rest], message: `${p.name} to act`, pendingRunOut: false };
    }
    if (toCall === 0 && p.stack === 0) {
      return pickActor({ ...state, bettingQueue: rest, pendingRunOut: false });
    }
    return { ...state, activeSeat: head, bettingQueue: [head, ...rest], message: `${p.name} to act`, pendingRunOut: false };
  }

  if (!bettingSettled(state)) {
    return { ...state, activeSeat: null, message: "Waiting…", pendingRunOut: false };
  }

  if (state.street === "river") {
    return { ...resolveShowdown(state), pendingRunOut: false };
  }

  const dealt = dealNextCommunityStreet(state);
  const q = initialBettingQueue(dealt);
  const withQueue: GameState = { ...dealt, bettingQueue: q, pendingRunOut: false };
  const m1 = maybeOneWinner(withQueue);
  if (m1) return { ...m1, pendingRunOut: false };
  if (q.length > 0) {
    const head = q[0]!;
    const p = getPlayer(withQueue, head);
    return { ...withQueue, activeSeat: head, bettingQueue: q, message: `${p.name} to act`, pendingRunOut: false };
  }
  if (withQueue.street === "river") {
    return {
      ...withQueue,
      activeSeat: null,
      bettingQueue: [],
      message: runOutMessage("river"),
      pendingRunOut: true,
    };
  }
  return {
    ...withQueue,
    activeSeat: null,
    bettingQueue: [],
    message: runOutMessage(withQueue.street),
    pendingRunOut: true,
  };
}

function shiftQueue(state: GameState, actedSeat: number): GameState {
  const q = state.bettingQueue.filter((s) => s !== actedSeat);
  return { ...state, bettingQueue: q };
}

function handleFold(state: GameState): GameState {
  const seat = state.activeSeat;
  if (seat === null) return state;
  const players = state.players.map((p) => (p.seat === seat ? { ...p, folded: true } : p));
  let next: GameState = shiftQueue({ ...state, players, activeSeat: null }, seat);
  const m = maybeOneWinner(next);
  if (m) return m;
  return pickActor(next);
}

function handleCheck(state: GameState): GameState {
  const seat = state.activeSeat;
  if (seat === null) return state;
  const p = getPlayer(state, seat);
  if (state.currentBet - p.betStreet !== 0) return state;
  const next = shiftQueue({ ...state, activeSeat: null }, seat);
  return pickActor(next);
}

function handleCall(state: GameState): GameState {
  const seat = state.activeSeat;
  if (seat === null) return state;
  const p = getPlayer(state, seat);
  const toCall = state.currentBet - p.betStreet;
  if (toCall <= 0) {
    const next = shiftQueue({ ...state, activeSeat: null }, seat);
    return pickActor(next);
  }
  const players = state.players.map((x) => (x.seat === seat ? applyContribution(x, toCall) : x));
  const pot = totalPotFromCommits(players);
  let next: GameState = shiftQueue({ ...state, players, pot, activeSeat: null }, seat);
  const m = maybeOneWinner(next);
  if (m) return m;
  return pickActor(next);
}

function handleRaise(state: GameState, totalBet: number): GameState {
  const seat = state.activeSeat;
  if (seat === null) return state;
  const p = getPlayer(state, seat);
  const maxTotal = p.betStreet + p.stack;
  const target = Math.min(Math.max(totalBet, p.betStreet + 1), maxTotal);
  const minTotal = state.currentBet + state.minRaiseIncrement;
  const allInShove = target === maxTotal;
  if (target < minTotal && !allInShove) return state;
  const add = target - p.betStreet;
  if (add <= 0) return state;
  const players = state.players.map((x) => (x.seat === seat ? applyContribution(x, add) : x));
  const newBet = Math.max(state.currentBet, ...players.map((x) => x.betStreet));
  const raisedBy = newBet - state.currentBet;
  const lastRaiseSize = raisedBy >= state.minRaiseIncrement ? raisedBy : state.lastRaiseSize;
  const minRaiseIncrement = Math.max(BIG_BLIND, lastRaiseSize);
  const pot = totalPotFromCommits(players);
  const mid: GameState = {
    ...state,
    players,
    pot,
    currentBet: newBet,
    lastRaiseSize,
    minRaiseIncrement,
    activeSeat: null,
    bettingQueue: rebuildQueueAfterRaise(
      {
        ...state,
        players,
        pot,
        currentBet: newBet,
        lastRaiseSize,
        minRaiseIncrement,
        activeSeat: null,
        bettingQueue: [],
      },
      seat,
    ),
  };
  const m = maybeOneWinner(mid);
  if (m) return m;
  return pickActor(mid);
}

export function reduceGame(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "NEW_HAND":
      return startNewHand({ ...state, awaitingNextHand: false, pendingRunOut: false });
    case "RUNOUT_STEP":
      return advanceRunOutOne(state);
    case "FOLD":
      return handleFold(state);
    case "CHECK":
      return handleCheck(state);
    case "CALL":
      return handleCall(state);
    case "RAISE":
      return handleRaise(state, action.totalBet);
    default:
      return state;
  }
}
