/** Lobby JSON stored in DynamoDB / broadcast on the wire (matches `TableLobby`). */
export type WireLobby = {
  id: string;
  name: string;
  seats: ("empty" | "human" | "bot")[];
  humanBuyIn: number;
  botBuyIn: number;
  minBuyIn?: number;
  maxBuyIn?: number;
  smallBlind?: number;
  bigBlind?: number;
  seatBuyIns?: number[];
};

/** Messages from Lambda → browser (WebSocket data frame JSON). */
export type ServerMessage =
  | { type: "lobbyCreated"; lobby: WireLobby }
  | { type: "lobbyState"; lobby: WireLobby }
  | { type: "presence"; lobbyId: string; connectionId?: string; joined?: boolean; left?: boolean }
  | { type: "leftLobby" }
  | { type: "pong"; t: number }
  | { type: "error"; message: string };

/** Client → Lambda ($default route body JSON). */
export type ClientAction =
  | {
      action: "createLobby";
      name?: string;
      seats?: WireLobby["seats"];
      humanBuyIn?: number;
      botBuyIn?: number;
      minBuyIn?: number;
      maxBuyIn?: number;
      smallBlind?: number;
      bigBlind?: number;
      seatBuyIns?: number[];
      playerName?: string;
    }
  | { action: "joinLobby"; lobbyId: string; playerName?: string }
  | { action: "syncLobby"; lobby: WireLobby }
  | { action: "leaveLobby" }
  | { action: "ping" };
