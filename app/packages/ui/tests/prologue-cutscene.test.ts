import { describe, expect, it } from "vitest";
import type { CutsceneConfig, GameEvent } from "@bylina/core";
import { buildCinematicPlan, spawnedConfigIds, splitSpawnEvents } from "../src/prologue-cutscene.js";

const MARKERS = {
  S: [{ x: 19, y: 3 }],
  F: [{ x: 18, y: 2 }],
};

const INTRO: CutsceneConfig = {
  id: "m1_intro",
  trigger: { kind: "missionStart" },
  lockInput: true,
  skippable: true,
  steps: [
    { kind: "focus", target: { configId: "mikula_peasant" }, holdMs: 600 },
    { kind: "pan", target: { marker: "S" }, durationMs: 1000, holdMs: 800 },
    { kind: "pan", target: { configId: "mikula_peasant" }, durationMs: 800 },
  ],
};

const RAT: CutsceneConfig = {
  id: "m1_rat_appear",
  trigger: { kind: "onSpawn", configId: "forest_rat" },
  lockInput: true,
  skippable: true,
  steps: [
    { kind: "pan", target: { configId: "forest_rat" }, durationMs: 320 },
    { kind: "pan", target: { configId: "forest_rat" }, durationMs: 420, runInMs: 420, holdMs: 700 },
    { kind: "pan", target: { configId: "mikula_peasant" }, durationMs: 700 },
  ],
};

function spawnEvent(configId: string): GameEvent {
  return {
    type: "ENTITY_SPAWNED",
    entity: { id: 7, configId } as never,
    cause: "SUMMON",
  };
}

describe("prologue cutscene plan (0.20.37)", () => {
  it("carries the scene through to the renderer untouched", () => {
    const plan = buildCinematicPlan(INTRO, MARKERS);
    expect(plan.id).toBe("m1_intro");
    expect(plan.lockInput).toBe(true);
    expect(plan.skippable).toBe(true);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]?.target).toEqual({ configId: "mikula_peasant" });
    // Герой → палка → герой: управление отдаётся только после возврата.
    expect(plan.steps[2]?.target).toEqual({ configId: "mikula_peasant" });
  });

  it("resolves a layout marker into a cell", () => {
    const plan = buildCinematicPlan(INTRO, MARKERS);
    expect(plan.steps[1]?.target).toEqual({ cell: { x: 19, y: 3 } });
  });

  it("drops the target when the marker is unknown instead of crashing", () => {
    const plan = buildCinematicPlan(INTRO, {});
    expect(plan.steps[1]?.target).toBeUndefined();
  });

  it("keeps the run-in beat for the rat", () => {
    const plan = buildCinematicPlan(RAT, MARKERS);
    expect(plan.steps[1]?.runInMs).toBe(420);
    expect(plan.steps[1]?.holdMs).toBe(700);
  });

  it("splits spawns between the staged scene and the generic playback", () => {
    const events = [spawnEvent("forest_rat"), spawnEvent("upyr")];
    const { staged, generic } = splitSpawnEvents(events, [INTRO, RAT]);
    expect(staged.map((entry) => entry.configId)).toEqual(["forest_rat"]);
    expect(staged[0]?.event).toEqual({ type: "spawn", configId: "forest_rat" });
    // Упырь постановки не имеет — уходит обычным порядком событий.
    expect(generic).toHaveLength(1);
    expect(spawnedConfigIds(generic)).toEqual(["upyr"]);
  });
});
