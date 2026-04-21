import type { Card } from "./types";

/** Lexicographic compare: positive if a > b */
function cmpScore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function combinations5<T>(items: T[]): T[][] {
  const res: T[][] = [];
  const n = items.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) res.push([items[a], items[b], items[c], items[d], items[e]]);
  return res;
}

/** Returns [category, tiebreakers...] higher wins. category 0–8 */
function scoreFive(cards: Card[]): number[] {
  const ranks = cards.map((c) => c.rank).sort((x, y) => y - x);
  const suits = cards.map((c) => c.suit);
  const flush = suits.every((s) => s === suits[0]);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const byCount = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const isStraightHigh = (sortedDesc: number[]): boolean => {
    if (sortedDesc.length < 5) return false;
    for (let i = 0; i < sortedDesc.length - 1; i++) {
      if (sortedDesc[i] - sortedDesc[i + 1] !== 1) return false;
    }
    return true;
  };

  const straightTop = (): number | null => {
    const s = [...new Set(ranks)].sort((x, y) => y - x);
    if (s.length < 5) return null;
    // wheel
    if (s.includes(14) && s.includes(5) && s.includes(4) && s.includes(3) && s.includes(2)) {
      return 5;
    }
    for (let i = 0; i <= s.length - 5; i++) {
      const slice = s.slice(i, i + 5);
      if (isStraightHigh(slice)) return slice[0];
    }
    return null;
  };

  const st = straightTop();
  if (flush && st !== null) {
    return [8, st];
  }
  if (byCount[0][1] === 4) {
    const quad = byCount[0][0];
    const kicker = byCount.find(([r]) => r !== quad)?.[0] ?? 0;
    return [7, quad, kicker];
  }
  if (byCount[0][1] === 3 && byCount[1]?.[1] === 2) {
    return [6, byCount[0][0], byCount[1][0]];
  }
  if (flush) {
    return [5, ...ranks];
  }
  if (st !== null) {
    return [4, st];
  }
  if (byCount[0][1] === 3) {
    const kickers = byCount.filter(([r]) => r !== byCount[0][0]).map(([r]) => r);
    return [3, byCount[0][0], ...kickers.slice(0, 2)];
  }
  if (byCount[0][1] === 2 && byCount[1]?.[1] === 2) {
    const hi = Math.max(byCount[0][0], byCount[1][0]);
    const lo = Math.min(byCount[0][0], byCount[1][0]);
    const kicker = byCount.find(([r]) => r !== hi && r !== lo)?.[0] ?? 0;
    return [2, hi, lo, kicker];
  }
  if (byCount[0][1] === 2) {
    const kickers = byCount.filter(([r]) => r !== byCount[0][0]).map(([r]) => r);
    return [1, byCount[0][0], ...kickers.slice(0, 3)];
  }
  return [0, ...ranks];
}

export function bestHandScore(cards7: Card[]): { score: number[]; name: string } {
  let best: number[] | null = null;
  for (const five of combinations5(cards7)) {
    const s = scoreFive(five);
    if (!best || cmpScore(s, best) > 0) best = s;
  }
  if (!best) return { score: [0], name: "—" };
  return { score: best, name: handNameFromScore(best) };
}

function handNameFromScore(s: number[]): string {
  const cat = s[0];
  const labels: Record<number, string> = {
    8: "Straight flush",
    7: "Four of a kind",
    6: "Full house",
    5: "Flush",
    4: "Straight",
    3: "Three of a kind",
    2: "Two pair",
    1: "Pair",
    0: "High card",
  };
  return labels[cat] ?? "High card";
}

export function compareBest(a7: Card[], b7: Card[]): number {
  const A = bestHandScore(a7).score;
  const B = bestHandScore(b7).score;
  return cmpScore(A, B);
}
