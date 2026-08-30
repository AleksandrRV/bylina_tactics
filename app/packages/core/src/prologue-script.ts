import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { distH } from "./grid.js";
import { livingOf } from "./outcome.js";
import { pickEnemyCommand } from "./ai.js";
import type { TacticsKernel } from "./kernel.js";
import type { CellPos, Command, EntityState } from "./types.js";
import type { TrainingEnemyAction, TrainingEnemyCondition, TrainingEnemyScript, TrainingEnemyScriptState } from "./training-ai.js";
import { pickScriptedEnemyCommand } from "./training-ai.js";

/**
 * Скрипт пролога (0.20.32): обобщение строгого сценария обучения на
 * исполнителей стороны игрока и канал forceHit/forceMiss.
 */

export type PrologueScriptSide = "player" | "enemy";

export interface PrologueScriptAction {
  unitId?: string;
  side?: PrologueScriptSide;
  kind: TrainingEnemyAction["kind"] | "spawn" | "appear";
  targetUnitId?: string;
  weaponId?: string;
  skillId?: string;
  corpseUnitId?: string;
  onlyIf?: TrainingEnemyCondition;
  forceOutcome?: "hit" | "miss" | "min";
  at?: { x: number; y: number };
}

export interface PrologueScript {
  priority?: PrologueScriptAction[];
  actions?: PrologueScriptAction[];
}

export interface PrologueScriptState {
  index: number;
}

export interface ScriptedDecision {
  command: Command | null;
  state: PrologueScriptState;
  forceOutcome?: "hit" | "miss" | "min";
  spawn?: { unitId: string; at: { x: number; y: number }; owner: number };
}

function livingByConfigId(snap: ReturnType<TacticsKernel["getSnapshot"]>, configId: string): EntityState | undefined {
  return snap.entities.find((entity) => entity.configId === configId && !entity.dead && entity.ap > 0)
    ?? snap.entities.find((entity) => entity.configId === configId && !entity.dead);
}

function deadByConfigId(snap: ReturnType<TacticsKernel["getSnapshot"]>, configId: string, owner: number): EntityState | undefined {
  return snap.entities.find((entity) => entity.configId === configId && entity.dead && entity.owner === owner);
}

function ownerOf(action: PrologueScriptAction): number {
  return action.side === "player" ? PLAYER_OWNER : ENEMY_OWNER;
}

function conditionHolds(kernel: TacticsKernel, action: PrologueScriptAction, _actor: EntityState | undefined): boolean {
  if (!action.onlyIf) return true;
  const snap = kernel.getSnapshot();
  const owner = ownerOf(action);
  if (action.onlyIf === "corpseExists") {
    return deadByConfigId(snap, action.corpseUnitId ?? "", owner) !== undefined;
  }
  const target = action.targetUnitId ? livingByConfigId(snap, action.targetUnitId) : undefined;
  if (!target) return false;
  if (action.onlyIf === "targetAlive") return true;
  if (action.onlyIf === "targetNotPoisoned") return !target.poison;
  return target.hp < target.maxHp;
}

function approachStep(
  kernel: TacticsKernel,
  actor: EntityState,
  target: { x: number; y: number },
  keepAp = false,
): Command | null {
  const reachable = kernel.getReachable(actor.id);
  if (reachable.length === 0) return null;
  const now = distH(actor.x, actor.y, target.x, target.y);
  const closer = reachable.filter((cell) => distH(cell.x, cell.y, target.x, target.y) < now);
  const rank = (cells: typeof reachable): typeof reachable =>
    [...cells].sort((a, b) => {
      const da = distH(a.x, a.y, target.x, target.y);
      const db = distH(b.x, b.y, target.x, target.y);
      if (da !== db) return da - db;
      if (a.apCost !== b.apCost) return a.apCost - b.apCost;
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });
  const cheap = keepAp ? rank(closer.filter((cell) => cell.apCost === 1)) : [];
  const pool = keepAp && cheap.length > 0 ? cheap : rank(closer);
  const best = pool[0];
  return best ? { type: "MOVE", actorId: actor.id, to: best } : null;
}

type ActionResolution = { command: Command | null; done: boolean; forceOutcome?: "hit" | "miss" | "min"; spawn?: ScriptedDecision["spawn"] };

