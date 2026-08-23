import type { TrainingHintConfig } from "@bylina/content";
import type { GameEvent, ReachableCell } from "@bylina/core";

/**
 * Чистая логика режима обучения (0.19.2): выделена из BattleScreen, чтобы
 * продвижение подсказок, авто-завершение хода и подсветку можно было
 * покрыть автоматическими проверками без среды обозревателя.
 */

/** Шаги в порядке поля step (порядок массива конфигурации значения не имеет). */
export function trainingHintsSorted(hints: readonly TrainingHintConfig[]): TrainingHintConfig[] {
  return [...hints].sort((a, b) => a.step - b.step);
}

/**
 * Завершил ли набор событий обучающий шаг. Шаг завершается только действием
 * игрока: события хода противника в этот список не попадают (вызывающий
 * код передаёт события команд игрока).
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

export interface AutoEndTurnConditions {
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
 * остатке). В обучении авто-завершение отключается на шаге «завершите ход».
 */
export function shouldAutoEndTurn(conditions: AutoEndTurnConditions): boolean {
  if (conditions.paused || conditions.busy || conditions.enemyPhase) return false;
  if (conditions.isReplay || conditions.isSpectator) return false;
  if (conditions.activeOwner !== conditions.viewOwner) return false;
  if (conditions.isTraining && conditions.activeHint?.until === "end_turn") return false;
  if (conditions.ownUnits.length === 0) return false;
  if (conditions.ownUnits.some((unit) => unit.ap > 0)) return false;
  if (!conditions.isNetGuest && !conditions.outcomeOngoing) return false;
  return true;
}

/** Категории действий игрока, допустимые на шаге обучения. */
export type TrainingActionKind =
  | "move"
  | "dash"
  | "attack"
  | "skill"
  | "defend"
  | "overwatch"
  | "endTurn";

/**
 * Допустимо ли действие `action` на активном шаге обучения `until`.
 * Используется, чтобы игрок в обучении не мог совершить иное действие,
 * чем предписывает шаг (доработка обучения): например, на шаге
 * «перемещение» недоступны атака, умения, стойка, дозор и завершение хода.
 * Шаг «ознакомление» (noop) не допускает никаких действий, кроме клика
 * для подтверждения. Неизвестный тип шага не ограничивает (безопасный предел).
 */
export function trainingActionAllowed(until: string | undefined, action: TrainingActionKind): boolean {
  switch (until) {
    case "noop":
      return false;
    case "move":
      return action === "move";
    case "dash":
      return action === "dash";
    case "attack":
      return action === "move" || action === "attack";
    case "approach":
      return action === "move" || action === "attack";
    case "skill":
      return action === "skill";
    case "defend":
      return action === "defend";
    case "overwatch":
      return action === "overwatch";
    case "end_turn":
      return action === "endTurn";
    default:
      return true;
  }
}

/**
 * Подсветка обучающей подсказки на поле: клетка либо сущность. Шаг
 * «клетка/зона» без координат (карты миссий случайны) подсвечивает самую
 * дальнюю достижимую клетку выбранного бойца.
 */
export function resolveTrainingHighlight(
  activeHint: TrainingHintConfig | null,
  reachable: readonly ReachableCell[],
  entities: readonly { configId: string; x: number; y: number }[],
): { kind: "cell" | "entity"; x: number; y: number } | null {
  if (!activeHint) return null;
  if (activeHint.highlight === "cell" || activeHint.highlight === "zone") {
    if (activeHint.cell) return { kind: "cell", x: activeHint.cell.x, y: activeHint.cell.y };
    // Шаг «перемещение» подсвечивает дальнюю клетку за одно очко действия,
    // шаг «рывок» — дальнюю за два (0.20.1): подсветка соответствует цене
    // обучаемого действия.
    const pool = reachable.filter((cell) =>
      activeHint.until === "move" ? cell.apCost === 1 : activeHint.until === "dash" ? cell.apCost === 2 : true,
    );
    const pick = pool.reduce<ReachableCell | null>(
      (best, cell) => (!best || cell.mpCost > best.mpCost ? cell : best),
      null,
    );
    if (pick) return { kind: "cell", x: pick.x, y: pick.y };
    return null;
  }
  if (activeHint.highlight === "entity" && activeHint.targetUnitId) {
    const entity = entities.find((candidate) => candidate.configId === activeHint.targetUnitId);
    if (entity) return { kind: "entity", x: entity.x, y: entity.y };
  }
  return null;
}

/**
 * Ключ подсвечиваемого элемента панели/кнопки для highlight "panel"/"button"
 * (ui-design §4.5): "ap" | "weapon" | "skill" | "defend" | "overwatch" | "end_turn".
 */
export function trainingPanelKey(activeHint: TrainingHintConfig | null): string | null {
  return activeHint && (activeHint.highlight === "panel" || activeHint.highlight === "button")
    ? (activeHint.panelKey ?? null)
    : null;
}
