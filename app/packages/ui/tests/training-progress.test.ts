import { describe, expect, it } from "vitest";
import type { TrainingHintConfig } from "@bylina/content";
import type { GameEvent } from "@bylina/core";
import { hintCompletedByEvents, shouldAutoEndTurn, trainingHintsSorted } from "../src/training-progress.js";

/**
 * Чистая логика продвижения подсказок (0.19.2/0.20.13): шаг завершается
 * только событием действия игрока, порядок шагов задаёт поле step, а
 * авто-завершение хода не обгоняет урок. Точные указания шагов покрыты
 * тестами training-scenario.test.ts.
 */

const hint = (fields: Partial<TrainingHintConfig>): TrainingHintConfig => ({
  step: 1,
  textKey: "t",
  highlight: "panel",
  until: "move",
  ...fields,
});

const moved = (isDash = false): GameEvent[] => [
  { type: "ENTITY_MOVED", entityId: 1, from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 }, path: [], mpCost: 1, apCost: 1, isDash, dir: 0 },
];

describe("hintCompletedByEvents", () => {
  it("completes steps by the player's matching event only", () => {
    expect(hintCompletedByEvents(hint({ until: "move" }), moved())).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "dash" }), moved(false))).toBe(false);
    expect(hintCompletedByEvents(hint({ until: "dash" }), moved(true))).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "attack" }), [{ type: "COMBAT_RESOLVED", result: "HIT", damageDealt: 3 } as never])).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "skill" }), [{ type: "SKILL_RESOLVED" } as never])).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "defend" }), [{ type: "STATUS_CHANGED", entityId: 1, status: "DEFENDING", applied: true } as never])).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "overwatch" }), [{ type: "STATUS_CHANGED", entityId: 1, status: "OVERWATCH", applied: true } as never])).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "end_turn" }), [{ type: "TURN_CHANGED", activePlayerId: "2", turnNumber: 2 } as never])).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "approach" }), moved())).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "noop" }), [])).toBe(false);
    expect(hintCompletedByEvents(hint({ until: "move" }), [{ type: "TURN_CHANGED", activePlayerId: "1", turnNumber: 2 } as never])).toBe(false);
  });
});

describe("trainingHintsSorted", () => {
  it("orders hints by the step field regardless of array order", () => {
    const sorted = trainingHintsSorted([
      hint({ step: 3, until: "attack" }),
      hint({ step: 1, until: "noop" }),
      hint({ step: 2, until: "move" }),
    ]);
    expect(sorted.map((h) => h.step)).toEqual([1, 2, 3]);
  });
});

describe("shouldAutoEndTurn in training (0.20.13)", () => {
  const conditions = (overrides: Partial<Parameters<typeof shouldAutoEndTurn>[0]>) =>
    shouldAutoEndTurn({
      paused: false,
      busy: false,
      enemyPhase: false,
      isReplay: false,
      isSpectator: false,
      isTraining: true,
      activeHint: hint({ until: "move" }),
      activeOwner: 1,
      viewOwner: 1,
      ownUnits: [{ ap: 0 }],
      outcomeOngoing: true,
      isNetGuest: false,
      ...overrides,
    });

  it("never auto-ends while a scenario step is active", () => {
    for (const until of ["move", "dash", "attack", "skill", "defend", "overwatch", "end_turn", "approach", "noop"] as const) {
      expect(conditions({ activeHint: hint({ until }) })).toBe(false);
    }
  });

  it("auto-ends only when the lesson is over and all AP are spent", () => {
    expect(conditions({ activeHint: null })).toBe(true);
    expect(conditions({ activeHint: null, ownUnits: [{ ap: 1 }] })).toBe(false);
    expect(conditions({ activeHint: null, activeOwner: 2 })).toBe(false);
    expect(conditions({ activeHint: null, paused: true })).toBe(false);
    expect(conditions({ activeHint: null, busy: true })).toBe(false);
    expect(conditions({ activeHint: null, enemyPhase: true })).toBe(false);
    expect(conditions({ activeHint: null, isTraining: false, outcomeOngoing: false })).toBe(false);
  });
});
