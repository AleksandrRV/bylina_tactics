import { previewAttack, resolveAttack, type AttackOptions, type HitPreview } from "./combat.js";
import { isCoverCandidate, isCoverOnFireLine } from "./cover.js";
import { createDebugMatch, ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import type { SpawnUnitConfig } from "./defaults.js";
import { computeVisibleCells, createFogState, refreshFog, type FogState } from "./fog.js";
import { distH, facingAfterStep, isCardinal, tileAt } from "./grid.js";
import { effectiveCoverTier, hasLineOfSight } from "./los.js";
import { edgeCost, edgeCoverBetween } from "./occupancy.js";
import { apCostFor, findPath, listReachable } from "./pathfinding.js";
import { inMeleeReach, inRangedReach } from "./range.js";
import { createMulberry32, clampChance, type Rng } from "./rng.js";
import { spawnUnitState } from "./match.js";
import { isResurrectionSpawn, spawnCause, type SkillEffect, type SkillPreview, type SkillStats, type SpawnCause, type StatusId } from "./skills.js";
import type {
  ApplyResult,
  CellPos,
  Command,
  EntityState,
  GameEvent,
  MatchState,
  ReachableCell,
} from "./types.js";
import { defaultWeapons, type WeaponStats } from "./weapons.js";

export const CORE_VERSION = "0.20.17";

export interface KernelOptions {
  initial?: MatchState;
  weapons?: Record<string, WeaponStats>;
  skills?: Record<string, SkillStats>;
  units?: SpawnUnitConfig[];
  seed?: number;
  /** Восстановленный туман войны (сохранение партии, версия 0.13.0). */
  fog?: FogState;
}

export interface TacticsKernel {
  readonly version: string;
  /** Полный снимок ведущего. Не передавать представлению стороны. */
  getSnapshot(): MatchState;
  /** Сокращённый по видимости снимок стороны. */
  getSnapshotFor(owner: number): MatchState;
  getReachable(actorId: number): ReachableCell[];
  getPath(actorId: number, to: CellPos): { path: CellPos[]; mpCost: number; apCost: 1 | 2 } | null;
  getHitPreview(actorId: number, targetId: number, weaponId?: string): HitPreview;
  getSkillPreview(actorId: number, skillId: string, targetId?: number, targetPos?: CellPos): SkillPreview;
  getSkillDefinition(skillId: string): SkillStats | undefined;
  getVisibleCells(owner: number): Set<string>;
  getExploredCells(owner: number): Set<string>;
  /** Полный туман войны всех сторон (для сохранения партии). */
  getFog(): FogState;
  apply(command: Command): ApplyResult;
  /**
   * Отладочная автопобеда (только для разработки и QA): мгновенно уничтожает
   * всех противников и фиксирует победу текущей стороны. Не изменяет баланс
   * и не раскрывает скрытых сведений; применяется как обычная победа.
   */
  debugAutoWin(): ApplyResult;
  subscribe(listener: () => void): () => void;
}

function cloneState(state: MatchState): MatchState {
  return {
    turnNumber: state.turnNumber,
    activeOwner: state.activeOwner,
    objective: state.objective ? { ...state.objective } : undefined,
    extracted: state.extracted ? state.extracted.map((entry) => ({ ...entry })) : undefined,
    apple: state.apple ? { pos: { ...state.apple.pos }, carrierId: state.apple.carrierId } : undefined,
    grid: {
      width: state.grid.width,
      height: state.grid.height,
      tiles: state.grid.tiles.map((tile) => ({ ...tile })),
    },
    entities: state.entities.map((entity) => ({
      ...entity,
      weaponIds: entity.weaponIds ? [...entity.weaponIds] : undefined,
      skillIds: entity.skillIds ? [...entity.skillIds] : undefined,
      skillCooldowns: entity.skillCooldowns ? { ...entity.skillCooldowns } : undefined,
      skillUses: entity.skillUses ? { ...entity.skillUses } : undefined,
      poison: entity.poison ? { ...entity.poison } : undefined,
      panic: entity.panic ? { ...entity.panic } : undefined,
    })),
    rngSeed: state.rngSeed,
    rngState: state.rngState,
  };
}

function nextOwner(state: MatchState, current: number): number {
  // Порядок хода строится по фактическим владельцам живых юнитов, а не по
  // фиксированной паре сторон: состязательный режим допускает произвольное
  // число участников (base-design §7).
  const living = new Set(
    state.entities.filter((entity) => !entity.dead && entity.coverType === 0 && entity.maxAp > 0).map((entity) => entity.owner),
  );
  const order = [...living].sort((a, b) => a - b);
  if (order.length === 0) return current;
  const index = order.indexOf(current);
  if (index === -1) return order[0] ?? current;
  return order[(index + 1) % order.length] ?? current;
}

function samePath(a: readonly CellPos[], b: readonly CellPos[]): boolean {
  return a.length === b.length && a.every((cell, index) => {
    const other = b[index];
    return other?.x === cell.x && other.y === cell.y && other.z === cell.z;
  });
}

function cellPos(entity: EntityState): CellPos {
  return { x: entity.x, y: entity.y, z: entity.z };
}

function inFrontHalfPlane(observer: EntityState, cx: number, cy: number): boolean {
  const dx = cx - observer.x;
  const dy = cy - observer.y;
  const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const [fx, fy] = dirs[observer.dir] ?? [0, -1];
  return fx * dx + fy * dy >= 0;
}

function canWeaponReach(grid: MatchState["grid"], actor: EntityState, target: EntityState, weapon: WeaponStats): "OUT_OF_RANGE" | "NO_LOS" | null {
  const inReach = weapon.category === "melee"
    ? inMeleeReach(actor.x, actor.y, actor.z, target.x, target.y, target.z)
    : inRangedReach(actor.x, actor.y, actor.z, target.x, target.y, target.z, weapon.range);
  if (!inReach) return "OUT_OF_RANGE";
  if (weapon.requiresLOS && !hasLineOfSight(grid, actor.x, actor.y, actor.z, target.x, target.y, target.z)) return "NO_LOS";
  return null;
}

function skillWeapon(skill: SkillStats): WeaponStats | null {
  const damage = skill.effects.find((effect) => effect.type === "damage");
  if (!damage || damage.type !== "damage") return null;
  return {
    id: skill.id,
    category: skill.category === "ranged" ? "ranged" : "melee",
    apCost: skill.apCost,
    endsTurn: false,
    range: skill.category === "self" ? Math.max(1, skill.radius ?? 1) : skill.range,
    requiresLOS: skill.requiresLOS,
    aimMod: 0,
    minDmg: damage.minDmg,
    maxDmg: damage.maxDmg,
    crit: damage.crit ?? 0,
    critBonus: damage.critBonus ?? 0,
    envDmg: skill.envDmg,
    ignoreHalfCover: skill.ignoreHalfCover,
  };
}

export function createTacticsKernel(options: KernelOptions = {}): TacticsKernel {
  let state = cloneState(options.initial ?? createDebugMatch());
  const weapons = { ...defaultWeapons(), ...options.weapons };
  const skills = { ...(options.skills ?? {}) };
  const units = new Map((options.units ?? []).map((unit) => [unit.id, unit]));
  let nextEntityId = Math.max(0, ...state.entities.map((entity) => entity.id)) + 1;
  const seed = options.seed ?? Number(state.rngState ?? state.rngSeed ?? 0x51a7);
  const rng: Rng = createMulberry32(seed);
  state.rngSeed ??= String((options.seed ?? seed) >>> 0);
  state.rngState = String(rng.getState());
  const listeners = new Set<() => void>();
  const owners = [...new Set(state.entities.filter((entity) => entity.owner > 0).map((entity) => entity.owner))];
  const fog: FogState = createFogState(state, owners);
  // Восстановление сохранённой партии: туман войны переносится из снимка.
  if (options.fog) {
    for (const rawOwner of Object.keys(options.fog)) {
      const owner = Number(rawOwner);
      const entry = options.fog[owner];
      if (entry && fog[owner]) {
        fog[owner].explored = entry.explored;
        fog[owner].visible = entry.visible;
      }
    }
  }
  let ended = false;
  /** Победа по цели миссии (эвакуация при rescue/recon), фиксируется ядром. */
  let objectiveVictory = false;
  const eliminationOwners = new Set(state.entities
    .filter((entity) => !entity.dead && entity.owner > 0 && entity.coverType === 0 && entity.countsForElimination !== false)
    .map((entity) => entity.owner));
  const eliminationEnabled = eliminationOwners.size >= 2;

  const actorOf = (id: number): EntityState | undefined => state.entities.find((entity) => entity.id === id);
  const weaponIdsOf = (entity: EntityState): string[] => entity.weaponIds ?? (entity.weaponId ? [entity.weaponId] : []);
  const weaponOf = (entity: EntityState, weaponId?: string): WeaponStats | undefined => {
    const id = weaponId ?? entity.weaponId;
    if (!id || !weaponIdsOf(entity).includes(id)) return undefined;
    return weapons[id];
  };
  const skillOf = (entity: EntityState, skillId: string): SkillStats | undefined => {
    if (!(entity.skillIds ?? []).includes(skillId)) return undefined;
    return skills[skillId];
  };

  const refresh = (): void => {
    state.rngState = String(rng.getState());
    refreshFog(fog, state, owners);
  };
  const emit = (): void => {
    refresh();
    for (const listener of listeners) listener();
  };

  const visibleTo = (owner: number, entity: EntityState): boolean => {
    if (entity.owner === owner) return true;
    const entry = fog[owner];
    if (!entry?.visible.has(`${entity.x},${entity.y}`)) return false;
    return !entity.hidden;
  };

  const knownEntitiesForPath = (owner: number): EntityState[] => state.entities.filter((entity) => {
    if (entity.owner === owner) return true;
    if (entity.owner === 0) return fog[owner]?.explored.has(`${entity.x},${entity.y}`) ?? false;
    return visibleTo(owner, entity);
  });

  const knownGridForPath = (owner: number): MatchState["grid"] => {
    const explored = fog[owner]?.explored;
    if (!explored) return state.grid;
    return {
      width: state.grid.width,
      height: state.grid.height,
      tiles: state.grid.tiles.map((tile) => explored.has(`${tile.x},${tile.y}`)
        ? tile
        : { ...tile, pit: false, blockLOS: true }),
    };
  };

  const spendAction = (actor: EntityState, apCost: number, endsTurn: boolean, events: GameEvent[]): void => {
    const previous = actor.ap;
    const spent = endsTurn ? previous : apCost;
    actor.ap = Math.max(0, previous - spent);
    if (spent > 0) events.push({ type: "STAT_CHANGED", entityId: actor.id, stat: "AP", newValue: actor.ap, delta: -spent });
  };

  const reveal = (entity: EntityState, events: GameEvent[]): void => {
    if (!entity.hidden) return;
    entity.hidden = false;
    events.push({ type: "STATUS_CHANGED", entityId: entity.id, status: "HIDDEN", applied: false });
    events.push({ type: "REVEALED", entityId: entity.id, snapshot: { ...entity } });
  };

  const revealAdjacent = (events: GameEvent[]): void => {
    for (const entity of state.entities) {
      if (!entity.hidden || entity.dead || entity.coverType > 0) continue;
      if (state.entities.some((other) =>
        !other.dead && other.coverType === 0 && other.owner > 0 && other.owner !== entity.owner &&
        distH(entity.x, entity.y, other.x, other.y) <= 1
      )) reveal(entity, events);
    }
  };

  const kill = (entity: EntityState, causeOfDeath: "DAMAGE" | "FALL_INTO_PIT" | "POISON", events: GameEvent[]): void => {
    if (entity.dead) return;
    entity.dead = true;
    entity.obstacle = false;
    entity.ap = 0;
    entity.overwatch = false;
    entity.defending = false;
    entity.hidden = false;
    entity.flying = false;
    entity.poison = undefined;
    entity.panic = undefined;
    entity.immobileTurns = undefined;
    // Гибель носителя: предмет остаётся в клетке гибели и не имеет носителя (§17 math).
    if (state.apple?.carrierId === entity.id) {
      state.apple.carrierId = null;
      events.push({ type: "OBJECTIVE_CHANGED", carrierId: null, pos: { ...state.apple.pos } });
    }
    events.push({ type: "ENTITY_DIED", entityId: entity.id, causeOfDeath });
  };

  /**
   * Обновление носителя предмета (math §17): после перемещения, смещения или
   * телепортации юнит в клетке предмета становится носителем; носитель несёт
   * предмет с собой. Событие OBJECTIVE_CHANGED шлётся при изменении.
   */
  const updateAppleCarrier = (entity: EntityState, events: GameEvent[]): void => {
    const apple = state.apple;
    if (!apple) return;
    const before = { carrierId: apple.carrierId, pos: { ...apple.pos } };
    if (apple.carrierId !== null) {
      const carrier = actorOf(apple.carrierId);
      if (!carrier || carrier.dead) {
        apple.carrierId = null;
      } else {
        apple.pos = { x: carrier.x, y: carrier.y, z: carrier.z };
      }
    } else if (!entity.dead && entity.x === apple.pos.x && entity.y === apple.pos.y && entity.z === apple.pos.z) {
      apple.carrierId = entity.id;
    }
    if (
      before.carrierId !== apple.carrierId ||
      before.pos.x !== apple.pos.x ||
      before.pos.y !== apple.pos.y ||
      before.pos.z !== apple.pos.z
    ) {
      events.push({ type: "OBJECTIVE_CHANGED", carrierId: apple.carrierId, pos: { ...apple.pos } });
    }
  };

  const removeEntity = (entity: EntityState, reason: "FLED" | "EXPIRED" | "EXTRACTED", events: GameEvent[]): void => {
    state.entities = state.entities.filter((candidate) => candidate.id !== entity.id);
    // Уход носителя без гибели: предмет остаётся в клетке ухода и не имеет
    // носителя (§17 math; гибель обрабатывает kill, уход — removeEntity).
    if (state.apple?.carrierId === entity.id) {
      state.apple.carrierId = null;
      events.push({ type: "OBJECTIVE_CHANGED", carrierId: null, pos: { ...state.apple.pos } });
    }
    events.push({ type: "ENTITY_REMOVED", entityId: entity.id, reason });
  };

  const applyDamage = (target: EntityState, damage: number, events: GameEvent[], cause: "DAMAGE" | "POISON" = "DAMAGE"): void => {
    if (damage <= 0 || target.dead) return;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    events.push({ type: "STAT_CHANGED", entityId: target.id, stat: "HP", newValue: target.hp, delta: target.hp - before });
    // Гибель (включая снижение здоровья до нуля) окончательна: пороговый уход
    // (§15.6) применяется только при положительном запасе здоровья.
    if (target.hp <= 0) {
      kill(target, cause, events);
      return;
    }
    if (target.fleeHp !== undefined && target.hp <= target.fleeHp) {
      removeEntity(target, "FLED", events);
    }
  };

  const damageCover = (cover: EntityState, events: GameEvent[]): void => {
    cover.coverType = Math.max(0, cover.coverType - 1) as 0 | 1 | 2;
    if (cover.coverType === 0) {
      cover.obstacle = false;
      cover.dead = true;
    }
    events.push({
      type: "COVER_DESTROYED",
      gridPos: cellPos(cover),
      newStatus: cover.coverType === 0 ? "NONE" : "HALF",
    });
  };

  const clearStatus = (target: EntityState, status: StatusId, events: GameEvent[]): boolean => {
    if (status === "poison" && target.poison) {
      target.poison = undefined;
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "POISON", applied: false });
      return true;
    }
    if (status === "panic" && target.panic) {
      target.panic = undefined;
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "PANIC", applied: false });
      return true;
    }
    if (status === "immobile" && target.immobileTurns) {
      target.immobileTurns = undefined;
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "IMMOBILE", applied: false });
      return true;
    }
    if (status === "hidden" && target.hidden) {
      reveal(target, events);
      return true;
    }
    if (status === "flying" && target.flying) {
      target.flying = false;
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "FLYING", applied: false });
      if (tileAt(state.grid, target.x, target.y)?.pit) {
        const before = target.hp;
        target.hp = 0;
        events.push({ type: "STAT_CHANGED", entityId: target.id, stat: "HP", newValue: 0, delta: -before });
        kill(target, "FALL_INTO_PIT", events);
      }
      return true;
    }
    if (status === "timed" && target.timedLife !== undefined) {
      target.timedLife = undefined;
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "TIMED", applied: false });
      return true;
    }
    return false;
  };

  const applyStatus = (
    source: EntityState,
    target: EntityState,
    effect: Extract<SkillEffect, { type: "applyStatus" }>,
    events: GameEvent[],
    affectsFlying = false,
  ): boolean => {
    const duration = effect.duration;
    if (effect.status === "poison") {
      target.poison = { damagePerTurn: Math.max(1, Math.round(effect.magnitude ?? 1)), turnsLeft: duration };
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "POISON", applied: true, duration, magnitude: target.poison.damagePerTurn, sourceId: source.id });
      return true;
    }
    if (effect.status === "panic") {
      target.panic = { sourceId: source.id, turnsLeft: duration };
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "PANIC", applied: true, duration, sourceId: source.id });
      return true;
    }
    if (effect.status === "immobile") {
      // §15.4: полёт отменяет обездвиживание, кроме умений с признаком affectsFlying.
      if (target.flying && !affectsFlying) return false;
      target.immobileTurns = Math.max(target.immobileTurns ?? 0, duration);
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "IMMOBILE", applied: true, duration: target.immobileTurns, sourceId: source.id });
      return true;
    }
    if (effect.status === "hidden") {
      target.hidden = true;
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "HIDDEN", applied: true, duration, sourceId: source.id });
      return true;
    }
    if (effect.status === "flying") {
      target.flying = true;
      events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "FLYING", applied: true, duration, sourceId: source.id });
      return true;
    }
    target.timedLife = duration;
    events.push({ type: "STATUS_CHANGED", entityId: target.id, status: "TIMED", applied: true, duration, sourceId: source.id });
    return true;
  };

  const spawnAt = (
    source: EntityState,
    unitId: string,
    pos: CellPos,
    cause: "SUMMON" | "ILLUSION" | "RESURRECTION",
    events: GameEvent[],
  ): EntityState | null => {
    const config = units.get(unitId);
    const tile = tileAt(state.grid, pos.x, pos.y);
    if (!config || !tile || tile.blockLOS) return null;
    const flying = config.tags?.includes("flying") ?? false;
    if (tile.pit && !flying) return null;
    if (state.entities.some((entity) => !entity.dead && entity.obstacle && entity.x === pos.x && entity.y === pos.y)) return null;
    if (cause === "RESURRECTION") {
      const corpse = state.entities.find((entity) => entity.dead && entity.configId === unitId && entity.x === pos.x && entity.y === pos.y);
      if (!corpse) return null;
      state.entities = state.entities.filter((entity) => entity.id !== corpse.id);
    }
    const spawned = spawnUnitState(nextEntityId++, config, source.owner, pos.x, pos.y, tile.z, source.dir);
    spawned.countsForElimination = cause === "RESURRECTION";
    if (cause === "RESURRECTION") spawned.hp = 1;
    state.entities.push(spawned);
    events.push({
      type: "ENTITY_SPAWNED",
      entity: {
        ...spawned,
        weaponIds: spawned.weaponIds ? [...spawned.weaponIds] : undefined,
        skillIds: spawned.skillIds ? [...spawned.skillIds] : undefined,
        skillCooldowns: spawned.skillCooldowns ? { ...spawned.skillCooldowns } : undefined,
        skillUses: spawned.skillUses ? { ...spawned.skillUses } : undefined,
      },
      cause,
    });
    if (spawned.timedLife !== undefined) {
      events.push({ type: "STATUS_CHANGED", entityId: spawned.id, status: "TIMED", applied: true, duration: spawned.timedLife, sourceId: source.id });
    }
    return spawned;
  };

  const coverOnFireLine = (attacker: EntityState, target: EntityState): EntityState | null => {
    const candidates = state.entities
      .filter((entity) => isCoverCandidate(target, entity) && isCoverOnFireLine(attacker, target, entity))
      .sort((a, b) => b.coverType - a.coverType || a.id - b.id);
    return candidates[0] ?? null;
  };

  /**
   * Палица сначала принимает разрушаемое граневое укрытие на удар, затем
   * разрешает атаку по оставшейся ступени. Полученный средой урон вычитается
   * из урона по цели.
   */
  const edgeCoverOnLine = (attacker: EntityState, target: EntityState): EntityState | undefined => state.entities
    .filter((entity) =>
      entity.edge !== undefined &&
      isCoverCandidate(target, entity) &&
      isCoverOnFireLine(attacker, target, entity)
    )
    .sort((a, b) => b.coverType - a.coverType || a.id - b.id)[0];

  const edgeAttackOptions = (
    attacker: EntityState,
    target: EntityState,
    cover: EntityState,
    rawTier: 0 | 1 | 2,
    ignoreHalfCover: boolean,
    damageReduction = 0,
  ): AttackOptions => {
    const effectiveTier = target.flying
      ? 0
      : effectiveCoverTier(rawTier, false, attacker.z, target.z, cover.z);
    const rawPenalty = effectiveTier === 2 ? 50 : effectiveTier === 1 ? 25 : 0;
    return {
      coverPenaltyOverride: ignoreHalfCover && rawPenalty === 25 ? 0 : rawPenalty,
      coverTypeOverride: effectiveTier,
      flankedOverride: false,
      coverDetailsOverride: [],
      damageReduction,
    };
  };

  const edgeBreach = (
    attacker: EntityState,
    target: EntityState,
    weapon: WeaponStats,
  ): { cover: EntityState; options: AttackOptions } | null => {
    const environmentDamage = weapon.envDmg ?? 0;
    if (weapon.category !== "melee" || environmentDamage < 1) return null;
    const cover = edgeCoverOnLine(attacker, target);
    if (!cover) return null;
    const remainingRaw = Math.max(0, cover.coverType - 1) as 0 | 1 | 2;
    return {
      cover,
      options: edgeAttackOptions(
        attacker,
        target,
        cover,
        remainingRaw,
        Boolean(weapon.ignoreHalfCover),
        environmentDamage,
      ),
    };
  };

  const currentEdgeOptions = (
    attacker: EntityState,
    target: EntityState,
    weapon: WeaponStats,
  ): AttackOptions | undefined => {
    if (weapon.category !== "melee") return undefined;
    const cover = edgeCoverOnLine(attacker, target);
    return cover
      ? edgeAttackOptions(attacker, target, cover, cover.coverType, Boolean(weapon.ignoreHalfCover))
      : undefined;
  };

  const appendOutcome = (events: GameEvent[]): void => {
    if (ended || !eliminationEnabled) return;
    const objective = state.objective;

    // Переносимый предмет (math §17): победа в момент, когда носитель стоит
    // на клетке домашнего края своей стороны. Проверяется после каждого
    // перемещения, смещения и начала хода (appendOutcome вызывается везде).
    if (state.apple && state.apple.carrierId !== null) {
      const carrier = state.entities.find((entity) => entity.id === state.apple?.carrierId);
      if (carrier && !carrier.dead && carrier.owner > 0) {
        const home = tileAt(state.grid, carrier.x, carrier.y);
        if (home?.homeOwner === carrier.owner) {
          ended = true;
          events.push({ type: "MATCH_ENDED", winnerPlayerId: String(carrier.owner), reason: "OBJECTIVE" });
          return;
        }
      }
    }

    const livingOwners = new Set(state.entities.filter((entity) => !entity.dead && entity.owner > 0 && entity.coverType === 0 && entity.countsForElimination !== false).map((entity) => entity.owner));
    const players = livingOwners.has(PLAYER_OWNER);
    const enemies = [...livingOwners].some((owner) => owner !== PLAYER_OWNER);

    // Уничтожение объекта: победа при гибели указанного идола/строения,
    // независимо от оставшихся противников (base-design §3.2).
    if (objective?.kind === "destroy") {
      const targetAlive = state.entities.some((entity) => !entity.dead && entity.configId === objective.unitId);
      if (!targetAlive) {
        ended = true;
        events.push({ type: "MATCH_ENDED", winnerPlayerId: String(PLAYER_OWNER), reason: "OBJECTIVE" });
        return;
      }
      if (!players) {
        ended = true;
        events.push({ type: "MATCH_ENDED", winnerPlayerId: String(ENEMY_OWNER), reason: "ELIMINATION" });
      }
      return;
    }

    // Спасение: победа — эвакуация указанного лица; поражение — его гибель
    // либо гибель всех бойцов высадки. Эвакуированная сущность удалена с поля,
    // погибшая остаётся с признаком гибели.
    if (objective?.kind === "rescue") {
      if (objectiveVictory) {
        ended = true;
        events.push({ type: "MATCH_ENDED", winnerPlayerId: String(PLAYER_OWNER), reason: "OBJECTIVE" });
        return;
      }
      const escortee = state.entities.find((entity) => entity.configId === objective.unitId);
      if (escortee?.dead || !players) {
        ended = true;
        events.push({ type: "MATCH_ENDED", winnerPlayerId: String(ENEMY_OWNER), reason: "OBJECTIVE" });
      }
      return;
    }

    // Разведка: победа — эвакуация хотя бы одного бойца высадки; остальные
    // могут остаться. Поражение — гибель всех бойцов.
    if (objective?.kind === "recon") {
      if (objectiveVictory) {
        ended = true;
        events.push({ type: "MATCH_ENDED", winnerPlayerId: String(PLAYER_OWNER), reason: "OBJECTIVE" });
        return;
      }
      if (!players) {
        ended = true;
        events.push({ type: "MATCH_ENDED", winnerPlayerId: String(ENEMY_OWNER), reason: "ELIMINATION" });
      }
      return;
    }

    if (players && enemies) return;
    ended = true;
    events.push({
      type: "MATCH_ENDED",
      winnerPlayerId: players === enemies ? null : String(players ? PLAYER_OWNER : ENEMY_OWNER),
      reason: "ELIMINATION",
    });
  };

  const canOverwatchHit = (observer: EntityState, target: EntityState, weapon: WeaponStats): boolean => {
    if (target.hidden || !inFrontHalfPlane(observer, target.x, target.y)) return false;
    // §9.5: полная грань запрещает обычную ближнюю атаку — и ответный огонь дозора тоже.
    if (weapon.category === "melee" && edgeCoverOnLine(observer, target)?.coverType === 2) return false;
    return canWeaponReach(state.grid, observer, target, weapon) === null;
  };

  const triggerOverwatch = (mover: EntityState, events: GameEvent[]): boolean => {
    const observers = state.entities
      .filter((entity) => entity.overwatch && !entity.dead && entity.owner !== mover.owner && entity.coverType === 0)
      .sort((a, b) => a.id - b.id);
    for (const observer of observers) {
      if (mover.dead) break;
      const weapon = weaponOf(observer);
      if (!weapon || !canOverwatchHit(observer, mover, weapon)) continue;
      observer.overwatch = false;
      events.push({ type: "STATUS_CHANGED", entityId: observer.id, status: "OVERWATCH", applied: false });
      // §8.2: выполненная атака снимает скрытность наблюдающего.
      reveal(observer, events);
      events.push({ type: "OVERWATCH_FIRED", watcherId: observer.id, triggerId: mover.id, at: cellPos(mover) });
      const edgeOptions = weapon.category === "melee" ? currentEdgeOptions(observer, mover, weapon) : undefined;
      const resolved = resolveAttack(state.grid, state.entities, observer, mover, weapon, rng, {
        ignoreAp: true,
        ...(edgeOptions ?? {}),
      });
      if (!resolved) continue;
      events.push({
        type: "COMBAT_RESOLVED",
        sourceId: observer.id,
        targetId: mover.id,
        actionType: resolved.actionType,
        result: resolved.result,
        damageDealt: resolved.damage,
        isFlanked: resolved.flanked,
        heightMod: resolved.heightMod,
      });
      applyDamage(mover, resolved.damage, events);
    }
    return mover.dead;
  };

  const displacementDestinationAllowed = (target: EntityState, x: number, y: number): boolean => {
    const tile = tileAt(state.grid, x, y);
    if (!tile || tile.blockLOS || Math.abs(tile.z - target.z) === 2) return false;
    const dx = x - target.x;
    const dy = y - target.y;
    const crossed = dx !== 0 && dy !== 0
      ? [
          edgeCoverBetween(state.entities, target.x, target.y, target.x + dx, target.y),
          edgeCoverBetween(state.entities, target.x, target.y, target.x, target.y + dy),
        ]
      : [edgeCoverBetween(state.entities, target.x, target.y, x, y)];
    if (crossed.some((cover) => cover?.coverType === 2)) return false;
    return state.entities.every((entity) =>
      entity.id === target.id || entity.dead || entity.x !== x || entity.y !== y || !entity.obstacle
    );
  };

  const displace = (source: EntityState, target: EntityState, events: GameEvent[]): void => {
    const rawDx = target.x - source.x;
    const rawDy = target.y - source.y;
    const dx = Math.sign(rawDx);
    const dy = Math.sign(rawDy);
    const candidates: [number, number][] = [[target.x + dx, target.y + dy]];
    if (dx !== 0 && dy !== 0) {
      const xFirst = Math.abs(rawDx) >= Math.abs(rawDy);
      candidates.push(
        xFirst ? [target.x + dx, target.y] : [target.x, target.y + dy],
        xFirst ? [target.x, target.y + dy] : [target.x + dx, target.y],
      );
    }
    const destination = candidates.find(([x, y]) => displacementDestinationAllowed(target, x, y));
    if (!destination) {
      applyDamage(target, 2, events);
      return;
    }
    const [x, y] = destination;
    const tile = tileAt(state.grid, x, y)!;
    const from = cellPos(target);
    target.x = x;
    target.y = y;
    target.z = tile.z;
    const fall = tile.pit && !target.flying;
    events.push({ type: "ENTITY_DISPLACED", entityId: target.id, from, to: cellPos(target), cause: fall ? "FALL" : "KNOCKBACK" });
    refresh();
    revealAdjacent(events);
    if (fall) {
      const previousHp = target.hp;
      target.hp = 0;
      events.push({ type: "STAT_CHANGED", entityId: target.id, stat: "HP", newValue: 0, delta: -previousHp });
      kill(target, "FALL_INTO_PIT", events);
      return;
    }
    triggerOverwatch(target, events);
    updateAppleCarrier(target, events);
  };

  const teleport = (target: EntityState, destination: CellPos, events: GameEvent[]): boolean => {
    const tile = tileAt(state.grid, destination.x, destination.y);
    if (!tile || tile.blockLOS || (tile.pit && !target.flying)) return false;
    if (state.entities.some((entity) => entity.id !== target.id && !entity.dead && entity.obstacle && entity.x === destination.x && entity.y === destination.y)) return false;
    const from = cellPos(target);
    target.x = destination.x;
    target.y = destination.y;
    target.z = tile.z;
    events.push({ type: "ENTITY_DISPLACED", entityId: target.id, from, to: cellPos(target), cause: "TELEPORT" });
    refresh();
    revealAdjacent(events);
    triggerOverwatch(target, events);
    updateAppleCarrier(target, events);
    return true;
  };

  const processPanic = (unit: EntityState, events: GameEvent[]): void => {
    const panic = unit.panic;
    if (!panic || unit.dead) return;
    const source = actorOf(panic.sourceId);
    // §15.3: если источник паники погиб или покинул поле, перемещение
    // не выполняется (остаток ОД сгорает).
    if (source && !source.dead) {
      const probe = { ...unit, ap: 1, movementSpent: 0, panic: undefined };
      const candidates = listReachable(state.grid, state.entities, probe)
        .filter((cell) => cell.apCost === 1 && distH(cell.x, cell.y, source.x, source.y) > distH(unit.x, unit.y, source.x, source.y))
        .sort((a, b) => {
          const distance = distH(b.x, b.y, source.x, source.y) - distH(a.x, a.y, source.x, source.y);
          if (distance !== 0) return distance;
          // §15.3 → §5.2: при равенстве дистанции кардинальный шаг предпочтительнее диагонального.
          const aCardinal = isCardinal(a.x - unit.x, a.y - unit.y);
          const bCardinal = isCardinal(b.x - unit.x, b.y - unit.y);
          if (aCardinal !== bCardinal) return aCardinal ? -1 : 1;
          if (a.x !== b.x) return a.x - b.x;
          return a.y - b.y;
        });
      const destination = candidates[0];
      if (destination) {
        const path = findPath(state.grid, state.entities, unit, destination.x, destination.y);
        if (path) {
          for (let index = 1; index < path.path.length; index += 1) {
            const previous = path.path[index - 1]!;
            const step = path.path[index]!;
            unit.x = step.x;
            unit.y = step.y;
            unit.z = step.z;
            unit.dir = facingAfterStep(previous.x, previous.y, step.x, step.y, unit.dir);
            events.push({ type: "ENTITY_MOVED", entityId: unit.id, path: [previous, step], isDash: false, apSpent: index === 1 ? 1 : 0 });
            refresh();
            revealAdjacent(events);
            if (triggerOverwatch(unit, events)) break;
          }
        }
      }
    }
    if (!unit.dead && unit.ap !== 0) {
      const before = unit.ap;
      unit.ap = 0;
      events.push({ type: "STAT_CHANGED", entityId: unit.id, stat: "AP", newValue: 0, delta: -before });
    }
    panic.turnsLeft -= 1;
    if (panic.turnsLeft <= 0 || unit.dead) {
      unit.panic = undefined;
      if (!unit.dead) events.push({ type: "STATUS_CHANGED", entityId: unit.id, status: "PANIC", applied: false });
    }
  };

  const applySkillEffects = (
    source: EntityState,
    skill: SkillStats,
    target: EntityState | undefined,
    targetPos: CellPos | undefined,
    events: GameEvent[],
    skipCoverDamage = false,
  ): boolean => {
    let changed = false;
    const effectTarget = target ?? source;
    for (const effect of skill.effects) {
      if (effect.type === "damage" || effect.type === "knockback") continue;
      if (effect.type === "heal") {
        if (effectTarget.dead) continue;
        const before = effectTarget.hp;
        effectTarget.hp = Math.min(effectTarget.maxHp, effectTarget.hp + effect.amount);
        if (effectTarget.hp !== before) {
          events.push({ type: "STAT_CHANGED", entityId: effectTarget.id, stat: "HP", newValue: effectTarget.hp, delta: effectTarget.hp - before });
          changed = true;
        }
      } else if (effect.type === "applyStatus") {
        changed = applyStatus(source, effectTarget, effect, events, skill.affectsFlying) || changed;
      } else if (effect.type === "removeStatus") {
        changed = clearStatus(effectTarget, effect.status, events) || changed;
      } else if (effect.type === "destroyCover") {
        if (target?.coverType && skill.envDmg >= 1) {
          damageCover(target, events);
          changed = true;
        } else if (target && skill.affectsEnvironment && skill.envDmg >= 1 && !skipCoverDamage) {
          // Направленное укрытие уже повреждено ударом через грань (§12.1):
          // повторное разрушение эффектом не выполняется.
          const cover = coverOnFireLine(source, target);
          if (cover) {
            damageCover(cover, events);
            changed = true;
          }
        }
      } else if (effect.type === "spawn" && targetPos) {
        // Причина появления берётся из явного признака spawnKind записи;
        // эвристика по имени умения остаётся только для записей без признака.
        const cause: SpawnCause = spawnCause(effect, skill.id);
        changed = Boolean(spawnAt(source, effect.unitId, targetPos, cause, events)) || changed;
      } else if (effect.type === "displace" && target && targetPos) {
        changed = teleport(target, targetPos, events) || changed;
      } else if (effect.type === "flee" && target) {
        removeEntity(target, "FLED", events);
        changed = true;
      } else if (effect.type === "reveal") {
        const wasHidden = Boolean(effectTarget.hidden);
        reveal(effectTarget, events);
        changed = wasHidden || changed;
      }
    }
    return changed;
  };

  const areaTargets = (source: EntityState, skill: SkillStats, epicenter: CellPos): EntityState[] => state.entities
    .filter((entity) => {
      if (entity.dead || entity.coverType > 0 || distH(epicenter.x, epicenter.y, entity.x, entity.y) > (skill.radius ?? 0) || Math.abs(epicenter.z - entity.z) > 1) return false;
      if (skill.filter === "enemies") return entity.owner > 0 && entity.owner !== source.owner;
      if (skill.filter === "allies") return entity.owner === source.owner;
      return skill.filter !== "cover";
    })
    .sort((a, b) => a.id - b.id);

  const skillPreview = (actor: EntityState, skill: SkillStats, target?: EntityState, targetPos?: CellPos): SkillPreview => {
    if (actor.dead || actor.panic || actor.owner !== state.activeOwner || (actor.decoy && skill.resolution === "attack")) return { available: false, reason: "ILLEGAL" };
    if (actor.ap < skill.apCost) return { available: false, reason: "NO_AP" };
    if ((actor.skillCooldowns?.[skill.id] ?? 0) > 0) return { available: false, reason: "ON_COOLDOWN" };
    if (skill.maxUsesPerBattle !== undefined && (actor.skillUses?.[skill.id] ?? 0) >= skill.maxUsesPerBattle) {
      return { available: false, reason: "NO_USES" };
    }
    // §6 math: умение с признаком извлечения допустимо только в клетке зоны эвакуации.
    if (skill.extract) {
      const tile = tileAt(state.grid, actor.x, actor.y);
      if (!tile?.extract) return { available: false, reason: "ILLEGAL" };
      return { available: true, targetPos: cellPos(actor) };
    }
    if (skill.category === "self") return { available: true, targetPos: cellPos(actor) };
    if (!target && !targetPos) return { available: false, reason: "NOT_FOUND" };
    // §15.7: погибшая сущность не является допустимой целью.
    if (target && target.dead) return { available: false, reason: "ILLEGAL" };
    if (target) {
      const isCover = target.coverType > 0;
      const filter = skill.filter;
      const matches = filter === "cover"
        ? isCover
        : filter === "enemies"
          ? !isCover && target.owner > 0 && target.owner !== actor.owner
          : filter === "allies"
            ? !isCover && target.owner === actor.owner
            : true;
      if (!matches) return { available: false, reason: "ILLEGAL" };
    }
    // §10.4: атака по укрытию допустима только при разрушающей силе ≥ 1.
    if (target && target.coverType > 0 && skill.resolution === "attack") {
      const destroysCover = skill.effects.some((effect) => effect.type === "destroyCover") && (skill.envDmg ?? 0) >= 1;
      if (!destroysCover) return { available: false, reason: "ILLEGAL" };
    }
    const requestedTile = targetPos ? tileAt(state.grid, targetPos.x, targetPos.y) : undefined;
    const normalizedTargetPos = targetPos && requestedTile ? { x: targetPos.x, y: targetPos.y, z: requestedTile.z } : targetPos;
    const pos = target ? cellPos(target) : normalizedTargetPos!;
    const inReach = skill.category === "melee"
      ? inMeleeReach(actor.x, actor.y, actor.z, pos.x, pos.y, pos.z)
      : inRangedReach(actor.x, actor.y, actor.z, pos.x, pos.y, pos.z, skill.range);
    if (!inReach) return { available: false, reason: "OUT_OF_RANGE" };
    // §12.1: полную грань пробивает только разрушающее оружие/умение ближнего боя.
    if (target && skill.category === "melee" && edgeCoverOnLine(actor, target)?.coverType === 2) {
      const weapon = skillWeapon(skill);
      if (skill.resolution !== "attack" || !weapon || (weapon.envDmg ?? 0) < 1) {
        return { available: false, reason: "ILLEGAL" };
      }
    }
    if (skill.requiresLOS && !hasLineOfSight(state.grid, actor.x, actor.y, actor.z, pos.x, pos.y, pos.z)) {
      return { available: false, reason: "NO_LOS" };
    }
    const spawnEffect = skill.effects.find((effect) => effect.type === "spawn");
    if (spawnEffect?.type === "spawn") {
      if (!targetPos || !units.has(spawnEffect.unitId)) return { available: false, reason: "NOT_FOUND" };
      const spawnTile = tileAt(state.grid, targetPos.x, targetPos.y);
      const spawnConfig = units.get(spawnEffect.unitId)!;
      if (
        !spawnTile ||
        spawnTile.blockLOS ||
        (spawnTile.pit && !spawnConfig.tags?.includes("flying")) ||
        state.entities.some((entity) => !entity.dead && entity.obstacle && entity.x === targetPos.x && entity.y === targetPos.y)
      ) return { available: false, reason: "ILLEGAL" };
      if (isResurrectionSpawn(spawnEffect, skill.id) && !state.entities.some((entity) =>
        entity.dead && entity.configId === spawnEffect.unitId && entity.x === targetPos.x && entity.y === targetPos.y
      )) return { available: false, reason: "ILLEGAL" };
    }
    if (skill.effects.some((effect) => effect.type === "displace")) {
      if (!target || !targetPos) return { available: false, reason: "NOT_FOUND" };
      const destination = tileAt(state.grid, targetPos.x, targetPos.y);
      if (
        !destination ||
        destination.blockLOS ||
        (destination.pit && !target.flying) ||
        state.entities.some((entity) => entity.id !== target.id && !entity.dead && entity.obstacle && entity.x === targetPos.x && entity.y === targetPos.y)
      ) return { available: false, reason: "ILLEGAL" };
      if (!inRangedReach(actor.x, actor.y, actor.z, targetPos.x, targetPos.y, destination.z, skill.range)) {
        return { available: false, reason: "OUT_OF_RANGE" };
      }
      if (skill.requiresLOS && !hasLineOfSight(state.grid, actor.x, actor.y, actor.z, targetPos.x, targetPos.y, destination.z)) {
        return { available: false, reason: "NO_LOS" };
      }
    }
    if (target && skill.resolution === "will") {
      return {
        available: true,
        targetPos: pos,
        chance: clampChance((skill.willPower ?? 0) - (target.will ?? 0)),
      };
    }
    if (target && target.coverType === 0 && skill.resolution === "attack") {
      const weapon = skillWeapon(skill);
      if (weapon) {
        const breach = edgeBreach(actor, target, weapon);
        if (weapon.category === "melee" && edgeCoverOnLine(actor, target)?.coverType === 2 && !breach) {
          return { available: false, reason: "ILLEGAL" };
        }
        const edgeOptions = breach?.options ?? currentEdgeOptions(actor, target, weapon);
        const combat = previewAttack(
          state.grid,
          state.entities,
          actor,
          target,
          weapon,
          edgeOptions,
        );
        return {
          available: combat.available,
          reason: combat.reason,
          targetPos: pos,
          chance: combat.chance,
          dmgMin: combat.dmgMin,
          dmgMax: combat.dmgMax,
          cover: combat.cover,
          heightMod: combat.heightMod,
          flanked: combat.flanked,
        };
      }
    }
    return { available: true, targetPos: normalizedTargetPos ?? pos };
  };

  const resolveCombatAgainst = (
    actor: EntityState,
    target: EntityState,
    weapon: WeaponStats,
    events: GameEvent[],
    options: AttackOptions = {},
  ): boolean => {
    const resolved = resolveAttack(state.grid, state.entities, actor, target, weapon, rng, options);
    if (!resolved) return false;
    events.push({
      type: "COMBAT_RESOLVED",
      sourceId: actor.id,
      targetId: target.id,
      actionType: resolved.actionType,
      result: resolved.result,
      damageDealt: resolved.damage,
      isFlanked: resolved.flanked,
      heightMod: resolved.heightMod,
    });
    applyDamage(target, resolved.damage, events);
    return resolved.result !== "MISS";
  };

  revealAdjacent([]);
  refresh();

  const kernel: TacticsKernel = {
    version: CORE_VERSION,
    getSnapshot: () => cloneState(state),
    getSnapshotFor: (owner) => {
      const snapshot = cloneState(state);
      const entry = fog[owner];
      if (!entry) return snapshot;
      snapshot.grid.tiles = snapshot.grid.tiles.map((tile) => entry.explored.has(`${tile.x},${tile.y}`)
        ? tile
        : { x: tile.x, y: tile.y, z: 0, pit: false, blockLOS: false });
      snapshot.entities = snapshot.entities.filter((entity) => {
        if (entity.owner === owner) return true;
        if (entity.owner === 0) return entry.explored.has(`${entity.x},${entity.y}`);
        return visibleTo(owner, entity);
      });
      return snapshot;
    },
    getReachable: (actorId) => {
      const actor = actorOf(actorId);
      if (!actor || actor.dead || actor.panic || actor.immobileTurns || actor.owner !== state.activeOwner) return [];
      // §8.3: перемещение допустимо в любые известные стороне клетки
      // (разведанные, включая не наблюдаемые сейчас).
      const explored = fog[actor.owner]?.explored;
      return listReachable(knownGridForPath(actor.owner), knownEntitiesForPath(actor.owner), actor)
        .filter((cell) => !explored || explored.has(`${cell.x},${cell.y}`));
    },
    getPath: (actorId, to) => {
      const actor = actorOf(actorId);
      if (!actor || actor.dead || actor.panic || actor.immobileTurns || actor.owner !== state.activeOwner) return null;
      const explored = fog[actor.owner]?.explored;
      if (explored && !explored.has(`${to.x},${to.y}`)) return null;
      const found = findPath(knownGridForPath(actor.owner), knownEntitiesForPath(actor.owner), actor, to.x, to.y);
      if (!found || found.mpCost + (actor.movementSpent ?? 0) > actor.mobility * 2) return null;
      const ap = apCostFor(found.mpCost, actor.mobility);
      if (ap === null || ap > actor.ap) return null;
      return { path: found.path, mpCost: found.mpCost, apCost: ap };
    },
    getHitPreview: (actorId, targetId, weaponId) => {
      const actor = actorOf(actorId);
      const target = actorOf(targetId);
      if (!actor || !target) return { available: false, reason: "NOT_FOUND" };
      if (actor.decoy || actor.panic) return { available: false, reason: "ILLEGAL" };
      const weapon = weaponOf(actor, weaponId);
      if (!weapon) return { available: false, reason: "ILLEGAL" };
      if (actor.owner !== state.activeOwner) return { available: false, reason: "ILLEGAL" };
      if (!visibleTo(actor.owner, target)) return { available: false };
      if (target.coverType > 0) {
        if ((weapon.envDmg ?? 0) < 1) return { available: false, reason: "ILLEGAL" };
        if (actor.ap < weapon.apCost) return { available: false, reason: "NO_AP" };
        const reason = canWeaponReach(state.grid, actor, target, weapon);
        return reason ? { available: false, reason } : {
          available: true,
          chance: 100,
          dmgMin: 0,
          dmgMax: 0,
          cover: target.coverType,
          heightMod: actor.z > target.z ? 1 : actor.z < target.z ? -1 : 0,
          flanked: false,
          actionType: weapon.category === "melee" ? "MELEE" : "RANGED",
          coverTarget: true,
        };
      }
      const breach = edgeBreach(actor, target, weapon);
      if (weapon.category === "melee" && edgeCoverOnLine(actor, target)?.coverType === 2 && !breach) {
        return { available: false, reason: "ILLEGAL" };
      }
      const edgeOptions = breach?.options ?? currentEdgeOptions(actor, target, weapon);
      return previewAttack(state.grid, state.entities, actor, target, weapon, edgeOptions);
    },
    getSkillPreview: (actorId, skillId, targetId, targetPos) => {
      const actor = actorOf(actorId);
      if (!actor) return { available: false, reason: "NOT_FOUND" };
      const skill = skillOf(actor, skillId);
      if (!skill) return { available: false, reason: "ILLEGAL" };
      const target = targetId === undefined ? undefined : actorOf(targetId);
      if (targetId !== undefined && !target) return { available: false, reason: "NOT_FOUND" };
      if (target && !visibleTo(actor.owner, target)) return { available: false };
      if (targetPos && !(fog[actor.owner]?.visible.has(`${targetPos.x},${targetPos.y}`) ?? true)) return { available: false };
      return skillPreview(actor, skill, target, targetPos);
    },
    getSkillDefinition: (skillId) => skills[skillId],
    getVisibleCells: (owner) => new Set(fog[owner]?.visible ?? []),
    getExploredCells: (owner) => new Set(fog[owner]?.explored ?? []),
    getFog: () => {
      const copy: FogState = {};
      for (const rawOwner of Object.keys(fog)) {
        const owner = Number(rawOwner);
        const entry = fog[owner];
        if (!entry) continue;
        copy[owner] = {
          explored: new Set(entry.explored),
          visible: new Set(entry.visible),
        };
      }
      return copy;
    },
    apply: (command) => {
      if (ended) return { ok: false, reason: "ILLEGAL" };

      if (command.type === "END_TURN") {
        if (command.playerId !== String(state.activeOwner)) return { ok: false, reason: "NOT_YOUR_TURN" };
        const events: GameEvent[] = [];
        const endingOwner = state.activeOwner;
        for (const entity of [...state.entities].sort((a, b) => a.id - b.id)) {
          if (entity.dead || entity.owner !== endingOwner) continue;
          if (entity.ap > 0) {
            const previous = entity.ap;
            entity.ap = 0;
            events.push({ type: "STAT_CHANGED", entityId: entity.id, stat: "AP", newValue: 0, delta: -previous });
          }
          if (entity.immobileTurns) {
            entity.immobileTurns -= 1;
            if (entity.immobileTurns <= 0) {
              entity.immobileTurns = undefined;
              events.push({ type: "STATUS_CHANGED", entityId: entity.id, status: "IMMOBILE", applied: false });
            }
          }
        }

        const upcoming = nextOwner(state, endingOwner);
        state.activeOwner = upcoming;

        // §16.1: poison before every other beginning-of-turn system.
        for (const entity of [...state.entities].filter((candidate) => candidate.owner === upcoming && !candidate.dead).sort((a, b) => a.id - b.id)) {
          if (!entity.poison) continue;
          const poison = entity.poison;
          applyDamage(entity, poison.damagePerTurn, events, "POISON");
          if (entity.dead || !state.entities.some((candidate) => candidate.id === entity.id)) continue;
          poison.turnsLeft -= 1;
          if (poison.turnsLeft <= 0) {
            entity.poison = undefined;
            events.push({ type: "STATUS_CHANGED", entityId: entity.id, status: "POISON", applied: false });
          }
        }

        // §16.2: limited life expires before AP refill.
        for (const entity of [...state.entities].filter((candidate) => candidate.owner === upcoming && !candidate.dead).sort((a, b) => a.id - b.id)) {
          if (entity.timedLife === undefined) continue;
          entity.timedLife -= 1;
          if (entity.timedLife <= 0) {
            events.push({ type: "STATUS_CHANGED", entityId: entity.id, status: "TIMED", applied: false });
            removeEntity(entity, "EXPIRED", events);
          }
        }

        // Cooldowns tick once at the beginning of the owning side's turn.
        for (const entity of state.entities.filter((candidate) => candidate.owner === upcoming && !candidate.dead)) {
          if (!entity.skillCooldowns) continue;
          for (const [skillId, value] of Object.entries(entity.skillCooldowns)) {
            if (value <= 0) continue;
            const cooldown = Math.max(0, value - 1);
            entity.skillCooldowns[skillId] = cooldown;
            const skill = skills[skillId];
            const uses = entity.skillUses?.[skillId] ?? 0;
            events.push({
              type: "SKILL_RESOURCE_CHANGED",
              entityId: entity.id,
              skillId,
              cooldown,
              uses,
              usesLeft: skill?.maxUsesPerBattle === undefined ? undefined : Math.max(0, skill.maxUsesPerBattle - uses),
            });
          }
        }

        // §16.3–4: clear defensive orders and refill AP.
        for (const entity of state.entities) {
          if (entity.owner !== upcoming) continue;
          if (entity.overwatch) {
            entity.overwatch = false;
            events.push({ type: "STATUS_CHANGED", entityId: entity.id, status: "OVERWATCH", applied: false });
          }
          if (entity.defending) {
            entity.defending = false;
            events.push({ type: "STATUS_CHANGED", entityId: entity.id, status: "DEFENDING", applied: false });
          }
          entity.movementSpent = 0;
          if (entity.dead || entity.maxAp <= 0) continue;
          const delta = entity.maxAp - entity.ap;
          entity.ap = entity.maxAp;
          if (delta !== 0) events.push({ type: "STAT_CHANGED", entityId: entity.id, stat: "AP", newValue: entity.ap, delta });
        }

        // §16.5: panic performs its forced one-AP flight after refill.
        for (const entity of [...state.entities].filter((candidate) => candidate.owner === upcoming && candidate.panic).sort((a, b) => a.id - b.id)) {
          processPanic(entity, events);
        }

        state.turnNumber += 1;
        revealAdjacent(events);
        events.push({ type: "TURN_CHANGED", activePlayerId: String(upcoming), turnNumber: state.turnNumber });
        appendOutcome(events);
        emit();
        return { ok: true, events };
      }

      const actor = actorOf(command.actorId);
      if (!actor) return { ok: false, reason: "NOT_FOUND" };
      if (actor.dead || actor.panic) return { ok: false, reason: "ILLEGAL" };
      if (actor.owner !== state.activeOwner) return { ok: false, reason: "NOT_YOUR_TURN" };

      if (command.type === "OVERWATCH") {
        if (actor.ap <= 0) return { ok: false, reason: "NO_AP" };
        if (!weaponOf(actor)) return { ok: false, reason: "ILLEGAL" };
        const previous = actor.ap;
        actor.ap = 0;
        actor.overwatch = true;
        const events: GameEvent[] = [
          { type: "STAT_CHANGED", entityId: actor.id, stat: "AP", newValue: 0, delta: -previous },
          { type: "STATUS_CHANGED", entityId: actor.id, status: "OVERWATCH", applied: true },
        ];
        emit();
        return { ok: true, events };
      }

      if (command.type === "DEFEND") {
        if (actor.ap <= 0) return { ok: false, reason: "NO_AP" };
        const previous = actor.ap;
        actor.ap = 0;
        actor.defending = true;
        const events: GameEvent[] = [
          { type: "STAT_CHANGED", entityId: actor.id, stat: "AP", newValue: 0, delta: -previous },
          { type: "STATUS_CHANGED", entityId: actor.id, status: "DEFENDING", applied: true },
        ];
        emit();
        return { ok: true, events };
      }

      if (command.type === "ATTACK") {
        if (actor.decoy) return { ok: false, reason: "ILLEGAL" };
        const target = actorOf(command.targetId);
        if (!target) return { ok: false, reason: "NOT_FOUND" };
        if (target.dead || !visibleTo(actor.owner, target)) return { ok: false, reason: "ILLEGAL" };
        const weapon = weaponOf(actor, command.weaponId);
        if (!weapon) return { ok: false, reason: "ILLEGAL" };
        const events: GameEvent[] = [];

        if (target.coverType > 0) {
          if ((weapon.envDmg ?? 0) < 1) return { ok: false, reason: "ILLEGAL" };
          if (actor.ap < weapon.apCost) return { ok: false, reason: "NO_AP" };
          const reason = canWeaponReach(state.grid, actor, target, weapon);
          if (reason) return { ok: false, reason };
          reveal(actor, events);
          spendAction(actor, weapon.apCost, weapon.endsTurn, events);
          damageCover(target, events);
          appendOutcome(events);
          emit();
          return { ok: true, events };
        }

        const breach = edgeBreach(actor, target, weapon);
        if (weapon.category === "melee" && edgeCoverOnLine(actor, target)?.coverType === 2 && !breach) {
          return { ok: false, reason: "ILLEGAL" };
        }
        const edgeOptions = breach?.options ?? currentEdgeOptions(actor, target, weapon);
        const preview = previewAttack(state.grid, state.entities, actor, target, weapon, edgeOptions);
        if (!preview.available) return { ok: false, reason: preview.reason ?? "ILLEGAL" };
        reveal(actor, events);
        if (breach) damageCover(breach.cover, events);
        const hit = resolveCombatAgainst(actor, target, weapon, events, edgeOptions);
        spendAction(actor, weapon.apCost, weapon.endsTurn, events);
        if (!breach && (weapon.envDmg ?? 0) >= 1 && hit) {
          const cover = coverOnFireLine(actor, target);
          if (cover) damageCover(cover, events);
        }
        appendOutcome(events);
        emit();
        return { ok: true, events };
      }

      if (command.type === "USE_SKILL") {
        const skill = skillOf(actor, command.skillId);
        if (!skill || (actor.decoy && skill.resolution === "attack")) return { ok: false, reason: "ILLEGAL" };
        const target = command.targetId === undefined ? undefined : actorOf(command.targetId);
        if (command.targetId !== undefined && (!target || !visibleTo(actor.owner, target))) return { ok: false, reason: target ? "ILLEGAL" : "NOT_FOUND" };
        if (command.targetPos && !(fog[actor.owner]?.visible.has(`${command.targetPos.x},${command.targetPos.y}`) ?? true)) return { ok: false, reason: "ILLEGAL" };
        const preview = skillPreview(actor, skill, target, command.targetPos);
        if (!preview.available) return { ok: false, reason: preview.reason ?? "ILLEGAL" };
        const events: GameEvent[] = [];
        reveal(actor, events);
        let success = false;
        const weapon = skillWeapon(skill);

        // §6 math: извлечение — умение с признаком extract; юнит покидает поле
        // из клетки зоны эвакуации. Событие ENTITY_REMOVED (EXTRACTED).
        // Исход миссии: спасение — эвакуация указанного лица, разведка —
        // эвакуация бойца высадки (base-design §3.2).
        if (skill.extract) {
          const tile = tileAt(state.grid, actor.x, actor.y);
          if (!tile?.extract) return { ok: false, reason: "ILLEGAL" };
          // Эвакуация бойца высадки фиксируется в состоянии: при учёте исходов
          // миссии эвакуированный считается выжившим с запасом здоровья на
          // момент ухода (разведка; base-design §3.2).
          if (actor.rosterIndex !== undefined) {
            state.extracted = [...(state.extracted ?? []), { rosterIndex: actor.rosterIndex, hp: actor.hp }];
          }
          removeEntity(actor, "EXTRACTED", events);
          success = true;
          const objective = state.objective;
          if (objective?.kind === "recon" && actor.owner === PLAYER_OWNER && actor.countsForElimination !== false) {
            objectiveVictory = true;
          }
          if (objective?.kind === "rescue" && actor.configId === objective.unitId) {
            objectiveVictory = true;
          }
        } else if (skill.detectsHidden && preview.targetPos) {
          const radius = skill.radius ?? 0;
          for (const hidden of state.entities
            .filter((entity) => entity.hidden && !entity.dead && distH(preview.targetPos!.x, preview.targetPos!.y, entity.x, entity.y) <= radius)
            .sort((a, b) => a.id - b.id)) {
            reveal(hidden, events);
            success = true;
          }
        }

        if (skill.resolution === "will" && target) {
          const chance = clampChance((skill.willPower ?? 0) - (target.will ?? 0));
          success = rng.nextInt(1, 100) <= chance;
          if (success) applySkillEffects(actor, skill, target, command.targetPos, events);
        } else if (skill.resolution === "attack" && skill.category === "self" && (skill.radius ?? 0) > 0 && weapon) {
          // §9.5/§12.1: правила граневых укрытий действуют и для атак по области —
          // полная грань запрещает обычную ближнюю атаку, неполная сохраняет свой
          // вычет, разрушающее оружие ближнего боя пробивает грань, как при одиночном ударе.
          for (const areaTarget of areaTargets(actor, skill, cellPos(actor))) {
            const breach = edgeBreach(actor, areaTarget, weapon);
            if (weapon.category === "melee" && edgeCoverOnLine(actor, areaTarget)?.coverType === 2 && !breach) continue;
            const edgeOptions = breach?.options ?? currentEdgeOptions(actor, areaTarget, weapon);
            if (breach) damageCover(breach.cover, events);
            const hit = resolveCombatAgainst(actor, areaTarget, weapon, events, {
              ...(edgeOptions ?? {}),
              allowFriendly: skill.filter === "all" || skill.filter === "allies",
            });
            if (!hit) continue;
            success = true;
            applySkillEffects(actor, skill, areaTarget, command.targetPos, events, Boolean(breach));
            if (!areaTarget.dead && skill.effects.some((effect) => effect.type === "knockback")) displace(actor, areaTarget, events);
          }
        } else if (skill.resolution === "attack" && target?.coverType && skill.effects.some((effect) => effect.type === "destroyCover") && skill.envDmg >= 1) {
          success = applySkillEffects(actor, skill, target, command.targetPos, events);
        } else if (skill.resolution === "attack" && target && weapon) {
          // §12.1: разрушающее умение ближнего боя пробивает полную грань, как палица.
          const breach = edgeBreach(actor, target, weapon);
          const edgeOptions = breach?.options ?? currentEdgeOptions(actor, target, weapon);
          if (breach) damageCover(breach.cover, events);
          success = resolveCombatAgainst(actor, target, weapon, events, edgeOptions);
          if (success) {
            applySkillEffects(actor, skill, target, command.targetPos, events, Boolean(breach));
            if (!target.dead && skill.effects.some((effect) => effect.type === "knockback")) displace(actor, target, events);
          }
        } else if (skill.resolution === "auto") {
          if (skill.category === "self" && (skill.radius ?? 0) > 0) {
            for (const areaTarget of areaTargets(actor, skill, cellPos(actor))) {
              success = applySkillEffects(actor, skill, areaTarget, command.targetPos, events) || success;
            }
          } else {
            success = applySkillEffects(actor, skill, target, command.targetPos, events) || success;
          }
        }
        events.unshift({
          type: "SKILL_RESOLVED",
          sourceId: actor.id,
          skillId: skill.id,
          targetId: target?.id,
          targetPos: preview.targetPos,
          success,
        });
        actor.skillUses ??= {};
        actor.skillCooldowns ??= {};
        actor.skillUses[skill.id] = (actor.skillUses[skill.id] ?? 0) + 1;
        actor.skillCooldowns[skill.id] = skill.cooldownTurns ?? 0;
        events.push({
          type: "SKILL_RESOURCE_CHANGED",
          entityId: actor.id,
          skillId: skill.id,
          cooldown: actor.skillCooldowns[skill.id] ?? 0,
          uses: actor.skillUses[skill.id] ?? 0,
          usesLeft: skill.maxUsesPerBattle === undefined
            ? undefined
            : Math.max(0, skill.maxUsesPerBattle - (actor.skillUses[skill.id] ?? 0)),
        });
        spendAction(actor, skill.apCost, skill.endsTurn, events);
        appendOutcome(events);
        emit();
        return { ok: true, events };
      }

      if (command.type !== "MOVE") return { ok: false, reason: "ILLEGAL" };
      if (actor.immobileTurns) return { ok: false, reason: "ILLEGAL" };
      // §8.3: назначение должно быть известно стороне (разведано).
      const explored = fog[actor.owner]?.explored;
      if (explored && !explored.has(`${command.to.x},${command.to.y}`)) return { ok: false, reason: "ILLEGAL" };
      const tile = tileAt(state.grid, command.to.x, command.to.y);
      if (!tile) return { ok: false, reason: "NOT_FOUND" };
      const knownPath = findPath(knownGridForPath(actor.owner), knownEntitiesForPath(actor.owner), actor, command.to.x, command.to.y);
      const found = findPath(state.grid, state.entities, actor, command.to.x, command.to.y);
      if (!knownPath || !found || found.mpCost <= 0) return { ok: false, reason: "OCCUPIED" };
      if (!samePath(knownPath.path, found.path)) {
        // Расхождение допустимо только за счёт скрытых сущностей: реальный путь
        // обязан оставаться в пределах разведанной местности.
        if (explored && found.path.some((cell) => !explored.has(`${cell.x},${cell.y}`))) {
          return { ok: false, reason: "ILLEGAL" };
        }
      }
      if (found.mpCost + (actor.movementSpent ?? 0) > actor.mobility * 2) return { ok: false, reason: "OUT_OF_RANGE" };
      const ap = apCostFor(found.mpCost, actor.mobility);
      if (ap === null) return { ok: false, reason: "OUT_OF_RANGE" };
      if (actor.ap < ap) return { ok: false, reason: "NO_AP" };

      const events: GameEvent[] = [];
      const previousAp = actor.ap;
      actor.ap -= ap;
      events.push({ type: "STAT_CHANGED", entityId: actor.id, stat: "AP", newValue: actor.ap, delta: actor.ap - previousAp });
      let traversedMp = 0;
      for (let index = 1; index < found.path.length; index += 1) {
        const previous = found.path[index - 1]!;
        const destination = found.path[index]!;
        traversedMp += edgeCost(state.grid, state.entities, actor, previous.x, previous.y, destination.x, destination.y);
        actor.x = destination.x;
        actor.y = destination.y;
        actor.z = destination.z;
        actor.dir = facingAfterStep(previous.x, previous.y, destination.x, destination.y, actor.dir);
        events.push({
          type: "ENTITY_MOVED",
          entityId: actor.id,
          path: [previous, destination],
          isDash: ap === 2,
          apSpent: index === 1 ? ap : 0,
        });
        refresh();
        revealAdjacent(events);
        if (triggerOverwatch(actor, events)) break;
      }
      updateAppleCarrier(actor, events);
      actor.movementSpent = (actor.movementSpent ?? 0) + traversedMp;
      appendOutcome(events);
      emit();
      return { ok: true, events };
    },
    debugAutoWin: () => {
      if (ended) return { ok: false, reason: "ILLEGAL" };
      const events: GameEvent[] = [];
      for (const entity of state.entities) {
        if (entity.owner === ENEMY_OWNER && entity.coverType === 0 && !entity.dead) {
          kill(entity, "DAMAGE", events);
        }
      }
      // Цели миссий 0.13.0: автопобеда доводит до победы любой тип миссии
      // (debug-mode §3.2: «мгновенно уничтожает всех живых противников
      // и фиксирует победу стороны игрока»).
      const objective = state.objective;
      if (objective?.kind === "destroy") {
        const idol = state.entities.find((entity) => !entity.dead && entity.configId === objective.unitId);
        if (idol) kill(idol, "DAMAGE", events);
      } else if (objective?.kind === "rescue") {
        const escortee = state.entities.find((entity) => !entity.dead && entity.configId === objective.unitId);
        if (escortee) {
          removeEntity(escortee, "EXTRACTED", events);
          objectiveVictory = true;
        }
      } else if (objective?.kind === "recon") {
        const scout = state.entities.find((entity) =>
          !entity.dead && entity.owner === PLAYER_OWNER && entity.coverType === 0 && entity.rosterIndex !== undefined,
        );
        if (scout) {
          if (scout.rosterIndex !== undefined) {
            state.extracted = [...(state.extracted ?? []), { rosterIndex: scout.rosterIndex, hp: scout.hp }];
          }
          removeEntity(scout, "EXTRACTED", events);
          objectiveVictory = true;
        }
      }
      // Победа фиксируется обычным механизмом исхода; Тьма/награды/уровни
      // применяются как при любой другой победе.
      appendOutcome(events);
      emit();
      return { ok: true, events };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return kernel;
}
