import { previewAttack, resolveAttack, type HitPreview } from "./combat.js";
import { createDebugMatch, ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { facingAfterStep, tileAt } from "./grid.js";
import { apCostFor, findPath, listReachable } from "./pathfinding.js";
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

export const CORE_VERSION = "0.4.0";

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

export function createTacticsKernel(options: KernelOptions = {}): TacticsKernel {
  let state = options.initial ?? createDebugMatch();
  const weapons = { ...defaultWeapons(), ...options.weapons };
  const rng: Rng = createMulberry32(options.seed ?? 0x51a7);
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const actorOf = (id: number): EntityState | undefined => state.entities.find((entity) => entity.id === id);

  const weaponOf = (entity: EntityState, weaponId?: string): WeaponStats | undefined => {
    return weapons[weaponId || entity.weaponId];
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
    apply: (command) => {
      if (command.type === "END_TURN") {
        const events: GameEvent[] = [];
        const upcoming = nextOwner(state, state.activeOwner);
        state.activeOwner = upcoming;
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
          events.push({ type: "ENTITY_DIED", entityId: target.id, causeOfDeath: "DAMAGE" });
        }
        emit();
        return { ok: true, events };
      }

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
