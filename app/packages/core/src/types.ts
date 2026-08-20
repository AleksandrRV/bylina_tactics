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
  aim: number;
  defense: number;
  weaponId: string;
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
  | { type: "ATTACK"; actorId: number; targetId: number; weaponId?: string }
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
  | { type: "STAT_CHANGED"; entityId: number; stat: "AP" | "HP"; newValue: number; delta: number }
  | {
      type: "COMBAT_RESOLVED";
      sourceId: number;
      targetId: number;
      actionType: "MELEE" | "RANGED";
      result: "HIT" | "MISS" | "CRIT";
      damageDealt: number;
      isFlanked: boolean;
      heightMod: -1 | 0 | 1;
    }
  | { type: "ENTITY_DIED"; entityId: number; causeOfDeath: "DAMAGE" };

export type RejectReason =
  | "ILLEGAL"
  | "NO_AP"
  | "NOT_YOUR_TURN"
  | "OCCUPIED"
  | "NOT_FOUND"
  | "NO_LOS"
  | "OUT_OF_RANGE";

export type ApplyResult =
  | { ok: true; events: GameEvent[] }
  | { ok: false; reason: RejectReason };
