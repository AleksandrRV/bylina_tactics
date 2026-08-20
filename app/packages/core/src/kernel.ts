import { createDebugMatch, PLAYER_OWNER } from "./debug-map.js";
import { facingAfterStep, tileAt } from "./grid.js";
import { apCostFor, findPath, listReachable } from "./pathfinding.js";
import type {
  ApplyResult,
  CellPos,
  Command,
  EntityState,
  GameEvent,
  MatchState,
  ReachableCell,
} from "./types.js";

export const CORE_VERSION = "0.2.0";

export interface TacticsKernel {
  readonly version: string;
  getSnapshot(): MatchState;
  getReachable(actorId: number): ReachableCell[];
  getPath(actorId: number, to: CellPos): { path: CellPos[]; mpCost: number; apCost: 1 | 2 } | null;
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

export function createTacticsKernel(initial?: MatchState): TacticsKernel {
  let state = initial ?? createDebugMatch();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const actorOf = (id: number): EntityState | undefined => state.entities.find((entity) => entity.id === id);

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
    apply: (command) => {
      if (command.type === "END_TURN") {
        const events: GameEvent[] = [];
        for (const entity of state.entities) {
          if (entity.dead || entity.owner !== state.activeOwner || entity.maxAp <= 0) continue;
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
