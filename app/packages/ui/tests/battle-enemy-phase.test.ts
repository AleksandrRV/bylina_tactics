/**
 * Ход Нави (0.20.66): когда противник ещё ходит. Условия прежде были
 * разбросаны по циклу проигрывания — три проверки перед командой, две
 * после; теперь они проверяются напрямую.
 */

import { describe, expect, it } from "vitest";
import { enemyPhaseActive, enemyPhaseContinues, type EnemyPhaseState } from "../src/battle-enemy-phase.js";

/** Состояние по умолчанию: ход противника, бой идёт, ядро доступно. */
function phase(overrides: Partial<EnemyPhaseState> = {}): EnemyPhaseState {
  return {
    activeOwner: 2,
    enemyOwner: 2,
    outcome: "ongoing",
    hasKernel: true,
    ...overrides,
  };
}

describe("battle enemy phase (0.20.66)", () => {
  it("keeps running while the enemy owns the turn", () => {
    expect(enemyPhaseActive(phase()), "ход противника").toBe(true);
    expect(enemyPhaseActive(phase({ activeOwner: 1 })), "ход уже у игрока").toBe(false);
    expect(enemyPhaseActive(phase({ outcome: "victory" })), "победа").toBe(false);
    expect(enemyPhaseActive(phase({ outcome: "defeat" })), "поражение").toBe(false);
    expect(enemyPhaseActive(phase({ hasKernel: false })), "ядро недоступно").toBe(false);
  });

  it("stops the loop when the enemy script has run out of commands", () => {
    // Пустая команда означает переданный ход: круг завершается, даже если
    // по снимку противник ещё активен.
    expect(enemyPhaseContinues({ ...phase(), commandIssued: true }), "команда была").toBe(true);
    expect(enemyPhaseContinues({ ...phase(), commandIssued: false }), "сценарий исчерпан").toBe(false);
    // Остальные причины остановки действуют и после команды.
    expect(enemyPhaseContinues({ ...phase(), commandIssued: true, activeOwner: 1 }), "ход передан").toBe(false);
    expect(enemyPhaseContinues({ ...phase(), commandIssued: true, outcome: "defeat" }), "исход").toBe(false);
    expect(enemyPhaseContinues({ ...phase(), commandIssued: true, hasKernel: false }), "без ядра").toBe(false);
  });
});
