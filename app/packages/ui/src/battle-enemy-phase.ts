/**
 * Ход Нави (0.20.66): когда противник ещё ходит.
 *
 * Прежде условия жили внутри цикла проигрывания: три проверки перед
 * командой и две после неё. Здесь они названы и проверяются отдельно —
 * цикл в экране читается как последовательность шагов, а не как набор
 * условий выхода.
 */

/** Состояние боя, по которому решается, ходит ли ещё противник. */
export interface EnemyPhaseState {
  /** Сторона, чей ход сейчас. */
  activeOwner: number;
  /** Сторона противника. */
  enemyOwner: number;
  /** Исход партии по правилам ядра. */
  outcome: "ongoing" | "victory" | "defeat";
  /** Ядро доступно: без него команду противника не выбрать. */
  hasKernel: boolean;
}

/**
 * Противник ещё ходит: его очередь, итог боя не наступил и ядро доступно.
 * Признак «ход закончен» — смена активной стороны: она наступает и по
 * команде конца хода, и по исчерпанию очков действия у Нави.
 */
export function enemyPhaseActive(state: EnemyPhaseState): boolean {
  if (state.outcome !== "ongoing") return false;
  if (state.activeOwner !== state.enemyOwner) return false;
  return state.hasKernel;
}

/**
 * Продолжать ли цикл после исполненной команды. Пустая команда означает,
 * что сценарий противника исчерпан и ход передан: круг завершается, даже
 * если по снимку противник ещё активен.
 */
export function enemyPhaseContinues(state: EnemyPhaseState & { commandIssued: boolean }): boolean {
  return state.commandIssued && enemyPhaseActive(state);
}
