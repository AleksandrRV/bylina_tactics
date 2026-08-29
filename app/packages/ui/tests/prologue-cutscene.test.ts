import { describe, expect, it } from "vitest";
import type { CutsceneConfig, GameEvent } from "@bylina/core";
import {
  buildCinematicPlan,
  spawnedConfigIds,
  splitAtHandOff,
  splitSpawnEvents,
  stagedEntityIds,
} from "../src/prologue-cutscene.js";

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
  zoom: 1.9,
  steps: [
    { kind: "pan", target: { configId: "forest_rat" }, durationMs: 320 },
    { kind: "pan", target: { configId: "forest_rat" }, durationMs: 420, runInMs: 420, holdMs: 700 },
    { kind: "pan", target: { configId: "mikula_peasant" }, durationMs: 700 },
  ],
};

/**
 * Сцена с передачей хода (0.20.40): крыса кусает сразу после вбегания,
 * поэтому между кадрами сцены разыгрывается чужой ход.
 */
const RAT_HANDOFF: CutsceneConfig = {
  id: "m1_rat_appear",
  trigger: { kind: "onSpawn", configId: "forest_rat" },
  lockInput: true,
  skippable: true,
  zoom: 1.9,
  steps: [
    { kind: "pan", target: { configId: "forest_rat" }, durationMs: 420, runInMs: 620, follow: true, holdMs: 300 },
    { kind: "handOff" },
    { kind: "pan", target: { configId: "mikula_peasant" }, durationMs: 600 },
  ],
};

function spawnEvent(configId: string, id = 7): GameEvent {
  return {
    type: "ENTITY_SPAWNED",
    entity: { id, configId } as never,
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

  it("carries the camera zoom of the scene (0.20.39)", () => {
    // Без приближения проезд камеры невозможен: при подгонке «поле целиком»
    // окно камеры не меньше поля и камера стоит на месте.
    expect(buildCinematicPlan(RAT, MARKERS).zoom).toBe(1.9);
    expect(buildCinematicPlan(INTRO, MARKERS).zoom).toBeUndefined();
  });

  it("names the entities the scene must hide until the run-in (0.20.39)", () => {
    // Крыса уже создана ядром; до вбегания её на поле быть не должно.
    const events = [spawnEvent("forest_rat", 42), spawnEvent("upyr", 43)];
    expect(stagedEntityIds(events, [INTRO, RAT])).toEqual([42]);
    expect(stagedEntityIds(events, [INTRO])).toEqual([]);
  });

  it("carries the accent and the run-in tracking to the renderer (0.20.40)", () => {
    const plan = buildCinematicPlan({ ...INTRO, steps: [{ kind: "pan", target: { marker: "S" }, accent: true }] }, MARKERS);
    // Кадр называет палку не только приближением, но и светом.
    expect(plan.steps[0]?.accent).toBe(true);
    const rat = buildCinematicPlan(RAT_HANDOFF, MARKERS);
    expect(rat.steps[0]?.follow).toBe(true);
    expect(rat.steps[0]?.runInMs).toBe(620);
  });

  it("keeps the camera zoom through the hand-off (0.20.41)", () => {
    // Первая половина сцены не отъезжает: укус по передаче хода играется
    // крупным планом, а не между двумя переездами камеры.
    expect(buildCinematicPlan(RAT_HANDOFF, MARKERS, { holdZoom: true }).holdZoom).toBe(true);
    expect(buildCinematicPlan(RAT_HANDOFF, MARKERS).holdZoom).toBe(false);
    // Отъезд берёт на себя вторая половина: без неё сцена обязана вернуть
    // игровой масштаб сама.
    expect(buildCinematicPlan(RAT, MARKERS, { holdZoom: false }).holdZoom).toBe(false);
  });

  it("returns the continuation to the game scale, not to the doubled zoom (0.20.41)", () => {
    // Вторая половина начинается с кадра, который оставила первая: её `zoom`
    // — множитель к игровому масштабу, а не к текущему приближению.
    expect(buildCinematicPlan(RAT_HANDOFF, MARKERS, { baseScale: 1.25 }).baseScale).toBe(1.25);
    expect(buildCinematicPlan(RAT_HANDOFF, MARKERS, { baseScale: null }).baseScale).toBeUndefined();
    expect(buildCinematicPlan(RAT_HANDOFF, MARKERS).baseScale).toBeUndefined();
  });

  it("splits the scene at the hand-off step (0.20.40)", () => {
    const { before, after } = splitAtHandOff(RAT_HANDOFF);
    // До передачи хода: кадр на опушке и вбегание с трекингом.
    expect(before.steps).toHaveLength(1);
    expect(before.steps[0]?.kind).toBe("pan");
    // После: камера возвращается к герою, когда чужой ход доигран.
    expect(after, "the scene continues after the hand-off").not.toBeNull();
    expect(after?.id).toBe("m1_rat_appear_after");
    expect(after?.steps.map((step) => step.kind)).toEqual(["pan"]);
    // Приближение наследуется обеими частями: кадр не меняет крупность.
    expect(after?.zoom).toBe(1.9);
    // Шаг передачи хода — граница сцены, а не кадр: проигрывателю поля он
    // достаётся пустой паузой, кадром не становится.
    const handOffPlan = buildCinematicPlan({ ...RAT_HANDOFF, steps: [{ kind: "handOff" }] }, MARKERS);
    expect(handOffPlan.steps.map((step) => step.kind)).toEqual(["hold"]);
  });

  it("does not split a scene without a hand-off", () => {
    const { before, after } = splitAtHandOff(RAT);
    expect(after).toBeNull();
    expect(before).toBe(RAT);
  });

  it("drops a trailing hand-off with nothing after it", () => {
    const { before, after } = splitAtHandOff({ ...RAT_HANDOFF, steps: [{ kind: "handOff" }] });
    expect(before.steps).toEqual([]);
    expect(after).toBeNull();
  });

  it("splits spawns between the staged scene and the generic playback", () => {
    const events = [spawnEvent("forest_rat"), spawnEvent("upyr")];
    const { staged, generic } = splitSpawnEvents(events, [INTRO, RAT]);
    expect(staged.map((entry) => entry.configId)).toEqual(["forest_rat"]);
    expect(staged[0]?.event).toEqual({ type: "spawn", configId: "forest_rat" });
    // Идентификатор сущности нужен экрану: скрыть её до вбегания (0.20.39).
    expect(staged[0]?.entityId).toBe(7);
    // Упырь постановки не имеет — уходит обычным порядком событий.
    expect(generic).toHaveLength(1);
    expect(spawnedConfigIds(generic)).toEqual(["upyr"]);
  });
});
