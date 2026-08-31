import { describe, expect, it } from "vitest";
import type { TrainingHintConfig } from "@bylina/content";
import type { GameEvent } from "@bylina/core";
import {
  hintCompletedByEvents,
  shouldAutoEndTurn,
  trainingHintsSorted,
  trainingOutcome,
} from "../src/training-progress.js";

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
  {
    type: "ENTITY_MOVED",
    entityId: 1,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    isDash,
    apSpent: 1,
  },
];

describe("hintCompletedByEvents", () => {
  it("completes steps by the player's matching event only", () => {
    expect(hintCompletedByEvents(hint({ until: "move" }), moved())).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "dash" }), moved(false))).toBe(false);
    expect(hintCompletedByEvents(hint({ until: "dash" }), moved(true))).toBe(true);
    expect(
      hintCompletedByEvents(hint({ until: "attack" }), [
        { type: "COMBAT_RESOLVED", result: "HIT", damageDealt: 3 } as never,
      ]),
    ).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "skill" }), [{ type: "SKILL_RESOLVED" } as never])).toBe(true);
    expect(
      hintCompletedByEvents(hint({ until: "defend" }), [
        { type: "STATUS_CHANGED", entityId: 1, status: "DEFENDING", applied: true } as never,
      ]),
    ).toBe(true);
    expect(
      hintCompletedByEvents(hint({ until: "overwatch" }), [
        { type: "STATUS_CHANGED", entityId: 1, status: "OVERWATCH", applied: true } as never,
      ]),
    ).toBe(true);
    expect(
      hintCompletedByEvents(hint({ until: "end_turn" }), [
        { type: "TURN_CHANGED", activePlayerId: "2", turnNumber: 2 } as never,
      ]),
    ).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "approach" }), moved())).toBe(true);
    expect(hintCompletedByEvents(hint({ until: "noop" }), [])).toBe(false);
    expect(
      hintCompletedByEvents(hint({ until: "move" }), [
        { type: "TURN_CHANGED", activePlayerId: "1", turnNumber: 2 } as never,
      ]),
    ).toBe(false);
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
    for (const until of [
      "move",
      "dash",
      "attack",
      "skill",
      "defend",
      "overwatch",
      "end_turn",
      "approach",
      "noop",
    ] as const) {
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

describe("training outcome (0.20.61)", () => {
  /** Условия итога: по умолчанию — мирная миссия, бой продолжается. */
  const conditions = (over: Partial<Parameters<typeof trainingOutcome>[0]> = {}) => ({
    outcome: "ongoing" as const,
    missionHasEnemies: false,
    trainingDone: false,
    ...over,
  });

  it("completes a peaceful mission by the hints, not by the kernel outcome", () => {
    // Без противников партия «выиграна» ядром с самого начала (0.20.13),
    // поэтому исход ядра неприменим: победа наступает по шагам подсказки.
    expect(trainingOutcome(conditions({ outcome: "victory" }))).toBeNull();
    expect(trainingOutcome(conditions({ trainingDone: true }))).toBe("victory");
  });

  it("completes a mission with enemies by the kernel outcome", () => {
    // Шаги подсказки сами по себе не дают победы: последний шаг ведёт к ней
    // указаниями, а итог ставит ядро.
    expect(trainingOutcome(conditions({ missionHasEnemies: true, trainingDone: true }))).toBeNull();
    expect(trainingOutcome(conditions({ missionHasEnemies: true, outcome: "victory" }))).toBe("victory");
  });

  it("loses by the kernel outcome whatever the hints are", () => {
    // Навь в обучении действует: гибель дружины заканчивает урок.
    expect(trainingOutcome(conditions({ outcome: "defeat" }))).toBe("defeat");
    expect(trainingOutcome(conditions({ missionHasEnemies: true, outcome: "defeat" }))).toBe("defeat");
    // Тонкость порядка сохранена из прежнего кода: в мирной миссии пройденные
    // шаги завершают урок победой, даже если ядро сообщает поражение. Ветка
    // недостижима — в миссии без противников дружине неоткуда погибнуть, — и
    // правка правила была бы изменением игры, а не переноcом кода.
    expect(trainingOutcome(conditions({ outcome: "defeat", trainingDone: true }))).toBe("victory");
  });
});
