import type { CellPos, EntityState, GameEvent, MatchState } from "./types.js";
import { distH } from "./grid.js";

/** Триггеры миссии пролога (doc/campaign.md §13.1). Только наблюдают события ядра. */
export type MissionTriggerKind =
  | "OnZoneEnter"
  | "OnUnitAdjacent"
  | "OnObjectDestroyed"
  | "OnObjectInteracted"
  | "OnTurnStart"
  | "OnEnemyAliveBelow"
  | "OnUnitHpBelow"
  | "OnPickup"
  | "OnSkillUsed"
  | "OnUnitDied"
  | "OnCrossLine"
  | "OnPoisonApplied";

export interface MissionTrigger {
  id: string;
  kind: MissionTriggerKind;
  once?: boolean;
  flag?: string;
  /** Прямоугольник зоны (включительно). */
  zone?: { x0: number; y0: number; x1: number; y1: number };
  unitId?: string;
  otherUnitId?: string;
  objectConfigId?: string;
  itemId?: string;
  skillId?: string;
  side?: "player" | "enemy";
  turnNumber?: number;
  n?: number;
  percent?: number;
  lineAxis?: "x" | "y";
  lineValue?: number;
}

export interface MissionScriptState {
  fired: string[];
  flags: Record<string, boolean>;
}

export interface MissionTriggerFire {
  triggerId: string;
  flag?: string;
}

function livingCombatants(state: MatchState, owner: number): EntityState[] {
  return state.entities.filter(
    (entity) =>
      !entity.dead && entity.owner === owner && entity.coverType === 0 && entity.countsForElimination !== false,
  );
}

function inZone(pos: CellPos, zone: NonNullable<MissionTrigger["zone"]>): boolean {
  return pos.x >= zone.x0 && pos.x <= zone.x1 && pos.y >= zone.y0 && pos.y <= zone.y1;
}

function byConfig(state: MatchState, configId: string, alive = true): EntityState | undefined {
  return state.entities.find((entity) => entity.configId === configId && entity.dead !== alive);
}

function alreadyFired(state: MissionScriptState, trigger: MissionTrigger): boolean {
  return trigger.once !== false && state.fired.includes(trigger.id);
}

function mark(state: MissionScriptState, trigger: MissionTrigger, fires: MissionTriggerFire[]): void {
  if (alreadyFired(state, trigger)) return;
  state.fired = [...state.fired, trigger.id];
  if (trigger.flag) state.flags = { ...state.flags, [trigger.flag]: true };
  fires.push({ triggerId: trigger.id, flag: trigger.flag });
}

/**
 * Прогон триггеров по снимку и событиям последнего применения команды.
 * Правила боя не меняются — только флаги сценария.
 */
