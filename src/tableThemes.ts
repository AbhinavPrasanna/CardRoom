export type TableTheme = {
  id: string;
  label: string;
  feltMid: string;
  felt: string;
  feltEdge: string;
  /** Thick outer ring around the felt */
  feltRail: string;
  cardBackFrom: string;
  cardBackTo: string;
  cardBackBorder: string;
};

/** Preset pairings: felt gradient + face-down card shell (gradient + border). */
export const TABLE_THEMES: TableTheme[] = [
  {
    id: "classic",
    label: "Classic green · Navy backs",
    feltMid: "#116b4f",
    felt: "#0d3b2c",
    feltEdge: "#06261c",
    feltRail: "#1a4d3a",
    cardBackFrom: "#1c2e8a",
    cardBackTo: "#0a174d",
    cardBackBorder: "rgba(255, 255, 255, 0.14)",
  },
  {
    id: "ocean",
    label: "Ocean teal · Deep sea backs",
    feltMid: "#0f6b6b",
    felt: "#084848",
    feltEdge: "#032828",
    feltRail: "#0a3034",
    cardBackFrom: "#064a52",
    cardBackTo: "#021a22",
    cardBackBorder: "rgba(120, 220, 230, 0.35)",
  },
  {
    id: "wine",
    label: "Wine room · Plum backs",
    feltMid: "#6b2d40",
    felt: "#3f1522",
    feltEdge: "#1a080e",
    feltRail: "#2a1018",
    cardBackFrom: "#4a1a3a",
    cardBackTo: "#1a0a14",
    cardBackBorder: "rgba(230, 190, 140, 0.28)",
  },
  {
    id: "midnight",
    label: "Midnight slate · Violet backs",
    feltMid: "#3d4a6e",
    felt: "#1e2438",
    feltEdge: "#0c0e16",
    feltRail: "#141820",
    cardBackFrom: "#3a2a5c",
    cardBackTo: "#120a24",
    cardBackBorder: "rgba(200, 190, 255, 0.22)",
  },
  {
    id: "desert",
    label: "Desert sand · Rust backs",
    feltMid: "#7a5c3a",
    felt: "#4a3520",
    feltEdge: "#1e140c",
    feltRail: "#2a2010",
    cardBackFrom: "#8b3a1a",
    cardBackTo: "#3a1208",
    cardBackBorder: "rgba(255, 210, 160, 0.25)",
  },
  {
    id: "charcoal",
    label: "Charcoal · Ruby backs",
    feltMid: "#3a3f45",
    felt: "#22262c",
    feltEdge: "#0e1014",
    feltRail: "#15181c",
    cardBackFrom: "#6b1220",
    cardBackTo: "#1a0508",
    cardBackBorder: "rgba(255, 160, 170, 0.22)",
  },
];

export const TABLE_THEME_STORAGE_KEY = "poker-table-theme";
