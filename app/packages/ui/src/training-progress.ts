import type { TrainingHintConfig } from "@bylina/content";
import type { GameEvent } from "@bylina/core";

/**
 * Чистая логика режима обучения (0.19.2): продвижение подсказок и правило
 * авто-завершения хода покрыты автоматическими проверками без среды
 * обозревателя. Точные указания шагов (клетка, оружие, умение, цель) с
 * версии 0.20.13 вычисляет модуль training-scenario.ts.
 */

/** Шаги в порядке поля step (порядок массива конфигурации значения не имеет). */
export function trainingHintsSorted(hints: readonly TrainingHintConfig[]): TrainingHintConfig[] {
  return [...hints].sort((a, b) => a.step - b.step);
}

/**
 * Завершил ли набор событий обучающий шаг. Шаг завершается только действием
 * игрока: события хода противника в этот список не попадают (вызывающий
 * код передаёт события команд игрока). Шаги с полем repeatUntil (0.20.13)
 * проверяются по снимку — см. trainingStepCompleted в training-scenario.ts.
 */
export function hintCompletedByEvents(hint: TrainingHintConfig, events: readonly GameEvent[]): boolean {
  return events.some((event) => {
    switch (hint.until) {
      case "move":
        return event.type === "ENTITY_MOVED";
      case "dash":
        // Рывок (0.20.1): перемещение за два очка действия помечено в событии.
        return event.type === "ENTITY_MOVED" && event.isDash === true;
      case "attack":
        return event.type === "COMBAT_RESOLVED";
      case "skill":
        return event.type === "SKILL_RESOLVED";
      case "defend":
        return event.type === "STATUS_CHANGED" && event.status === "DEFENDING" && event.applied;
      case "overwatch":
        return event.type === "STATUS_CHANGED" && event.status === "OVERWATCH" && event.applied;
      case "end_turn":
        return event.type === "TURN_CHANGED";
      case "approach":
        return event.type === "ENTITY_MOVED" || event.type === "COMBAT_RESOLVED";
      case "noop":
        // Ознакомительный шаг: завершается любым первым действием игрока.
        return true;
      default:
        return false;
    }
  });
}

interface AutoEndTurnConditions {
  paused: boolean;
  busy: boolean;
  enemyPhase: boolean;
  isReplay: boolean;
  isSpectator: boolean;
  isTraining: boolean;
  activeHint: TrainingHintConfig | null;
  activeOwner: number;
  viewOwner: number;
  /** Живые бойцы активной стороны (coverType 0, maxAp > 0). */
  ownUnits: readonly { ap: number }[];
  outcomeOngoing: boolean;
  isNetGuest: boolean;
}

/**
 * Авто-завершение хода стороны (math §16.7): ход передаётся следующей
 * стороне без команды, когда ни один боец стороны не имеет допустимых
 * действий. Для стороны игрока единственный такой случай — нулевые запасы
 * ОД всех живых бойцов (стойка и дозор допустимы при любом ненулевом
 * остатке). В обучении авто-завершение запрещено, пока активен шаг
 * сценария (0.20.13): завершение хода — само по себе предписанный шаг, а
 * остальные указания ведут бой; иначе ход мог бы смениться раньше
 * требуемого действия.
 *
 * Ограничение по исходу партии (не «в процессе») в обучении не применяется
 * (0.20.2): миссия без противников по правилам ядра сразу «выиграна», а
 * миссия с противниками становится «выигранной» после их гибели — пока
 * сценарий не завершён, бой обучения продолжается, и авто-завершение хода
 * обязано работать, чтобы сторона не застревала с нулевыми ОД.
 */
export function shouldAutoEndTurn(conditions: AutoEndTurnConditions): boolean {
  if (conditions.paused || conditions.busy || conditions.enemyPhase) return false;
  if (conditions.isReplay || conditions.isSpectator) return false;
  if (conditions.activeOwner !== conditions.viewOwner) return false;
  // A training step is a contract with the player. The scenario prescribes
  // an explicit end-turn step whenever the turn must change hands; automatic
  // ending must not leap ahead of the lesson (0.20.13).
  if (conditions.isTraining && conditions.activeHint !== null) return false;
  if (conditions.ownUnits.length === 0) return false;
  if (conditions.ownUnits.some((unit) => unit.ap > 0)) return false;
  if (!conditions.isNetGuest && !conditions.outcomeOngoing && !conditions.isTraining) return false;
  return true;
}

/**
 * Исход миссии обучения (0.19.0; строгий сценарий 0.20.13).
 *
 * Путей к победе два, и они не взаимозаменяемы:
 * - миссия без противников («Первые шаги») по правилам ядра выиграна с
 *   самого начала, поэтому её исход неприменим — победа наступает
 *   выполнением всех шагов подсказки;
 * - миссия с противниками («Бой», «Умения и состояния») играется до победы
 *   ядра: последний шаг сценария (`repeatUntil: victory`) ведёт игрока
 *   указаниями до самой победы, поэтому реактивные плашки (яд, воскрешение)
 *   успевают сработать.
 *
 * Поражение — всегда по ядру и всегда раньше победы: Навь в обучении
 * действует, и гибель дружины заканчивает урок независимо от того, сколько
 * шагов подсказки пройдено (0.20.62). Мёртвый отряд не доучивается, даже
 * если сценарий формально выполнен.
 */
export interface TrainingOutcomeConditions {
  /** Исход партии по правилам ядра. */
  outcome: "ongoing" | "victory" | "defeat";
  /** Есть ли в миссии противники (от этого зависит путь к победе). */
  missionHasEnemies: boolean;
  /** Выполнены ли все шаги подсказки. */
  trainingDone: boolean;
}

/** Итог урока: `null` — урок продолжается. */
export type TrainingOutcome = "victory" | "defeat";

export function trainingOutcome(conditions: TrainingOutcomeConditions): TrainingOutcome | null {
  // Поражение проверяется первым: оно сильнее любого признака победы.
  if (conditions.outcome === "defeat") return "defeat";
  const complete = conditions.missionHasEnemies ? conditions.outcome === "victory" : conditions.trainingDone;
  return complete ? "victory" : null;
}
