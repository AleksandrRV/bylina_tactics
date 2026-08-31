/**
 * Сборка партии для экрана боя (0.20.68).
 *
 * Решатель проверяется без React: он читает состояние сессии и содержание,
 * но не рисует ничего. Проверяется главное правило порядка — сохранённая
 * партия важнее freshly собранной — и то, что каждый вид боя берёт партию
 * из своего источника: трудность, миссия обучения, журнал повтора.
 */

import {
  ENEMY_OWNER,
  PLAYER_OWNER,
  defaultTrainingWeapons,
  weaponStatsFromRecord,
  type SkillStats,
  type WeaponStats,
} from "@bylina/core";
import { parseContent } from "@bylina/content";
import { createReplayRecorder } from "@bylina/replay";
import { createSession } from "@bylina/session";
import { describe, expect, it } from "vitest";
import { dataTree } from "./training-sim.js";
import { createBattleKernel, type BattleMatchDeps } from "../src/battle-match.js";

/** Решатель с настоящим содержанием и сессией, но без экрана. */
function setup(): BattleMatchDeps {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error(`content parse failed: ${JSON.stringify(parsed.issues)}`);
  const content = parsed.data;
  const session = createSession("menu");
  const weapons: Record<string, WeaponStats> = defaultTrainingWeapons();
  for (const record of content.weapons) weapons[record.id] = weaponStatsFromRecord(record);
  for (const record of content.prologueBestiary?.weapons ?? []) weapons[record.id] = weaponStatsFromRecord(record);
  const skills: Record<string, SkillStats> = {};
  for (const record of content.skills) skills[record.id] = record as SkillStats;
  return {
    battleKind: "quick",
    content,
    session,
    weapons,
    skills,
    matchSeed: 0,
    difficulty: "normal",
    activeMissionId: null,
    deployment: [],
    isNetGuest: false,
    prologueMission: null,
    trainingMission: null,
    replayJournal: null,
  };
}

/** Юниты стороны, или всех, если сторона не указана. */
function unitsOf(deps: BattleMatchDeps, owner?: number): string[] {
  const kernel = createBattleKernel(deps);
  if (!kernel) throw new Error("kernel is missing");
  return kernel
    .getSnapshot()
    .entities.filter((entity) => owner === undefined || entity.owner === owner)
    .map((entity) => entity.configId)
    .sort();
}

/**
 * Сохранить партию так, как это делает сохранение былины (0.20.15): снимок
 * и туман приходят в сессию, «продолжить» открывает бой прямо на них.
 */
function saveQuickMatch(deps: BattleMatchDeps, story: string | null): string[] {
  const host = createBattleKernel(deps);
  if (!host) throw new Error("kernel is missing");
  const saved = host
    .getSnapshot()
    .entities.map((entity) => entity.configId)
    .sort();
  deps.session.continueCampaign({
    screen: "battle",
    prologueMissionId: story,
    activeMissionId: story ? null : "m1",
    deployment: [],
    matchSeed: 701,
    restoredMatch: host.getSnapshot(),
    restoredFog: host.getFog(),
  });
  return saved;
}

