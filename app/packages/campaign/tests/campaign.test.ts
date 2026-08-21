import { describe, expect, it } from "vitest";
import { createCampaign } from "../src/index.js";
import type { CampaignConfig } from "@bylina/content";

const MAP = {
  width: 12,
  height: 10,
  pitChance: 0.05,
  coverDensity: 0.07,
  wallDensity: 0.025,
  edgeCoverChance: 0.4,
  halfCoverChance: 0.55,
  heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
};

function purge(id: string, darknessOnVictory: number, darknessOnDefeat: number, count = 3) {
  return {
    id,
    type: "purge" as const,
    darknessOnVictory,
    darknessOnDefeat,
    map: MAP,
    enemies: [{ unitId: "upyr", count }],
  };
}

const CONFIG: CampaignConfig = {
  rosterCap: 8,
  deployMin: 1,
  deployMax: 5,
  classUnlockLevel: 2,
  woundHpRatio: 0.3,
  darknessMax: 20,
  needleMissionId: "needle",
  recruitUnitId: "recruit",
  initialRoster: ["bogatyr", "strelets", "znaharka"],
  woundPenalty: { aim: -15, defense: -10, mobility: -1 },
  missions: [purge("clearing_1", 2, 4), purge("clearing_2", 2, 4), purge("clearing_3", 2, 4)],
};

const UNIT_STATS = {
  bogatyr: { maxHealth: 12 },
  strelets: { maxHealth: 8 },
  znaharka: { maxHealth: 7 },
  recruit: { maxHealth: 6 },
  volkhv: { maxHealth: 7 },
};

function campaign(config: CampaignConfig = CONFIG) {
  return createCampaign(config, { unitStats: UNIT_STATS });
}

describe("createCampaign: points and darkness", () => {
  it("opens only the first point and starts with zero darkness", () => {
    const state = campaign().getState();
    expect(state.phase).toBe("active");
    expect(state.darkness).toBe(0);
    expect(state.activeMissionId).toBeNull();
    expect(state.missions.map((mission) => [mission.id, mission.status])).toEqual([
      ["clearing_1", "open"],
      ["clearing_2", "locked"],
      ["clearing_3", "locked"],
    ]);
  });

  it("refuses to start a locked mission or a second mission at once", () => {
    const automaton = campaign();
    expect(automaton.startMission("clearing_2")).toBe(false);
    expect(automaton.startMission("clearing_1")).toBe(true);
    expect(automaton.startMission("clearing_1")).toBe(false);
    expect(automaton.getState().activeMissionId).toBe("clearing_1");
  });

  it("applies victory darkness, marks the point done, and opens the next one", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    const result = automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
    expect(result).toMatchObject({ darknessGained: 2, campaignLost: false, fallen: [], wounded: [] });
    const state = automaton.getState();
    expect(state.darkness).toBe(2);
    expect(state.missions.map((mission) => [mission.id, mission.status])).toEqual([
      ["clearing_1", "done"],
      ["clearing_2", "open"],
      ["clearing_3", "locked"],
    ]);
  });

  it("defeat adds more darkness but does not end the campaign", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    const result = automaton.finishMission(
      "clearing_1",
      "defeat",
      fighters.map((fighterId) => ({ fighterId, survived: true, hp: 6 })),
    );
    expect(result).toMatchObject({ darknessGained: 4, campaignLost: false });
    expect(automaton.getState().phase).toBe("active");
    expect(automaton.getState().darkness).toBe(4);
  });

  it("finishing a mission that was not started is rejected", () => {
    const automaton = campaign();
    expect(automaton.finishMission("clearing_1", "victory", [])).toBeNull();
  });

  it("abandoning a mission returns to the map without consequences", () => {
    const automaton = campaign();
    automaton.startMission("clearing_1");
    automaton.abandonMission();
    const state = automaton.getState();
    expect(state.activeMissionId).toBeNull();
    expect(state.darkness).toBe(0);
    expect(automaton.startMission("clearing_1")).toBe(true);
  });

  it("loses the campaign when darkness reaches the maximum", () => {
    const automaton = campaign({ ...CONFIG, darknessMax: 4 });
    const fighters = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    expect(
      automaton.finishMission("clearing_1", "defeat", fighters.map((fighterId) => ({ fighterId, survived: true, hp: 5 }))),
    ).toMatchObject({ darknessGained: 4, campaignLost: true, lostReason: "darkness" });
    expect(automaton.getState().phase).toBe("lost");
  });

  it("notifies listeners on state changes", () => {
    const automaton = campaign();
    let calls = 0;
    automaton.subscribe(() => {
      calls += 1;
    });
    const fighters = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    automaton.finishMission("clearing_1", "victory", fighters.map((fighterId) => ({ fighterId, survived: true, hp: 10 })));
    automaton.abandonMission();
    expect(calls).toBe(2);
  });
});

