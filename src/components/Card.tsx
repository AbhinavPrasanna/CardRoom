import type { Card as C } from "../game/types";
import { cardLabel } from "../game/deck";

const RED = new Set([1, 2]);

export function CardView({ card, faceDown }: { card: C | null; faceDown?: boolean }) {
  if (faceDown || !card) {
    return <div className="card back" aria-hidden />;
  }
  const label = cardLabel(card);
  const red = RED.has(card.suit) ? " red" : "";
  return (
    <div className={`card${red}`} title={label}>
      {label}
    </div>
  );
}
