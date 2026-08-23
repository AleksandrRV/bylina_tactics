import { describe, expect, it } from "vitest";
import { runMission, SESSION_SEEDS } from "./training-sim.js";

/**
 * Дымовой тест строгого сценария обучения (0.20.13): каждая миссия
 * проходится ДО ПОБЕДЫ, когда игрок исполняет только указания летописца,
 * а Навь действует по сценарию. Прогон детерминирован (постоянные семена
 * сессии), поэтому тест фиксирует и порядок шагов, и реактивные плашки.
 */
describe("training missions complete under the strict scenario (0.20.13)", () => {
  it("movement: noop -> move -> end_turn -> dash -> end_turn, victory by steps", () => {
    const run = runMission("movement");
    expect(run.over).toBe("victory");
    expect(run.visited).toEqual(["noop", "move", "end_turn", "dash", "end_turn"]);
    expect(run.stepsDone).toBe(true);
  });

  it("combat: noop -> approach -> attack-until-dead, victory", () => {
    const run = runMission("combat");
    expect(run.over).toBe("victory");
    expect(run.visited).toEqual(["noop", "approach", "attack"]);
    expect(run.rejected).toEqual([]);
  });

  it("skills: full scripted lesson, victory and all reactive notes fire", () => {
    const run = runMission("skills");
    expect(run.over).toBe("victory");
    expect(run.visited.slice(0, 8)).toEqual([
      "skill",
      "overwatch",
      "end_turn",
      "skill",
      "defend",
      "attack",
      "end_turn",
      "skill",
    ]);
    expect(run.visited[run.visited.length - 1]).toBe("attack");
    // Реактивные плашки урока срабатывают в scripted-бое.
    expect(run.notes.summon).toBeGreaterThan(0);
    expect(run.notes.poison).toBeGreaterThan(0);
    expect(run.notes.resurrect).toBeGreaterThan(0);
    expect(run.rejected).toEqual([]);
  });

  it("runs are deterministic: same seed, same visited steps", () => {
    for (const mission of ["movement", "combat", "skills"]) {
      const a = runMission(mission);
      const b = runMission(mission);
      expect(b.visited, mission).toEqual(a.visited);
      expect(b.over).toBe(a.over);
    }
  });

  it("session seeds are used (environment matches real playthroughs)", () => {
    expect(SESSION_SEEDS).toEqual({ movement: 101, combat: 46, skills: 303 });
  });
});
