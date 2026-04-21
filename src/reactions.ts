export type ReactionId = "high_five" | "slap" | "scream" | "curse" | "thumbs_down";

export type ReactionDef = {
  id: ReactionId;
  /** Short label in toasts */
  label: string;
  /** Button / picker text */
  buttonLabel: string;
  emoji: string;
  /** Comic-style venting — no real slurs */
  toastLine?: string;
};

export const REACTIONS: ReactionDef[] = [
  { id: "high_five", label: "High five!", buttonLabel: "High five", emoji: "\u{1F64C}" },
  { id: "slap", label: "Slap!", buttonLabel: "Slap", emoji: "\u{1F44A}" },
  { id: "scream", label: "Scream!", buttonLabel: "Scream", emoji: "\u{1F631}" },
  {
    id: "curse",
    label: "Cursing",
    buttonLabel: "Cursing",
    emoji: "\u{1F92C}",
    toastLine: "@#$%&!!",
  },
  { id: "thumbs_down", label: "Thumbs down", buttonLabel: "Thumbs down", emoji: "\u{1F44E}" },
];

export function reactionById(id: ReactionId): ReactionDef | undefined {
  return REACTIONS.find((r) => r.id === id);
}
