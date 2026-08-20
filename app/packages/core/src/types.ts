export interface CellPos {
  x: number;
  y: number;
  z: number;
}

export interface Tile {
  x: number;
  y: number;
  z: number;
  pit: boolean;
  blockLOS: boolean;
}

export interface Grid {
  width: number;
  height: number;
  tiles: Tile[];
}

export interface EntityState {
  id: number;
  configId: string;
  owner: number;
  x: number;
  y: number;
  z: number;
  dir: number;
  ap: number;
  maxAp: number;
  mobility: number;
  hp: number;
  maxHp: number;
  obstacle: boolean;
  dead: boolean;
  flying: boolean;
  coverType: 0 | 1 | 2;
}

export interface MatchState {
  turnNumber: number;
  activeOwner: number;
  grid: Grid;
  entities: EntityState[];
}

export interface ReachableCell extends CellPos {
  mpCost: number;
  apCost: 1 | 2;
}

export type Command =
  | { type: "MOVE"; actorId: number; to: CellPos; path?: CellPos[] }
  | { type: "END_TURN"; playerId: string };

export type GameEvent =
  | { type: "TURN_CHANGED"; activePlayerId: string; turnNumber: number }
  | {
      type: "ENTITY_MOVED";
      entityId: number;
      path: CellPos[];
      isDash: boolean;
      apSpent: number;
    }
  | { type: "STAT_CHANGED"; entityId: number; stat: "AP"; newValue: number; delta: number };

export type RejectReason = "ILLEGAL" | "NO_AP" | "NOT_YOUR_TURN" | "OCCUPIED" | "NOT_FOUND";

export type ApplyResult =
  | { ok: true; events: GameEvent[] }
  | { ok: false; reason: RejectReason };
