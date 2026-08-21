import { previewAttack, resolveAttack, type HitPreview } from "./combat.js";
import { createDebugMatch, ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { computeVisibleCells, createFogState, refreshFog, type FogState } from "./fog.js";
import { facingAfterStep, tileAt } from "./grid.js";
import { hasLineOfSight } from "./los.js";
import { apCostFor, findPath, listReachable } from "./pathfinding.js";
import { effectiveRange, inMeleeReach, inRangedReach } from "./range.js";
import { createMulberry32, type Rng } from "./rng.js";
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

export const CORE_VERSION = "0.7.0";

export interface KernelOptions {
  initial?: MatchState;
  weapons?: Record<string, WeaponStats>;
  seed?: number;
}

export interface TacticsKernel {
  readonly version: string;
  getSnapshot(): MatchState;
  getReachable(actorId: number): ReachableCell[];
  getPath(actorId: number, to: CellPos): { path: CellPos[]; mpCost: number; apCost: 1 | 2 } | null;
  getHitPreview(actorId: number, targetId: number, weaponId?: string): HitPreview;
  /** Клетки, наблюдаемые стороной прямо сейчас (ключи «x,y»). */
  getVisibleCells(owner: number): Set<string>;
  /** Клетки, которые сторона когда-либо наблюдала (ключи «x,y»). */
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
    entities: state.entities.map((entity) => ({ ...entity })),
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

/**
 * §14. Вектор ориентации (dir: 0=север, 1=восток, 2=юг, 3=запад).
 * Скалярное произведение с вектором к клетке C ≥ 0 — передняя полуплоскость.
 */
function inFrontHalfPlane(observer: EntityState, cx: number, cy: number): boolean {
  const dx = cx - observer.x;
  const dy = cy - observer.y;
  if (dx === 0 && dy === 0) return true;
  // dir 0 = (0, -1), 1 = (1, 0), 2 = (0, 1), 3 = (-1, 0)
  const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const [fx, fy] = dirs[observer.dir] ?? [0, -1];
  return fx * dx + fy * dy >= 0;
}

/** Проверка: может ли наблюдатель атаковать цель в клетке (cx, cy) дозорным оружием. */
function canOverwatchHit(
  grid: MatchState["grid"],
  observer: EntityState,
  cx: number,
  cy: number,
  cz: number,
  weapon: WeaponStats,
): boolean {
  const melee = weapon.category === "melee";
  const inReach = melee
    ? inMeleeReach(observer.x, observer.y, observer.z, cx, cy, cz)
    : inRangedReach(observer.x, observer.y, observer.z, cx, cy, cz, effectiveRange(observer.z, cz, weapon.range));
  if (!inReach) return false;
  if (weapon.requiresLOS && !hasLineOfSight(grid, observer.x, observer.y, observer.z, cx, cy, cz)) return false;
  return true;
}

export function createTacticsKernel(options: KernelOptions = {}): TacticsKernel {
  let state = options.initial ?? createDebugMatch();
  const weapons = { ...defaultWeapons(), ...options.weapons };
  const rng: Rng = createMulberry32(options.seed ?? 0x51a7);
  const listeners = new Set<() => void>();

  const fog: FogState = createFogState(state, [PLAYER_OWNER, ENEMY_OWNER]);

  const emit = (): void => {
    refreshFog(fog, state, [PLAYER_OWNER, ENEMY_OWNER]);
    for (const listener of listeners) listener();
  };

  const actorOf = (id: number): EntityState | undefined => state.entities.find((entity) => entity.id === id);

  const weaponOf = (entity: EntityState, weaponId?: string): WeaponStats | undefined => {
    return weapons[weaponId || entity.weaponId];
  };

  /**
   * §14. Проверка дозора при входе в клетку. Ответные действия наблюдателей
   * противника, упорядоченных по возрастанию ID.
   */
  const triggerOverwatch = (mover: EntityState, cell: CellPos, events: GameEvent[]): boolean => {
    const observers = state.entities
      .filter((e) => e.overwatch && !e.dead && e.owner !== mover.owner && e.coverType === 0)
      .sort((a, b) => a.id - b.id);
    for (const observer of observers) {
      if (mover.dead) break;
      if (observer.dead) continue;
      if (!inFrontHalfPlane(observer, cell.x, cell.y)) continue;
      const weapon = weaponOf(observer);
      if (!weapon) continue;
      if (!canOverwatchHit(state.grid, observer, cell.x, cell.y, cell.z, weapon)) continue;

      const resolved = resolveAttack(state.grid, state.entities, observer, mover, weapon, rng);
      if (!resolved) continue;

      observer.overwatch = false;
      events.push({ type: "OVERWATCH_CLEARED", entityId: observer.id });
      events.push({
        type: "COMBAT_RESOLVED",
        sourceId: observer.id,
        targetId: mover.id,
        actionType: resolved.actionType,
        result: resolved.result,
        damageDealt: resolved.damage,
        isFlanked: resolved.flanked,
        heightMod: resolved.heightMod,
        overwatch: true,
      });
      if (resolved.damage > 0) {
        mover.hp -= resolved.damage;
        events.push({
          type: "STAT_CHANGED",
          entityId: mover.id,
          stat: "HP",
          newValue: mover.hp,
          delta: -resolved.damage,
        });
      }
      if (mover.hp <= 0 && !mover.dead) {
        mover.dead = true;
        mover.obstacle = false;
        mover.ap = 0;
        mover.overwatch = false;
        mover.defending = false;
        events.push({ type: "ENTITY_DIED", entityId: mover.id, causeOfDeath: "DAMAGE" });
        return true; // гибель прерывает маршрут
      }
    }
    return false;
  };

  const kernel: TacticsKernel = {
    version: CORE_VERSION,
    getSnapshot: () => cloneState(state),
    getReachable: (actorId) => {
      const actor = actorOf(actorId);
      if (!actor || actor.dead || actor.owner !== state.activeOwner) return [];
      return listReachable(state.grid, state.entities, actor);
    },
    getPath: (actorId, to) => {
      const actor = actorOf(actorId);
      if (!actor || actor.dead) return null;
      const found = findPath(state.grid, state.entities, actor, to.x, to.y);
      if (!found) return null;
      const ap = apCostFor(found.mpCost, actor.mobility);
      if (ap === null) return null;
      return { path: found.path, mpCost: found.mpCost, apCost: ap };
    },
    getHitPreview: (actorId, targetId, weaponId) => {
      const actor = actorOf(actorId);
      const target = actorOf(targetId);
      if (!actor || !target) return { available: false, reason: "NOT_FOUND" };
      const weapon = weaponOf(actor, weaponId);
      if (!weapon) return { available: false, reason: "NOT_FOUND" };
      if (actor.owner !== state.activeOwner) return { available: false, reason: "ILLEGAL" };
      return previewAttack(state.grid, state.entities, actor, target, weapon);
    },
    getVisibleCells: (owner) => {
      const entry = fog[owner];
      return entry ? new Set(entry.visible) : new Set();
    },
    getExploredCells: (owner) => {
      const entry = fog[owner];
      return entry ? new Set(entry.explored) : new Set();
    },
    apply: (command) => {
      // ---------- END_TURN (§16) ----------
      if (command.type === "END_TURN") {
        const events: GameEvent[] = [];
        const upcoming = nextOwner(state, state.activeOwner);
        state.activeOwner = upcoming;

        // §16.3: снять дозор юнитов стороны, если не был произведён ответ.
        // §16: снять защитную стойку.
        for (const entity of state.entities) {
          if (entity.owner !== upcoming) continue;
          if (entity.overwatch) {
            entity.overwatch = false;
            events.push({ type: "OVERWATCH_CLEARED", entityId: entity.id });
          }
          if (entity.defending) {
            entity.defending = false;
            events.push({ type: "DEFEND_CLEARED", entityId: entity.id });
          }
        }

        // §16.4: восстановить ОД.
        for (const entity of state.entities) {
          if (entity.dead || entity.owner !== upcoming || entity.maxAp <= 0) continue;
          if (entity.ap !== entity.maxAp) {
            const delta = entity.maxAp - entity.ap;
            entity.ap = entity.maxAp;
            events.push({
              type: "STAT_CHANGED",
              entityId: entity.id,
              stat: "AP",
              newValue: entity.ap,
              delta,
            });
          } else {
            entity.ap = entity.maxAp;
          }
        }
        state.turnNumber += 1;
        events.push({
          type: "TURN_CHANGED",
          activePlayerId: String(state.activeOwner),
          turnNumber: state.turnNumber,
        });
        emit();
        return { ok: true, events };
      }

      // ---------- OVERWATCH (§14) ----------
      if (command.type === "OVERWATCH") {
        const actor = actorOf(command.actorId);
        if (!actor) return { ok: false, reason: "NOT_FOUND" };
        if (actor.dead) return { ok: false, reason: "ILLEGAL" };
        if (actor.owner !== state.activeOwner) return { ok: false, reason: "NOT_YOUR_TURN" };
        if (actor.ap <= 0) return { ok: false, reason: "NO_AP" };
        actor.overwatch = true;
        actor.ap = 0;
        const events: GameEvent[] = [
          { type: "STAT_CHANGED", entityId: actor.id, stat: "AP", newValue: 0, delta: -actor.maxAp },
          { type: "OVERWATCH_SET", entityId: actor.id },
        ];
        emit();
        return { ok: true, events };
      }

      // ---------- DEFEND ----------
      if (command.type === "DEFEND") {
        const actor = actorOf(command.actorId);
        if (!actor) return { ok: false, reason: "NOT_FOUND" };
        if (actor.dead) return { ok: false, reason: "ILLEGAL" };
        if (actor.owner !== state.activeOwner) return { ok: false, reason: "NOT_YOUR_TURN" };
        actor.defending = true;
        const prevAp = actor.ap;
        actor.ap = 0;
        const events: GameEvent[] = [
          { type: "DEFEND_SET", entityId: actor.id },
        ];
        if (prevAp > 0) {
          events.push({ type: "STAT_CHANGED", entityId: actor.id, stat: "AP", newValue: 0, delta: -prevAp });
        }
        emit();
        return { ok: true, events };
      }

      // ---------- ATTACK ----------
      if (command.type === "ATTACK") {
        const actor = actorOf(command.actorId);
        const target = actorOf(command.targetId);
        if (!actor || !target) return { ok: false, reason: "NOT_FOUND" };
        if (actor.dead || target.dead) return { ok: false, reason: "ILLEGAL" };
        if (actor.owner !== state.activeOwner) return { ok: false, reason: "NOT_YOUR_TURN" };
        const weapon = weaponOf(actor, command.weaponId);
        if (!weapon) return { ok: false, reason: "NOT_FOUND" };
        const preview = previewAttack(state.grid, state.entities, actor, target, weapon);
        if (!preview.available) return { ok: false, reason: preview.reason ?? "ILLEGAL" };
        const resolved = resolveAttack(state.grid, state.entities, actor, target, weapon, rng);
        if (!resolved) return { ok: false, reason: "ILLEGAL" };

        const spent = weapon.endsTurn ? actor.ap : Math.min(actor.ap, weapon.apCost);
        actor.ap -= spent;
        const events: GameEvent[] = [
          { type: "STAT_CHANGED", entityId: actor.id, stat: "AP", newValue: actor.ap, delta: -spent },
          {
            type: "COMBAT_RESOLVED",
            sourceId: actor.id,
            targetId: target.id,
            actionType: resolved.actionType,
            result: resolved.result,
            damageDealt: resolved.damage,
            isFlanked: resolved.flanked,
            heightMod: resolved.heightMod,
          },
        ];
        if (resolved.damage > 0) {
          target.hp -= resolved.damage;
          events.push({
            type: "STAT_CHANGED",
            entityId: target.id,
            stat: "HP",
            newValue: target.hp,
            delta: -resolved.damage,
          });
        }
        if (target.hp <= 0 && !target.dead) {
          target.dead = true;
          target.obstacle = false;
          target.ap = 0;
          target.overwatch = false;
          target.defending = false;
          events.push({ type: "ENTITY_DIED", entityId: target.id, causeOfDeath: "DAMAGE" });
        }
        emit();
        return { ok: true, events };
      }

      // ---------- MOVE ----------
      if (command.type !== "MOVE") return { ok: false, reason: "ILLEGAL" };

      const actor = actorOf(command.actorId);
      if (!actor) return { ok: false, reason: "NOT_FOUND" };
      if (actor.dead) return { ok: false, reason: "ILLEGAL" };
      if (actor.owner !== state.activeOwner) return { ok: false, reason: "NOT_YOUR_TURN" };

      const tile = tileAt(state.grid, command.to.x, command.to.y);
      if (!tile) return { ok: false, reason: "NOT_FOUND" };

      const found = findPath(state.grid, state.entities, actor, command.to.x, command.to.y);
      if (!found || found.mpCost <= 0) return { ok: false, reason: "OCCUPIED" };
      const ap = apCostFor(found.mpCost, actor.mobility);
      if (ap === null) return { ok: false, reason: "OCCUPIED" };
      if (actor.ap < ap) return { ok: false, reason: "NO_AP" };

      const dest = found.path[found.path.length - 1];
      if (!dest) return { ok: false, reason: "ILLEGAL" };
      const prevX = actor.x;
      const prevY = actor.y;
      actor.x = dest.x;
      actor.y = dest.y;
      actor.z = dest.z;
      if (found.path.length >= 2) {
        const last = found.path[found.path.length - 2];
        if (last) actor.dir = facingAfterStep(last.x, last.y, dest.x, dest.y, actor.dir);
      } else {
        actor.dir = facingAfterStep(prevX, prevY, dest.x, dest.y, actor.dir);
      }
      actor.ap -= ap;

      const events: GameEvent[] = [
        {
          type: "STAT_CHANGED",
          entityId: actor.id,
          stat: "AP",
          newValue: actor.ap,
          delta: -ap,
        },
        {
          type: "ENTITY_MOVED",
          entityId: actor.id,
          path: found.path,
          isDash: ap === 2,
          apSpent: ap,
        },
      ];

      // §14: проверка дозора по клетке назначения.
      triggerOverwatch(actor, dest, events);

      emit();
      return { ok: true, events };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return kernel;
}