export function evaluateMissionTriggers(
  match: MatchState,
  events: readonly GameEvent[],
  triggers: readonly MissionTrigger[],
  script: MissionScriptState,
): { state: MissionScriptState; fired: MissionTriggerFire[] } {
  const next: MissionScriptState = { fired: [...script.fired], flags: { ...script.flags } };
  const fired: MissionTriggerFire[] = [];

  for (const trigger of triggers) {
    if (alreadyFired(next, trigger) && trigger.once !== false) continue;

    if (trigger.kind === "OnZoneEnter") {
      if (!trigger.zone) continue;
      const moved = events.filter((event) => event.type === "ENTITY_MOVED");
      for (const event of moved) {
        if (event.type !== "ENTITY_MOVED") continue;
        const last = event.path[event.path.length - 1];
        if (!last || !inZone(last, trigger.zone)) continue;
        const entity = match.entities.find((candidate) => candidate.id === event.entityId);
        if (trigger.unitId && entity?.configId !== trigger.unitId) continue;
        mark(next, trigger, fired);
        break;
      }
    } else if (trigger.kind === "OnUnitAdjacent") {
      const a = trigger.unitId ? byConfig(match, trigger.unitId, true) : undefined;
      const b = trigger.otherUnitId ? byConfig(match, trigger.otherUnitId, true) : undefined;
      if (a && b && distH(a.x, a.y, b.x, b.y) <= 1) mark(next, trigger, fired);
    } else if (trigger.kind === "OnObjectDestroyed") {
      if (events.some((event) => event.type === "COVER_DESTROYED")) {
        if (trigger.objectConfigId) {
          const gone = match.entities.find(
            (entity) => entity.configId === trigger.objectConfigId && (entity.dead || entity.coverType === 0),
          );
          if (gone) mark(next, trigger, fired);
        } else {
          mark(next, trigger, fired);
        }
      }
      if (events.some((event) => event.type === "ENTITY_DIED")) {
        if (trigger.objectConfigId) {
          const died = events.some((event) => {
            if (event.type !== "ENTITY_DIED") return false;
            const entity = match.entities.find((candidate) => candidate.id === event.entityId);
            return entity?.configId === trigger.objectConfigId;
          });
          if (died) mark(next, trigger, fired);
        }
      }
    } else if (trigger.kind === "OnObjectInteracted") {
      if (events.some((event) => event.type === "SKILL_RESOLVED" && event.success)) {
        mark(next, trigger, fired);
      }
    } else if (trigger.kind === "OnTurnStart") {
      const change = events.find((event) => event.type === "TURN_CHANGED");
      if (change && change.type === "TURN_CHANGED") {
        const sideOk =
          !trigger.side ||
          (trigger.side === "player" && change.activePlayerId === "1") ||
          (trigger.side === "enemy" && change.activePlayerId !== "1");
        const turnOk = trigger.turnNumber === undefined || change.turnNumber === trigger.turnNumber;
        if (sideOk && turnOk) mark(next, trigger, fired);
      }
    } else if (trigger.kind === "OnEnemyAliveBelow") {
      const n = trigger.n ?? 0;
      if (livingCombatants(match, 2).length < n) mark(next, trigger, fired);
    } else if (trigger.kind === "OnUnitHpBelow") {
      if (!trigger.unitId) continue;
      const unit = byConfig(match, trigger.unitId, true);
      if (!unit || unit.maxHp <= 0) continue;
      const percent = trigger.percent ?? 100;
      if ((unit.hp / unit.maxHp) * 100 < percent) mark(next, trigger, fired);
    } else if (trigger.kind === "OnPickup") {
      const moved = events.filter((event) => event.type === "ENTITY_MOVED");
      for (const event of moved) {
        if (event.type !== "ENTITY_MOVED") continue;
        const last = event.path[event.path.length - 1];
        if (!last) continue;
        // Предмет на клетке кодируется сущностью с configId === itemId.
        const item = match.entities.find(
          (entity) => entity.configId === (trigger.itemId ?? "") && entity.x === last.x && entity.y === last.y,
        );
        if (item) {
          mark(next, trigger, fired);
          break;
        }
      }
    } else if (trigger.kind === "OnSkillUsed") {
      const used = events.find((event) => event.type === "SKILL_RESOLVED");
      if (used && used.type === "SKILL_RESOLVED") {
        if (trigger.skillId && used.skillId !== trigger.skillId) continue;
        if (trigger.unitId) {
          const source = match.entities.find((entity) => entity.id === used.sourceId);
          if (source?.configId !== trigger.unitId) continue;
        }
        mark(next, trigger, fired);
      }
    } else if (trigger.kind === "OnUnitDied") {
      const died = events.some((event) => {
        if (event.type !== "ENTITY_DIED") return false;
        const entity = match.entities.find((candidate) => candidate.id === event.entityId);
        if (trigger.unitId && entity?.configId !== trigger.unitId) return false;
        return true;
      });
      if (died) mark(next, trigger, fired);
    } else if (trigger.kind === "OnCrossLine") {
      const axis = trigger.lineAxis ?? "x";
      const threshold = trigger.lineValue ?? 0;
      const moved = events.filter((event) => event.type === "ENTITY_MOVED");
      for (const event of moved) {
        if (event.type !== "ENTITY_MOVED") continue;
        const last = event.path[event.path.length - 1];
        if (!last) continue;
        const entity = match.entities.find((candidate) => candidate.id === event.entityId);
        if (!entity || entity.dead) continue;
        if (trigger.side === "player" && entity.owner !== 1) continue;
        if (trigger.side === "enemy" && entity.owner !== 2) continue;
        if (trigger.unitId && entity.configId !== trigger.unitId) continue;
        const coord = axis === "x" ? last.x : last.y;
        if (coord >= threshold) {
          mark(next, trigger, fired);
          break;
        }
      }
    } else if (trigger.kind === "OnPoisonApplied") {
      const poisoned = events.some((event) => {
        if (event.type !== "STATUS_CHANGED" || event.status !== "POISON" || !event.applied) return false;
        const entity = match.entities.find((candidate) => candidate.id === event.entityId);
        if (!entity) return false;
        if (trigger.side === "player" && entity.owner !== 1) return false;
        if (trigger.side === "enemy" && entity.owner !== 2) return false;
        return true;
      });
      if (poisoned) mark(next, trigger, fired);
    }
  }

  return { state: next, fired };
}

export function createMissionScriptState(): MissionScriptState {
  return { fired: [], flags: {} };
}
