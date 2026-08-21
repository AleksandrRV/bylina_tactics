import { previewAttack, resolveAttack, type AttackOptions, type HitPreview } from "./combat.js";
import { isCoverCandidate, isCoverOnFireLine } from "./cover.js";
import { createDebugMatch, ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { computeVisibleCells, createFogState, refreshFog, type FogState } from "./fog.js";
import { distH, facingAfterStep, tileAt } from "./grid.js";
import { effectiveCoverTier, hasLineOfSight } from "./los.js";
import { edgeCost, edgeCoverBetween } from "./occupancy.js";
import { apCostFor, findPath, listReachable } from "./pathfinding.js";
import { inMeleeReach, inRangedReach } from "./range.js";
import { createMulberry32, type Rng } from "./rng.js";
import type { SkillPreview, SkillStats } from "./skills.js";
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

export const CORE_VERSION = "0.8.0";

export interface KernelOptions {
  initial?: MatchState;
  weapons?: Record<string, WeaponStats>;
  skills?: Record<string, SkillStats>;
  seed?: number;
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
  getVisibleCells(owner: number): Set<string>;
  getExploredCells(owner: number): Set<string>;
  apply(command: Command): ApplyResult;
  subscribe(listener: () => void): () => void;
}

function cloneState(state: MatchState): MatchState {
  return {
    turnNumber: state.turnNumber,
    activeOwner: state.activeOwner,
    grid: {
      width: state.grid.width,
      height: state.grid.height,
      tiles: state.grid.tiles.map((tile) => ({ ...tile })),
    },
    entities: state.entities.map((entity) => ({
      ...entity,
      weaponIds: entity.weaponIds ? [...entity.weaponIds] : undefined,
      skillIds: entity.skillIds ? [...entity.skillIds] : undefined,
    })),
    rngSeed: state.rngSeed,
    rngState: state.rngState,
  };
}

function nextOwner(state: MatchState, current: number): number {
  const living = new Set(
    state.entities.filter((entity) => !entity.dead && entity.coverType === 0 && entity.maxAp > 0).map((entity) => entity.owner),
  );
  const order = [PLAYER_OWNER, ENEMY_OWNER].filter((owner) => living.has(owner));
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
  const seed = options.seed ?? Number(state.rngState ?? state.rngSeed ?? 0x51a7);
  const rng: Rng = createMulberry32(seed);
  state.rngSeed ??= String((options.seed ?? seed) >>> 0);
  state.rngState = String(rng.getState());
  const listeners = new Set<() => void>();
  const owners = [...new Set(state.entities.filter((entity) => entity.owner > 0).map((entity) => entity.owner))];
  const fog: FogState = createFogState(state, owners);
  let ended = false;
  const eliminationEnabled = [PLAYER_OWNER, ENEMY_OWNER].every((owner) =>
    state.entities.some((entity) => !entity.dead && entity.owner === owner && entity.coverType === 0)
  );

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
    events.push({ type: "ENTITY_DIED", entityId: entity.id, causeOfDeath });
  };

  const applyDamage = (target: EntityState, damage: number, events: GameEvent[], cause: "DAMAGE" | "POISON" = "DAMAGE"): void => {
    if (damage <= 0 || target.dead) return;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    events.push({ type: "STAT_CHANGED", entityId: target.id, stat: "HP", newValue: target.hp, delta: target.hp - before });
    if (target.hp <= 0) kill(target, cause, events);
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
    const players = state.entities.some((entity) => !entity.dead && entity.owner === PLAYER_OWNER && entity.coverType === 0);
    const enemies = state.entities.some((entity) => !entity.dead && entity.owner === ENEMY_OWNER && entity.coverType === 0);
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
      events.push({ type: "OVERWATCH_FIRED", watcherId: observer.id, triggerId: mover.id, at: cellPos(mover) });
      const resolved = resolveAttack(state.grid, state.entities, observer, mover, weapon, rng, { ignoreAp: true });
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
  };

  const skillPreview = (actor: EntityState, skill: SkillStats, target?: EntityState, targetPos?: CellPos): SkillPreview => {
    if (actor.dead || actor.owner !== state.activeOwner || actor.decoy) return { available: false, reason: "ILLEGAL" };
    if (actor.ap < skill.apCost) return { available: false, reason: "NO_AP" };
    if (skill.category === "self") return { available: true, targetPos: cellPos(actor) };
    if (!target && !targetPos) return { available: false, reason: "NOT_FOUND" };
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
    const pos = target ? cellPos(target) : targetPos!;
    const inReach = skill.category === "melee"
      ? inMeleeReach(actor.x, actor.y, actor.z, pos.x, pos.y, pos.z)
      : inRangedReach(actor.x, actor.y, actor.z, pos.x, pos.y, pos.z, skill.range);
    if (!inReach) return { available: false, reason: "OUT_OF_RANGE" };
    if (target && skill.category === "melee" && edgeCoverOnLine(actor, target)?.coverType === 2) {
      return { available: false, reason: "ILLEGAL" };
    }
    if (skill.requiresLOS && !hasLineOfSight(state.grid, actor.x, actor.y, actor.z, pos.x, pos.y, pos.z)) {
      return { available: false, reason: "NO_LOS" };
    }
    if (target && target.coverType === 0 && skill.resolution === "attack") {
      const weapon = skillWeapon(skill);
      if (weapon) {
        const combat = previewAttack(
          state.grid,
          state.entities,
          actor,
          target,
          weapon,
          currentEdgeOptions(actor, target, weapon),
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
    return { available: true, targetPos: pos };
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
      if (!actor || actor.dead || actor.owner !== state.activeOwner) return [];
      const visible = fog[actor.owner]?.visible;
      return listReachable(knownGridForPath(actor.owner), knownEntitiesForPath(actor.owner), actor)
        .filter((cell) => !visible || visible.has(`${cell.x},${cell.y}`));
    },
    getPath: (actorId, to) => {
      const actor = actorOf(actorId);
      if (!actor || actor.dead || actor.owner !== state.activeOwner) return null;
      const visible = fog[actor.owner]?.visible;
      if (visible && !visible.has(`${to.x},${to.y}`)) return null;
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
      return skillPreview(actor, skill, target, targetPos);
    },
    getVisibleCells: (owner) => new Set(fog[owner]?.visible ?? []),
    getExploredCells: (owner) => new Set(fog[owner]?.explored ?? []),
    apply: (command) => {
      if (ended) return { ok: false, reason: "ILLEGAL" };

      if (command.type === "END_TURN") {
        if (command.playerId !== String(state.activeOwner)) return { ok: false, reason: "NOT_YOUR_TURN" };
        const events: GameEvent[] = [];
        for (const entity of state.entities) {
          if (entity.dead || entity.owner !== state.activeOwner || entity.ap <= 0) continue;
          const previous = entity.ap;
          entity.ap = 0;
          events.push({ type: "STAT_CHANGED", entityId: entity.id, stat: "AP", newValue: 0, delta: -previous });
        }
        const upcoming = nextOwner(state, state.activeOwner);
        state.activeOwner = upcoming;
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
        }
        for (const entity of state.entities) {
          if (entity.dead || entity.owner !== upcoming || entity.maxAp <= 0) continue;
          const delta = entity.maxAp - entity.ap;
          entity.ap = entity.maxAp;
          if (delta !== 0) events.push({ type: "STAT_CHANGED", entityId: entity.id, stat: "AP", newValue: entity.ap, delta });
        }
        state.turnNumber += 1;
        revealAdjacent(events);
        events.push({ type: "TURN_CHANGED", activePlayerId: String(upcoming), turnNumber: state.turnNumber });
        emit();
        return { ok: true, events };
      }

      const actor = actorOf(command.actorId);
      if (!actor) return { ok: false, reason: "NOT_FOUND" };
      if (actor.dead || actor.decoy) return { ok: false, reason: "ILLEGAL" };
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
        if (!skill) return { ok: false, reason: "ILLEGAL" };
        const target = command.targetId === undefined ? undefined : actorOf(command.targetId);
        if (command.targetId !== undefined && (!target || !visibleTo(actor.owner, target))) return { ok: false, reason: target ? "ILLEGAL" : "NOT_FOUND" };
        const preview = skillPreview(actor, skill, target, command.targetPos);
        if (!preview.available) return { ok: false, reason: preview.reason ?? "ILLEGAL" };
        const events: GameEvent[] = [];
        reveal(actor, events);
        let success = false;
        const weapon = skillWeapon(skill);

        if (skill.detectsHidden && preview.targetPos) {
          const radius = skill.radius ?? 0;
          for (const hidden of state.entities
            .filter((entity) => entity.hidden && !entity.dead && distH(preview.targetPos!.x, preview.targetPos!.y, entity.x, entity.y) <= radius)
            .sort((a, b) => a.id - b.id)) {
            reveal(hidden, events);
            success = true;
          }
        } else if (skill.category === "self" && (skill.radius ?? 0) > 0 && weapon) {
          const targets = state.entities
            .filter((entity) => !entity.dead && entity.coverType === 0 && entity.owner !== actor.owner && entity.owner > 0 &&
              distH(actor.x, actor.y, entity.x, entity.y) <= (skill.radius ?? 0) && Math.abs(actor.z - entity.z) <= 1)
            .sort((a, b) => a.id - b.id);
          for (const areaTarget of targets) success = resolveCombatAgainst(actor, areaTarget, weapon, events) || success;
        } else if (target?.coverType && skill.effects.some((effect) => effect.type === "destroyCover") && skill.envDmg >= 1) {
          damageCover(target, events);
          success = true;
        } else if (target && weapon) {
          success = resolveCombatAgainst(actor, target, weapon, events, currentEdgeOptions(actor, target, weapon));
          if (success && skill.affectsEnvironment && skill.envDmg >= 1) {
            const cover = coverOnFireLine(actor, target);
            if (cover) damageCover(cover, events);
          }
          if (success && !target.dead && skill.effects.some((effect) => effect.type === "knockback")) displace(actor, target, events);
        } else if (skill.resolution === "auto") {
          const effectTarget = target ?? actor;
          for (const effect of skill.effects) {
            if (effect.type === "applyStatus" && effect.status === "flying") {
              effectTarget.flying = true;
              events.push({ type: "STATUS_CHANGED", entityId: effectTarget.id, status: "FLYING", applied: true });
              success = true;
            } else if (effect.type === "removeStatus" && effect.status === "flying") {
              effectTarget.flying = false;
              events.push({ type: "STATUS_CHANGED", entityId: effectTarget.id, status: "FLYING", applied: false });
              success = true;
              if (tileAt(state.grid, effectTarget.x, effectTarget.y)?.pit) {
                const previousHp = effectTarget.hp;
                effectTarget.hp = 0;
                events.push({ type: "STAT_CHANGED", entityId: effectTarget.id, stat: "HP", newValue: 0, delta: -previousHp });
                kill(effectTarget, "FALL_INTO_PIT", events);
              }
            } else if (effect.type === "reveal") {
              reveal(effectTarget, events);
              success = true;
            }
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
        spendAction(actor, skill.apCost, skill.endsTurn, events);
        appendOutcome(events);
        emit();
        return { ok: true, events };
      }

      if (command.type !== "MOVE") return { ok: false, reason: "ILLEGAL" };
      const visible = fog[actor.owner]?.visible;
      if (visible && !visible.has(`${command.to.x},${command.to.y}`)) return { ok: false, reason: "ILLEGAL" };
      const tile = tileAt(state.grid, command.to.x, command.to.y);
      if (!tile) return { ok: false, reason: "NOT_FOUND" };
      const knownPath = findPath(knownGridForPath(actor.owner), knownEntitiesForPath(actor.owner), actor, command.to.x, command.to.y);
      const found = findPath(state.grid, state.entities, actor, command.to.x, command.to.y);
      if (!knownPath || !found || found.mpCost <= 0) return { ok: false, reason: "OCCUPIED" };
      if (!samePath(knownPath.path, found.path)) return { ok: false, reason: "ILLEGAL" };
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
      actor.movementSpent = (actor.movementSpent ?? 0) + traversedMp;
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
