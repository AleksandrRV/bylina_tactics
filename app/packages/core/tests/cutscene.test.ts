import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUTSCENE_ZOOM,
  cutsceneMatches,
  pickCutscene,
  withCutsceneDefaults,
  type CutsceneConfig,
} from "../src/index.js";

const INTRO: CutsceneConfig = {
  id: "m1_intro",
  trigger: { kind: "missionStart" },
  steps: [
    { kind: "focus", target: { configId: "mikula_peasant" }, holdMs: 600 },
    { kind: "pan", target: { marker: "S" }, durationMs: 1000, holdMs: 800 },
    { kind: "pan", target: { configId: "mikula_peasant" }, durationMs: 800 },
  ],
  lockInput: true,
  skippable: true,
};
const RAT: CutsceneConfig = {
  id: "m1_rat_appear",
  trigger: { kind: "onSpawn", configId: "forest_rat" },
  steps: [
    { kind: "pan", target: { configId: "forest_rat" }, durationMs: 320 },
    { kind: "pan", target: { configId: "forest_rat" }, durationMs: 420, runInMs: 420, holdMs: 700 },
  ],
  lockInput: true,
  skippable: true,
};

describe("cutscene triggers (0.20.37)", () => {
  it("matches a mission start only for missionStart", () => {
    expect(cutsceneMatches(INTRO, { type: "missionStart" })).toBe(true);
    expect(cutsceneMatches(INTRO, { type: "spawn", configId: "forest_rat" })).toBe(false);
  });

  it("matches a spawn by the beastiary record", () => {
    expect(cutsceneMatches(RAT, { type: "spawn", configId: "forest_rat" })).toBe(true);
    expect(cutsceneMatches(RAT, { type: "spawn", configId: "upyr" })).toBe(false);
  });

  it("matches flags and pickups by their key", () => {
    expect(cutsceneMatches({ ...RAT, trigger: { kind: "onFlag", flag: "fedotFreed" } }, { type: "flag", flag: "fedotFreed" })).toBe(true);
    expect(cutsceneMatches({ ...RAT, trigger: { kind: "onFlag", flag: "fedotFreed" } }, { type: "flag", flag: "other" })).toBe(false);
    expect(cutsceneMatches({ ...RAT, trigger: { kind: "onPickup", itemId: "stick" } }, { type: "pickup", itemId: "stick" })).toBe(true);
  });

  it("picks the first matching scene and nothing when there is no match", () => {
    expect(pickCutscene([INTRO, RAT], { type: "spawn", configId: "forest_rat" })?.id).toBe("m1_rat_appear");
    expect(pickCutscene([INTRO, RAT], { type: "spawn", configId: "slug" })).toBeNull();
    expect(pickCutscene(undefined, { type: "missionStart" })).toBeNull();
  });
});

describe("cutscene camera zoom (0.20.39)", () => {
  it("zooms the camera in by default: otherwise the pan cannot move", () => {
    // При подгонке «поле целиком» окно камеры не меньше поля: без
    // приближения проезд камеры стоит на месте.
    expect(DEFAULT_CUTSCENE_ZOOM).toBeGreaterThan(1);
    expect(withCutsceneDefaults(INTRO).zoom).toBe(DEFAULT_CUTSCENE_ZOOM);
  });

  it("keeps the zoom set by the author of the scene", () => {
    expect(withCutsceneDefaults({ ...INTRO, zoom: 1.4 }).zoom).toBe(1.4);
  });
});

describe("однократные сцены (0.20.45)", () => {
  it("сыгранная сцена с once уступает триггер следующей", () => {
    const ambush: CutsceneConfig = { ...RAT, id: "m2_ambush", once: true };
    const swarm: CutsceneConfig = { ...RAT, id: "m2_swarm" };
    const event = { type: "spawn", configId: "forest_rat" } as const;
    // Первое появление крысы в М2 — засада: сцена передаёт ход Нави.
    expect(pickCutscene([ambush, swarm], event)?.id).toBe("m2_ambush");
    // Сцена уже сыграна: следующие крысы — стая, без передачи хода.
    expect(pickCutscene([ambush, swarm], event, ["m2_ambush"])?.id).toBe("m2_swarm");
    // Без пометки once сцена игралась бы на каждой волне.
    expect(pickCutscene([{ ...ambush, once: false }, swarm], event, ["m2_ambush"])?.id).toBe("m2_ambush");
  });
});
