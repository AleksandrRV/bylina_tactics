import { ENEMY_OWNER, PLAYER_OWNER } from "./debug-map.js";
import { distH } from "./grid.js";
import { livingOf } from "./outcome.js";
import { pickEnemyCommand } from "./ai.js";
import type { TacticsKernel } from "./kernel.js";
import type { CellPos, Command, EntityState } from "./types.js";

/**
 * Строгий сценарий Нави в режиме обучения (0.20.13, game-design §3.5).
 *
 * Прежде игрок мог отклониться от урока, а противник действовал общим
 * алгоритмом `pickEnemyCommand`: сценарий обучения не был зафиксирован ни за
 * игроком, ни за Навью. Теперь ходы противника задаёт сценарий миссии
 * (`training.json5`, поле `enemyScript`): линейная очередь действий с
 * разделителями конца хода и постоянные приоритетные правила (например,
 * «кикимора поднимает погибшего упыря, как только появится тело»).
 *
 * Модуль исполнительной среды: правила боя не меняются — сценарий лишь
 * выбирает те же команды, что доступны человеку. Все решения детерминированы
 * (порядок обхода и правила выбора фиксированы), поэтому на постоянном семени
 * миссии партия воспроизводима шаг за шагом. Если очередная запись сценария
 * невыполнима (исполнитель пал, цель недосягаема), она пропускается; когда
 * очередь исчерпана, ход достаётся обычному алгоритму как детерминированному
 * предохранителю — урок к этому моменту уже показан.
 */

/** Условие применимости записи сценария (проверяется перед исполнением). */
export type TrainingEnemyCondition = "targetAlive" | "targetNotPoisoned" | "targetWounded" | "corpseExists";

export interface TrainingEnemyAction {
  /** Исполнитель (configId). Отсутствует у маркера конца хода. */
  unitId?: string;
  kind: "attack" | "skill" | "approach" | "defend" | "overwatch" | "resurrect" | "endTurn";
  /** Цель действия (configId): атака, умение, сближение. */
  targetUnitId?: string;
  /** Оружие атаки; по умолчанию основное оружие исполнителя. */
  weaponId?: string;
  /** Умение для записей `skill`/`resurrect`. */
  skillId?: string;
  /** Запись погибшего юнита для воскрешения. */
  corpseUnitId?: string;
  /** Условие применимости; без условия запись исполняется по мере наступления. */
  onlyIf?: TrainingEnemyCondition;
}

export interface TrainingEnemyScript {
  /** Постоянные правила: проверяются в порядке списка перед каждой командой. */
  priority?: TrainingEnemyAction[];
  /** Линейная очередь действий; `endTurn` завершает ход стороны Нави. */
  actions?: TrainingEnemyAction[];
}

/** Позиция в очереди сценария (постоянные правила позицию не меняют). */
export interface TrainingEnemyScriptState {
  index: number;
}

export interface ScriptedEnemyDecision {
  /** Команда для исполнения; `null` — ход стороны завершить (`END_TURN`). */
  command: Command | null;
  state: TrainingEnemyScriptState;
}

function livingByConfigId(snap: ReturnType<TacticsKernel["getSnapshot"]>, configId: string): EntityState | undefined {
  return snap.entities.find((entity) => entity.configId === configId && !entity.dead);
}

function deadByConfigId(
  snap: ReturnType<TacticsKernel["getSnapshot"]>,
  configId: string,
  owner: number,
): EntityState | undefined {
  return snap.entities.find((entity) => entity.configId === configId && entity.dead && entity.owner === owner);
}

function conditionHolds(kernel: TacticsKernel, action: TrainingEnemyAction, actor: EntityState | undefined): boolean {
  if (!action.onlyIf) return true;
  const snap = kernel.getSnapshot();
  if (action.onlyIf === "corpseExists") {
    return deadByConfigId(snap, action.corpseUnitId ?? "", ENEMY_OWNER) !== undefined;
  }
  const target = action.targetUnitId ? livingByConfigId(snap, action.targetUnitId) : undefined;
  if (!target) return false;
  if (action.onlyIf === "targetAlive") return true;
  if (action.onlyIf === "targetNotPoisoned") return !target.poison;
  // targetWounded: цель потеряла здоровье — имеет смысл лечить/добивать.
  return target.hp < target.maxHp;
}

/**
 * Лучший шаг сближения с целью: минимальное расстояние, затем дешевле очко
 * действия, затем детерминированный порядок клеток. При `keepAp` шаг
 * оставляет одно очко действия для самой атаки/умения (клетки за два очка
 * допускаются, только когда за одно очко приблизиться нельзя). Возвращает
 * null, когда ни один шаг не приближает (исполнитель уже вплотную либо зажат).
 */
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

/**
 * Решение по записи сценария: `step` — промежуточное действие (шаг
 * сближения), после которого запись остаётся активной; `done` — запись
 * исполнена или невыполнима, очередь двигается дальше.
 */
type ActionResolution = { command: Command | null; done: boolean };

