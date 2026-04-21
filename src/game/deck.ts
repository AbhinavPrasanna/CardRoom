import type { Card, Suit } from "./types";

const SUITS: Suit[] = [0, 1, 2, 3];

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardLabel(c: Card): string {
  const r =
    c.rank === 14
      ? "A"
      : c.rank === 13
        ? "K"
        : c.rank === 12
          ? "Q"
          : c.rank === 11
            ? "J"
            : c.rank === 10
              ? "10"
              : String(c.rank);
  const s = ["♣", "♦", "♥", "♠"][c.suit];
  return `${r}${s}`;
}
