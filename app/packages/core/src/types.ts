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
  /** Признак зоны эвакуации: юнит, находящийся в клетке, может выполнить умение с признаком извлечения (§6 math). */
  extract?: boolean;
}

export interface Grid {
  width: number;
  height: number;
  tiles: Tile[];
}

/**
 * Исполнительное представление сущности тактического ядра.
 * Необязательные поля добавлены с безопасными значениями по умолчанию, чтобы
 * снимки предыдущих версий оставались читаемыми.
 */
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
  vision: number;
  will?: number;
  /** Текущее оружие; сохраняется для совместимости снимков 0.7.x. */
  weaponId: string;
  /** Все доступные юниту записи оружия. */
  weaponIds?: string[];
  /** Все доступные юниту активные умения. */
  skillIds?: string[];
  /** Оставшаяся перезарядка по идентификатору умения. */
  skillCooldowns?: Record<string, number>;
  /** Число уже выполненных применений за текущий бой. */
  skillUses?: Record<string, number>;
  obstacle: boolean;
  dead: boolean;
  flying: boolean;
  hidden?: boolean;
  decoy?: boolean;
  /** Отравление обрабатывается в начале хода владельца. */
  poison?: { damagePerTurn: number; turnsLeft: number };
  /** Паника хранит источник бегства и число оставшихся срабатываний. */
  panic?: { sourceId: number; turnsLeft: number };
  /** Обездвиживание действует до конца указанного числа ходов владельца. */
  immobileTurns?: number;
  /** Ограниченное существование призыва/иллюзии. */
  timedLife?: number;
  /** Учитывается ли сущность в условии уничтожения стороны. */
  countsForElimination?: boolean;
  camouflageMinCover?: boolean;
  providesCamouflage?: boolean;
  fleeHp?: number;
  coverType: 0 | 1 | 2;
  /** Граневое укрытие: 0=N, 1=E, 2=S, 3=W. undefined = занимает всю клетку. */
  edge?: 0 | 1 | 2 | 3;
  /** Признак дозора (§14). */
  overwatch: boolean;
  /** Защитная стойка: +25 к уклонению и −2 к урону атак. */
  defending?: boolean;
  /** Суммарная стоимость добровольного перемещения в текущем ходу стороны. */
  movementSpent?: number;
  /**
   * Индекс бойца в составе высадки кампании (0 … N−1). Присваивается только
   * бойцам дружины при создании сражения миссии; у противников, призывов и
   * иллюзий отсутствует. Позволяет сопоставлять сущность боя с бойцом дружины
   * по явной метке, а не по порядку идентификаторов.
   */
  rosterIndex?: number;
}

export interface MatchState {
  turnNumber: number;
  activeOwner: number;
  grid: Grid;
  entities: EntityState[];
  /** Исходное значение Mulberry32 в десятичном представлении. */
  rngSeed?: string;
  /** Текущее ui32-состояние Mulberry32 в десятичном представлении. */
  rngState?: string;
  /**
   * Цель миссии кампании (типы destroy/rescue/recon, roadmap 0.13.0).
   * destroy: уничтожить сущность записи unitId; rescue: эвакуировать указанное
   * лицо; recon: эвакуировать хотя бы одного бойца высадки.
   */
  objective?: MissionObjective;
}

/**
 * Цель миссии тактического сражения (base-design §3.2).
 * Задаётся сценарием миссии в конфигурации кампании и проверяется ядром.
 */
export type MissionObjective =
  | { kind: "destroy"; unitId: string }
  | { kind: "rescue"; unitId: string }
  | { kind: "recon" };

export interface ReachableCell extends CellPos {
  mpCost: number;
  apCost: 1 | 2;
}

export type Command =
  | { type: "MOVE"; actorId: number; to: CellPos; path?: CellPos[] }
  | { type: "ATTACK"; actorId: number; targetId: number; weaponId: string }
  | { type: "OVERWATCH"; actorId: number }
  | { type: "DEFEND"; actorId: number }
  | { type: "USE_SKILL"; actorId: number; skillId: string; targetId?: number; targetPos?: CellPos }
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
  | { type: "ENTITY_DISPLACED"; entityId: number; from: CellPos; to: CellPos; cause: "KNOCKBACK" | "TELEPORT" | "FALL" }
  | { type: "STAT_CHANGED"; entityId: number; stat: "AP" | "HP"; newValue: number; delta: number }
  | {
      type: "COMBAT_RESOLVED";
      sourceId: number;
      targetId: number;
      actionType: "MELEE" | "RANGED" | "MAGIC";
      result: "HIT" | "MISS" | "CRIT";
      damageDealt: number;
      isFlanked: boolean;
      heightMod: -1 | 0 | 1;
    }
  | { type: "SKILL_RESOLVED"; sourceId: number; skillId: string; targetId?: number; targetPos?: CellPos; success: boolean }
  | { type: "SKILL_RESOURCE_CHANGED"; entityId: number; skillId: string; cooldown: number; uses: number; usesLeft?: number }
  | {
      type: "STATUS_CHANGED";
      entityId: number;
      status: "POISON" | "PANIC" | "OVERWATCH" | "DEFENDING" | "HIDDEN" | "IMMOBILE" | "FLYING" | "TIMED" | "CAMOUFLAGE";
      applied: boolean;
      duration?: number;
      magnitude?: number;
      sourceId?: number;
    }
  | { type: "ENTITY_SPAWNED"; entity: EntityState; cause: "SUMMON" | "ILLUSION" | "RESURRECTION" }
  | { type: "COVER_DESTROYED"; gridPos: CellPos; newStatus: "HALF" | "NONE" }
  | { type: "ENTITY_DIED"; entityId: number; causeOfDeath: "DAMAGE" | "FALL_INTO_PIT" | "POISON" }
  | { type: "ENTITY_REMOVED"; entityId: number; reason: "FLED" | "EXPIRED" | "EXTRACTED" }
  | { type: "OVERWATCH_FIRED"; watcherId: number; triggerId: number; at: CellPos }
  | { type: "REVEALED"; entityId: number; snapshot: EntityState }
  | { type: "MATCH_ENDED"; winnerPlayerId: string | null; reason: "ELIMINATION" | "OBJECTIVE" | "SURRENDER" | "CAMPAIGN_RESULT" };

export type RejectReason =
  | "ILLEGAL"
  | "NO_AP"
  | "ON_COOLDOWN"
  | "NO_USES"
  | "NOT_YOUR_TURN"
  | "OCCUPIED"
  | "NOT_FOUND"
  | "NO_LOS"
  | "OUT_OF_RANGE";

export type ApplyResult =
  | { ok: true; events: GameEvent[] }
  | { ok: false; reason: RejectReason };
