import { describe, expect, it } from "vitest";
import type { TrainingHintConfig } from "@bylina/content";
import type { GameEvent } from "@bylina/core";
import {
  hintCompletedByEvents,
  resolveTrainingHighlight,
  shouldAutoEndTurn,
  trainingHintsSorted,
  trainingPanelKey,
} from "../src/training-progress.js";

function hint(partial: Partial<TrainingHintConfig>): TrainingHintConfig {
  return {
    step: 1,
    textKey: "hint",
    highlight: "cell",
    until: "noop",
    ...partial,
  };
}

const MOVED: GameEvent = { type: "ENTITY_MOVED", entityId: 1, path: [], isDash: false, apSpent: 1 };
const RESOLVED: GameEvent = { type: "COMBAT_RESOLVED", sourceId: 1, targetId: 2, actionType: "MELEE", result: "HIT", damageDealt: 4, isFlanked: false, heightMod: 0 };
const SKILL: GameEvent = { type: "SKILL_RESOLVED", sourceId: 1, skillId: "heal", success: true };
const DEFEND: GameEvent = { type: "STATUS_CHANGED", entityId: 1, status: "DEFENDING", applied: true };
const OVERWATCH: GameEvent = { type: "STATUS_CHANGED", entityId: 1, status: "OVERWATCH", applied: true };
const TURN: GameEvent = { type: "TURN_CHANGED", activePlayerId: "2", turnNumber: 2 };

describe("trainingHintsSorted", () => {
  it("orders hints by the step field regardless of array order", () => {
    const hints = [
      hint({ step: 3 }),
      hint({ step: 1, textKey: "a" }),
      hint({ step: 2, textKey: "b" }),
    ];
    expect(trainingHintsSorted(hints).map((item) => item.step)).toEqual([1, 2, 3]);
  });
});

describe("hintCompletedByEvents", () => {
  it.each([
    ["move", MOVED, true],
    ["move", SKILL, false],
    ["attack", RESOLVED, true],
    ["attack", MOVED, false],
    ["skill", SKILL, true],
    ["skill", RESOLVED, false],
    ["defend", DEFEND, true],
    ["defend", OVERWATCH, false],
    ["overwatch", OVERWATCH, true],
    ["end_turn", TURN, true],
    ["end_turn", RESOLVED, false],
    ["approach", MOVED, true],
    ["approach", RESOLVED, true],
    ["noop", SKILL, true],
  ] as const)("until %s completes on the matching event only", (until, event, expected) => {
    expect(hintCompletedByEvents(hint({ until }), [event])).toBe(expected);
  });

  it("ignores events of the enemy turn (no player events passed)", () => {
    expect(hintCompletedByEvents(hint({ until: "attack" }), [])).toBe(false);
    expect(hintCompletedByEvents(hint({ until: "skill" }), [MOVED, TURN])).toBe(false);
  });
});

describe("shouldAutoEndTurn", () => {
  const base = {
    paused: false,
    busy: false,
    enemyPhase: false,
    isReplay: false,
    isSpectator: false,
    isTraining: false,
    activeHint: null,
    activeOwner: 1,
    viewOwner: 1,
    ownUnits: [{ ap: 0 }],
    outcomeOngoing: true,
    isNetGuest: false,
  };

  it("ends the turn when every own fighter has zero AP", () => {
    expect(shouldAutoEndTurn(base)).toBe(true);
  });

  it("does not end while any fighter still has AP", () => {
    expect(shouldAutoEndTurn({ ...base, ownUnits: [{ ap: 0 }, { ap: 1 }] })).toBe(false);
  });

  it("does not end on the training hint that teaches the end-turn button", () => {
    expect(shouldAutoEndTurn({
      ...base,
      isTraining: true,
      activeHint: hint({ until: "end_turn" }),
    })).toBe(false);
  });

  it("does not end when it is not the viewer's turn, in replays or for spectators", () => {
    expect(shouldAutoEndTurn({ ...base, activeOwner: 2 })).toBe(false);
    expect(shouldAutoEndTurn({ ...base, isReplay: true })).toBe(false);
    expect(shouldAutoEndTurn({ ...base, isSpectator: true })).toBe(false);
    expect(shouldAutoEndTurn({ ...base, paused: true })).toBe(false);
  });

  it("does not end when the battle is already over or the roster is empty", () => {
    expect(shouldAutoEndTurn({ ...base, outcomeOngoing: false })).toBe(false);
    expect(shouldAutoEndTurn({ ...base, ownUnits: [] })).toBe(false);
  });
});

describe("resolveTrainingHighlight", () => {
  it("resolves a cell hint without coordinates to the farthest reachable cell", () => {
    const reachable = [
      { x: 1, y: 1, z: 1, mpCost: 1, apCost: 1 as const },
      { x: 3, y: 3, z: 1, mpCost: 6, apCost: 2 as const },
      { x: 2, y: 2, z: 1, mpCost: 3, apCost: 1 as const },
    ];
    expect(resolveTrainingHighlight(hint({ highlight: "cell" }), reachable, [])).toEqual({ kind: "cell", x: 3, y: 3 });
  });

  it("prefers the explicit cell coordinates when present", () => {
    const reachable = [{ x: 3, y: 3, z: 1, mpCost: 6, apCost: 2 as const }];
    expect(resolveTrainingHighlight(hint({ highlight: "cell", cell: { x: 1, y: 2 } }), reachable, []))
      .toEqual({ kind: "cell", x: 1, y: 2 });
  });

  it("resolves an entity hint to the first entity of the target unit id", () => {
    const entities = [
      { configId: "upyr", x: 5, y: 5 },
      { configId: "kikimora", x: 6, y: 6 },
    ];
    expect(resolveTrainingHighlight(hint({ highlight: "entity", targetUnitId: "kikimora" }), [], entities))
      .toEqual({ kind: "entity", x: 6, y: 6 });
  });

  it("returns null for panel hints and for missing entities", () => {
    expect(resolveTrainingHighlight(hint({ highlight: "panel", panelKey: "ap" }), [], [])).toBeNull();
    expect(resolveTrainingHighlight(hint({ highlight: "entity", targetUnitId: "solovey" }), [], [])).toBeNull();
    expect(resolveTrainingHighlight(null, [], [])).toBeNull();
  });
});

describe("trainingPanelKey", () => {
  it("returns the panel key for panel/button hints and null otherwise", () => {
    expect(trainingPanelKey(hint({ highlight: "button", panelKey: "weapon" }))).toBe("weapon");
    expect(trainingPanelKey(hint({ highlight: "panel", panelKey: "ap" }))).toBe("ap");
    expect(trainingPanelKey(hint({ highlight: "cell" }))).toBeNull();
    expect(trainingPanelKey(null)).toBeNull();
  });
});