function resolveAction(kernel: TacticsKernel, action: TrainingEnemyAction): ActionResolution {
  const snap = kernel.getSnapshot();
  if (action.kind === "endTurn") return { command: null, done: true };
  if (!action.unitId) return { command: null, done: true };
  const actor = livingByConfigId(snap, action.unitId);
  if (!actor || actor.owner !== ENEMY_OWNER || actor.ap <= 0) return { command: null, done: true };
  if (!conditionHolds(kernel, action, actor)) return { command: null, done: true };

  if (action.kind === "defend") {
    return actor.defending
      ? { command: null, done: true }
      : { command: { type: "DEFEND", actorId: actor.id }, done: true };
  }
  if (action.kind === "overwatch") {
    return actor.overwatch
      ? { command: null, done: true }
      : { command: { type: "OVERWATCH", actorId: actor.id }, done: true };
  }

  if (action.kind === "resurrect") {
    const skillId = action.skillId;
    if (!skillId) return { command: null, done: true };
    const corpse = deadByConfigId(snap, action.corpseUnitId ?? "", ENEMY_OWNER);
    if (!corpse) return { command: null, done: true };
    const pos: CellPos = { x: corpse.x, y: corpse.y, z: corpse.z };
    if (kernel.getSkillPreview(actor.id, skillId, undefined, pos).available) {
      return { command: { type: "USE_SKILL", actorId: actor.id, skillId, targetPos: pos }, done: true };
    }
    // Тело вне радиуса — шаг сближения, запись остаётся активной.
    return { command: approachStep(kernel, actor, corpse, true), done: false };
  }

  const target = action.targetUnitId ? livingByConfigId(snap, action.targetUnitId) : undefined;
  if (!target || target.owner === ENEMY_OWNER) return { command: null, done: true };

  if (action.kind === "skill") {
    const skillId = action.skillId;
    if (!skillId) return { command: null, done: true };
    if (kernel.getSkillPreview(actor.id, skillId, target.id).available) {
      return { command: { type: "USE_SKILL", actorId: actor.id, skillId, targetId: target.id }, done: true };
    }
    return { command: approachStep(kernel, actor, target, true), done: false };
  }

  // attack: оружейная атака; при недосягаемости — шаг сближения, после
  // которого запись исполняется следующей командой.
  const weaponId = action.weaponId ?? actor.weaponId ?? actor.weaponIds?.[0];
  if (!weaponId) return { command: null, done: true };
  if (kernel.getHitPreview(actor.id, target.id, weaponId).available) {
    return { command: { type: "ATTACK", actorId: actor.id, targetId: target.id, weaponId }, done: true };
  }
  return { command: approachStep(kernel, actor, target, true), done: false };
}

function applicable(kernel: TacticsKernel, action: TrainingEnemyAction): boolean {
  if (action.kind === "endTurn") return true;
  if (!action.unitId) return false;
  const snap = kernel.getSnapshot();
  const actor = livingByConfigId(snap, action.unitId);
  if (!actor || actor.owner !== ENEMY_OWNER || actor.ap <= 0) return false;
  return conditionHolds(kernel, action, actor);
}

/**
 * Следующая команда хода Нави по сценарию обучения. Вызывается в цикле до
 * возвращения `command: null` (конец хода стороны). Постоянные правила
 * (`priority`) проверяются перед каждым решением и позицию очереди не
 * двигают; запись `endTurn` и невыполнимые записи продвигают очередь.
 */
export function pickScriptedEnemyCommand(
  kernel: TacticsKernel,
  script: TrainingEnemyScript | undefined,
  state: TrainingEnemyScriptState,
): ScriptedEnemyDecision {
  const snap = kernel.getSnapshot();
  if (snap.activeOwner !== ENEMY_OWNER) return { command: null, state };
  if (livingOf(snap, PLAYER_OWNER).length === 0) return { command: null, state };

  // Постоянные правила сценария: пока правило применимо, оно исполняется
  // прежде очереди (например, воскрешение упыря при появлении тела).
  for (const rule of script?.priority ?? []) {
    if (rule.kind === "endTurn") continue;
    if (!applicable(kernel, rule)) continue;
    const resolution = resolveAction(kernel, rule);
    if (resolution.command) return { command: resolution.command, state };
  }

  const queue = script?.actions ?? [];
  let index = state.index;
  while (index < queue.length) {
    const action = queue[index]!;
    if (action.kind === "endTurn") {
      return { command: null, state: { index: index + 1 } };
    }
    const resolution = resolveAction(kernel, action);
    if (resolution.command) {
      // Шаг сближения не завершает запись: сама атака/умение исполнится
      // следующей командой того же хода.
      return { command: resolution.command, state: { index: resolution.done ? index + 1 : index } };
    }
    // Невыполнимая запись пропускается без расхода хода.
    index += 1;
  }

  // Очередь исчерпана: детерминированный предохранитель — обычный алгоритм.
  return { command: pickEnemyCommand(kernel), state: { index } };
}
