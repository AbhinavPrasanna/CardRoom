export const SMALL_BLIND = 1;
export const BIG_BLIND = 2;
export const MIN_BUY_IN = 500;
export const MAX_BUY_IN = 2000;

export type Suit = 0 | 1 | 2 | 3;

export interface Card {
  rank: number; // 2–14, Ace = 14
  suit: Suit;
}

export type Street =
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "hand_complete";

export interface Player {
  id: string;
  name: string;
  /** Human participant vs AI bot. */
  isHuman: boolean;
  /** True only for this browser's own seat, false for everyone else. */
  isLocal: boolean;
  seat: number;
  stack: number;
  hole: Card[] | null;
  folded: boolean;
  allIn: boolean;
  /** Chips committed this betting street */
  betStreet: number;
  /** Chips committed this entire hand (for side pots) */
  potCommit: number;
}

export interface SidePot {
  amount: number;
  eligibleIds: string[];
}

export interface GameState {
  players: Player[];
  board: Card[];
  street: Street;
  smallBlind: number;
  bigBlind: number;
  buttonSeat: number;
  activeSeat: number | null;
  deck: Card[];
  pot: number;
  /** Largest bet on this street */
  currentBet: number;
  /** Minimum total raise increment (NL rule) */
  minRaiseIncrement: number;
  /** Last full raise size on this street (for min-raise) */
  lastRaiseSize: number;
  /** Seats still to speak this betting round (first is to act) */
  bettingQueue: number[];
  message: string;
  handNumber: number;
  winners: { playerId: string; amount: number }[] | null;
  /** UI must confirm before next hand */
  awaitingNextHand: boolean;
  /** All-in / no further action: next board card(s) wait for RUNOUT_STEP (UI timer) */
  pendingRunOut: boolean;
}

export type GameAction =
  | { type: "NEW_HAND" }
  | { type: "FOLD" }
  | { type: "CHECK" }
  | { type: "CALL" }
  | { type: "RAISE"; totalBet: number }
  | { type: "RUNOUT_STEP" };