describe("createBattleKernel", () => {
  it("быстрый матч: трудность задаёт число врагов", () => {
    const deps = setup();
    const enemyCount = (difficulty: "easy" | "normal" | "hard"): number => {
      const kernel = createBattleKernel({ ...deps, difficulty });
      if (!kernel) throw new Error("kernel is missing");
      return kernel.getSnapshot().entities.filter((entity) => entity.owner === ENEMY_OWNER).length;
    };
    const expected = (id: "easy" | "normal" | "hard"): number =>
      deps.content.quickMatch.difficulties.find((item) => item.id === id)?.enemyCount ?? 0;
    expect(enemyCount("easy")).toBe(expected("easy"));
    expect(enemyCount("hard")).toBe(expected("hard"));
    expect(expected("hard")).toBeGreaterThan(expected("easy"));
  });

  it("сетевой ведомый не получает ядро: правила у ведущего", () => {
    const deps = setup();
    expect(createBattleKernel({ ...deps, isNetGuest: true })).toBeNull();
  });

  it("сохранённая партия важнее freshly собранной: общий порядок", () => {
    const deps = setup();
    const saved = saveQuickMatch(deps, null);
    // Кампания без выбранной миссии собрала бы быстрый матч, но снимок в
    // состоянии сессии имеет преимущество (сохранение 0.13.0).
    expect(unitsOf({ ...deps, battleKind: "campaign" })).toEqual(saved);
  });

  it("сохранённая партия важнее freshly собранной: пролог", () => {
    const deps = setup();
    const mission = deps.content.prologue.missions[0]!;
    const saved = saveQuickMatch(deps, mission.id);
    // Быстрый матч сохраняется, а открывается бой пролога: состав дружины
    // остаётся от сохранения и не заменяется составом миссии.
    expect(saved).not.toEqual([...mission.playerSlots].sort());
    const after = unitsOf({ ...deps, battleKind: "prologue", prologueMission: mission });
    expect(after).toEqual(saved);
  });

  it("пролог без миссии собирает быстрый матч", () => {
    const deps = setup();
    const kernel = createBattleKernel({ ...deps, battleKind: "prologue", prologueMission: null });
    expect(kernel).not.toBeNull();
    expect(kernel?.getSnapshot().entities.length).toBeGreaterThan(0);
  });

  it("обучение собирает партию по миссии", () => {
    const deps = setup();
    const mission = deps.content.training.missions[0]!;
    expect(deps.session.startTrainingMission(mission.id)).toBe(true);
    expect(unitsOf({ ...deps, battleKind: "training", trainingMission: mission }, PLAYER_OWNER)).toEqual(
      [...mission.playerSlots].sort(),
    );
  });

  it("кампания: партия собирается по миссии и составу высадки", async () => {
    const deps = setup();
    const { createCampaign } = await import("../../campaign/src/index.js");
    const unitStats: Record<string, { maxHealth: number }> = {};
    for (const unit of deps.content.units) unitStats[unit.id] = { maxHealth: unit.maxHealth };
    const campaign = createCampaign(deps.content.campaign, {
      unitStats,
      items: deps.content.items,
      classUnitIds: deps.content.units
        .filter((unit) => unit.side === "druzhina" && unit.id !== deps.content.campaign.recruitUnitId)
        .map((unit) => unit.id),
    });
    deps.session.bindCampaign(campaign);
    const mission = campaign.getMissions()[0]!;
    expect(deps.session.startCampaignMission(mission.id)).toBe(true);
    const fighters = campaign.getState().fighters.slice(0, campaign.getDeployLimits().min);
    const deployment = fighters.map((fighter) => fighter.id);
    expect(deps.session.confirmDeployment(deployment)).toBe(true);
    const kernel = createBattleKernel({ ...deps, battleKind: "campaign", activeMissionId: mission.id, deployment });
    expect(kernel).not.toBeNull();
    const playerUnits = kernel!
      .getSnapshot()
      .entities.filter((entity) => entity.owner === PLAYER_OWNER)
      .map((entity) => entity.configId)
      .sort();
    expect(playerUnits).toEqual(fighters.map((fighter) => fighter.unitId).sort());
    expect(kernel!.getSnapshot().entities.length).toBeGreaterThan(playerUnits.length);
  });

  it("повтор собирает партию из журнала", () => {
    const deps = setup();
    const options = {
      units: deps.content.units,
      map: deps.content.pvp.map ?? deps.content.quickMatch.map,
      side1: deps.content.quickMatch.playerSlots,
      side2: deps.content.quickMatch.enemyPool,
      objective: "elimination" as const,
      seed: 7,
    };
    const journal = createReplayRecorder(options, "Бой").finish(1, "Бой");
    deps.session.startReplay(journal);
    expect(unitsOf({ ...deps, battleKind: "replay", replayJournal: journal }, PLAYER_OWNER)).toEqual(
      [...options.side1].sort(),
    );
  });
});