function resolveAction(kernel: TacticsKernel, action: PrologueScriptAction): ActionResolution {
  const snap = kernel.getSnapshot();
  if (action.kind === "endTurn") return { command: null, done: true };
  if (action.kind === "spawn" || action.kind === "appear") {
    if (!action.unitId || !action.at) return { command: null, done: true };
    if (livingByConfigId(snap, action.unitId)) return { command: null, done: true };
    return {
      command: null,
      done: true,
      spawn: { unitId: action.unitId, at: action.at, owner: ownerOf(action) },
    };
  }
  if (!action.unitId) return { command: null, done: true };
  const actor = livingByConfigId(snap, action.unitId);
  const owner = ownerOf(action);
  if (!actor || actor.owner !== owner || actor.ap <= 0) return { command: null, done: true };
  if (!conditionHolds(kernel, action, actor)) return { command: null, done: true };

  if (action.kind === "defend") {
    return actor.defending ? { command: null, done: true } : { command: { type: "DEFEND", actorId: actor.id }, done: true };
  }
  if (action.kind === "overwatch") {
    return actor.overwatch ? { command: null, done: true } : { command: { type: "OVERWATCH", actorId: actor.id }, done: true };
  }

  if (action.kind === "resurrect") {
    const skillId = action.skillId;
    if (!skillId) return { command: null, done: true };
    const corpse = deadByConfigId(snap, action.corpseUnitId ?? "", owner);
    if (!corpse) return { command: null, done: true };
    const pos: CellPos = { x: corpse.x, y: corpse.y, z: corpse.z };
    if (kernel.getSkillPreview(actor.id, skillId, undefined, pos).available) {
      return { command: { type: "USE_SKILL", actorId: actor.id, skillId, targetPos: pos }, done: true };
    }
    return { command: approachStep(kernel, actor, corpse, true), done: false };
  }

  const target = action.targetUnitId ? livingByConfigId(snap, action.targetUnitId) : undefined;
  if (!target || target.owner === owner) return { command: null, done: true };

  if (action.kind === "skill") {
    const skillId = action.skillId;
    if (!skillId) return { command: null, done: true };
    if (kernel.getSkillPreview(actor.id, skillId, target.id).available) {
      return { command: { type: "USE_SKILL", actorId: actor.id, skillId, targetId: target.id }, done: true, forceOutcome: action.forceOutcome };
    }
    return { command: approachStep(kernel, actor, target, true), done: false };
  }

  if (action.kind === "approach") {
    const step = approachStep(kernel, actor, target, false);
    return { command: step, done: !step };
  }

  const weaponId = action.weaponId ?? actor.weaponId ?? actor.weaponIds?.[0];
  if (!weaponId) return { command: null, done: true };
  if (kernel.getHitPreview(actor.id, target.id, weaponId).available) {
    return {
      command: { type: "ATTACK", actorId: actor.id, targetId: target.id, weaponId },
      done: true,
      forceOutcome: action.forceOutcome,
    };
  }
  return { command: approachStep(kernel, actor, target, true), done: false };
}

function applicable(kernel: TacticsKernel, action: PrologueScriptAction): boolean {
  if (action.kind === "endTurn" || action.kind === "spawn" || action.kind === "appear") return true;
  if (!action.unitId) return false;
  const snap = kernel.getSnapshot();
  const actor = livingByConfigId(snap, action.unitId);
  if (!actor || actor.owner !== ownerOf(action) || actor.ap <= 0) return false;
  return conditionHolds(kernel, action, actor);
}

/**
 * Следующая команда сценария пролога. Исполнитель может быть стороной игрока.
 * Невалидная запись пропускается (предохранитель как в обучении).
 */
export function pickScriptedCommand(
  kernel: TacticsKernel,
  script: PrologueScript | undefined,
  state: PrologueScriptState,
  options: { activeOwner?: number } = {},
): ScriptedDecision {
  const snap = kernel.getSnapshot();
  const expected = options.activeOwner ?? snap.activeOwner;
  if (snap.activeOwner !== expected) return { command: null, state };

  for (const rule of script?.priority ?? []) {
    if (rule.kind === "endTurn") continue;
    if (!applicable(kernel, rule)) continue;
    const resolution = resolveAction(kernel, rule);
    if (resolution.command || resolution.spawn) {
      return {
        command: resolution.command,
        state,
        forceOutcome: resolution.forceOutcome,
        spawn: resolution.spawn,
      };
    }
  }

  const queue = script?.actions ?? [];
  let index = state.index;
  while (index < queue.length) {
    const action = queue[index]!;
    if (action.kind === "endTurn") {
      return { command: null, state: { index: index + 1 } };
    }
    // Исполнитель ещё не вышел на поле — сценарий ждёт его, а не теряет
    // шаг (0.20.45). Крыса М1 появляется только после подбора палки: без
    // этого ожидания первые же пустые ходы Нави пролистывали всю очередь,
    // и укус, обещанный сценой, разыгрывался бы обычным алгоритмом —
    // с обычным шансом промаха. Появление (`spawn`/`appear`) ждать не
    // надо: оно само выводит исполнителя на поле.
    if (
      action.unitId &&
      action.kind !== "spawn" &&
      action.kind !== "appear" &&
      !snap.entities.some((entity) => entity.configId === action.unitId)
    ) {
      return { command: null, state: { index } };
    }
    const resolution = resolveAction(kernel, action);
    if (resolution.command || resolution.spawn) {
      return {
        command: resolution.command,
        state: { index: resolution.done ? index + 1 : index },
        forceOutcome: resolution.forceOutcome,
        spawn: resolution.spawn,
      };
    }
    index += 1;
  }

  if (snap.activeOwner === ENEMY_OWNER && livingOf(snap, PLAYER_OWNER).length > 0) {
    return { command: pickEnemyCommand(kernel), state: { index } };
  }
  return { command: null, state: { index } };
}

/** Совместимость: сценарий обучения по-прежнему выбирается тем же контрактом. */
export function asTrainingScript(script: PrologueScript): TrainingEnemyScript {
  return {
    priority: script.priority as TrainingEnemyAction[] | undefined,
    actions: script.actions as TrainingEnemyAction[] | undefined,
  };
}

export function pickTrainingViaPrologue(
  kernel: TacticsKernel,
  script: TrainingEnemyScript | undefined,
  state: TrainingEnemyScriptState,
): ReturnType<typeof pickScriptedEnemyCommand> {
  return pickScriptedEnemyCommand(kernel, script, state);
}

export type { TrainingEnemyCondition };