describe("createCampaign: druzhina", () => {
  it("starts with the configured roster of classed fighters", () => {
    const state = campaign().getState();
    expect(state.fighters.map((fighter) => fighter.unitId).sort()).toEqual(["bogatyr", "strelets", "znaharka"]);
    expect(state.fighters.every((fighter) => fighter.alive && !fighter.wounded)).toBe(true);
    expect(state.fighters.every((fighter) => fighter.level === CONFIG.classUnlockLevel)).toBe(true);
    expect(state.fighters.map((fighter) => fighter.maxHp).sort((a, b) => a - b)).toEqual([7, 8, 12]);
  });

  it("marks fallen fighters as dead forever and excludes them from future missions", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    const result = automaton.finishMission("clearing_1", "victory", [
      { fighterId: fighters[0]!.id, survived: false, hp: 0 },
      { fighterId: fighters[1]!.id, survived: true, hp: 8 },
      { fighterId: fighters[2]!.id, survived: true, hp: 7 },
    ]);
    expect(result?.fallen).toEqual([fighters[0]!.name]);
    const state = automaton.getState();
    expect(state.fighters.find((fighter) => fighter.id === fighters[0]!.id)?.alive).toBe(false);
    expect(state.fighters.find((fighter) => fighter.id === fighters[0]!.id)?.hp).toBe(0);
    // Выжили двое из высадки; после победы вступил новый рекрут.
    expect(state.fighters.filter((fighter) => fighter.alive)).toHaveLength(3);
    expect(state.fighters.find((fighter) => fighter.unitId === "recruit")).toBeDefined();
  });

  it("wounds survivors whose hp is at or below the ratio threshold", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    const result = automaton.finishMission("clearing_1", "victory", [
      { fighterId: fighters[0]!.id, survived: true, hp: 4 }, // 4/12 ≤ 0.3 → ранение
      { fighterId: fighters[1]!.id, survived: true, hp: 3 }, // 3/8 = 0.375 > 0.3 → здоров
      { fighterId: fighters[2]!.id, survived: true, hp: 2 }, // 2/7 ≈ 0.29 ≤ 0.3 → ранение
    ]);
    expect(result?.wounded.sort()).toEqual([fighters[0]!.name, fighters[2]!.name].sort());
    const state = automaton.getState();
    expect(state.fighters.find((fighter) => fighter.id === fighters[0]!.id)?.wounded).toBe(true);
    expect(state.fighters.find((fighter) => fighter.id === fighters[1]!.id)?.wounded).toBe(false);
    expect(state.fighters.find((fighter) => fighter.id === fighters[2]!.id)?.wounded).toBe(true);
    expect(state.fighters.find((fighter) => fighter.id === fighters[0]!.id)?.hp).toBe(4);
  });

  it("levels up survivors on victory and does not on defeat", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    automaton.finishMission("clearing_1", "victory", fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })));
    // Исходные трое повысили уровень; рекрут-новобранец остаётся первого уровня.
    const ids = new Set(fighters.map((fighter) => fighter.id));
    expect(automaton.getState().fighters.filter((fighter) => ids.has(fighter.id)).every((fighter) => fighter.level === CONFIG.classUnlockLevel + 1)).toBe(true);

    automaton.startMission("clearing_2");
    automaton.finishMission("clearing_2", "defeat", automaton.getState().fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })));
    // Уровни не растут при поражении.
    expect(automaton.getState().fighters.filter((fighter) => ids.has(fighter.id)).every((fighter) => fighter.level === CONFIG.classUnlockLevel + 1)).toBe(true);
  });

  it("adds a new recruit after a victory while under the roster cap", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    const result = automaton.finishMission("clearing_1", "victory", fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })));
    expect(result?.newRecruit).toBeTruthy();
    const state = automaton.getState();
    expect(state.fighters).toHaveLength(4);
    const recruit = state.fighters.find((fighter) => fighter.unitId === "recruit");
    expect(recruit).toBeDefined();
    expect(recruit?.level).toBe(1);
    expect(recruit?.alive).toBe(true);
  });

  it("does not add a recruit after a defeat or at the roster cap", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    automaton.finishMission("clearing_1", "defeat", fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 6 })));
    expect(automaton.getState().fighters).toHaveLength(3);

    const full = campaign({ ...CONFIG, rosterCap: 3 });
    const fullFighters = full.getState().fighters;
    full.startMission("clearing_1");
    const result = full.finishMission("clearing_1", "victory", fullFighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })));
    expect(result?.newRecruit).toBeNull();
    expect(full.getState().fighters).toHaveLength(3);
  });

  it("heals a wounded fighter in the chamber", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    automaton.finishMission("clearing_1", "victory", [
      { fighterId: fighters[0]!.id, survived: true, hp: 3 },
      { fighterId: fighters[1]!.id, survived: true, hp: 8 },
      { fighterId: fighters[2]!.id, survived: true, hp: 7 },
    ]);
    const wounded = automaton.getState().fighters.find((fighter) => fighter.wounded)!;
    expect(automaton.healFighter(wounded.id)).toBe(true);
    const after = automaton.getState().fighters.find((fighter) => fighter.id === wounded.id)!;
    expect(after.wounded).toBe(false);
    expect(after.hp).toBe(after.maxHp);
    expect(automaton.healFighter(wounded.id)).toBe(false);
  });

  it("assigns a class to a recruit that reached the unlock level", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    automaton.finishMission("clearing_1", "victory", fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })));
    const recruit = automaton.getState().fighters.find((fighter) => fighter.unitId === "recruit")!;
    // Уровень 1 < 2: назначение недоступно.
    expect(automaton.assignClass(recruit.id, "volkhv")).toBe(false);

    // Проводим рекрута через ещё одну победу (уровень 2).
    const ids = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_2");
    automaton.finishMission("clearing_2", "victory", ids.map((fighterId) => ({ fighterId, survived: true, hp: 10 })));
    const trained = automaton.getState().fighters.find((fighter) => fighter.id === recruit.id)!;
    expect(trained.level).toBe(2);
    expect(automaton.assignClass(trained.id, "volkhv")).toBe(true);
    const after = automaton.getState().fighters.find((fighter) => fighter.id === recruit.id)!;
    expect(after.unitId).toBe("volkhv");
    expect(after.maxHp).toBe(7);
    expect(after.hp).toBe(7);
    // Повторное назначение невозможно.
    expect(automaton.assignClass(after.id, "bogatyr")).toBe(false);
  });

  it("loses the campaign when the whole roster falls", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    const result = automaton.finishMission(
      "clearing_1",
      "defeat",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: false, hp: 0 })),
    );
    expect(result).toMatchObject({ campaignLost: true, lostReason: "roster" });
    expect(automaton.getState().phase).toBe("lost");
    expect(automaton.startMission("clearing_2")).toBe(false);
  });

  it("does not add a recruit when the roster is gone", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    const result = automaton.finishMission("clearing_1", "victory", fighters.map((fighter) => ({ fighterId: fighter.id, survived: false, hp: 0 })));
    expect(result?.newRecruit).toBeNull();
  });

  it("exposes mission records in configuration order", () => {
    const automaton = campaign();
    expect(automaton.getMissions().map((mission) => mission.id)).toEqual(["clearing_1", "clearing_2", "clearing_3"]);
    expect(automaton.getMission("clearing_2")?.type).toBe("purge");
    expect(automaton.getMission("missing")).toBeUndefined();
  });
});
