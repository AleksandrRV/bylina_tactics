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

function purge(id: string, darknessOnVictory: number, darknessOnDefeat: number, count = 3, x = 20, y = 50) {
  return {
    id,
    type: "purge" as const,
    darknessOnVictory,
    darknessOnDefeat,
    x,
    y,
    rewards: { gold: 10, herbs: 3, artifacts: 1 },
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
  startingResources: { gold: 6, herbs: 3, artifacts: 0 },
  scan: { radius: 40, cost: { gold: 0, herbs: 1, artifacts: 0 } },
  missions: [
    purge("clearing_1", 2, 4, 3, 20, 50),
    purge("clearing_2", 2, 4, 3, 60, 50),
    purge("clearing_3", 2, 4, 3, 90, 50),
  ],
};

const ITEMS = [
  { id: "mace_of_trail", weaponId: "mace", cost: { gold: 12, herbs: 2, artifacts: 0 } },
  { id: "aim_charm", aimMod: 15, cost: { gold: 8, herbs: 3, artifacts: 0 } },
];

const UNIT_STATS = {
  bogatyr: { maxHealth: 12 },
  strelets: { maxHealth: 8 },
  znaharka: { maxHealth: 7 },
  recruit: { maxHealth: 6 },
  volkhv: { maxHealth: 7 },
};

function campaign(config: CampaignConfig = CONFIG, options: Parameters<typeof createCampaign>[1] = {}) {
  return createCampaign(config, { unitStats: UNIT_STATS, items: ITEMS, ...options });
}

describe("createCampaign: deployment limits", () => {
  it("reports deployMin and deployMax from the config", () => {
    expect(campaign().getDeployLimits()).toEqual({ min: 1, max: 5 });
    expect(campaign({ ...CONFIG, deployMin: 2, deployMax: 3 }).getDeployLimits()).toEqual({ min: 2, max: 3 });
  });
});

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
    // Точки открываются сканированием: clearing_2 в радиусе 40 от (20,50).
    expect(state.missions.map((mission) => [mission.id, mission.status])).toEqual([
      ["clearing_1", "done"],
      ["clearing_2", "locked"],
      ["clearing_3", "locked"],
    ]);
    const scan = automaton.scan();
    expect(scan?.opened).toEqual(["clearing_2"]);
    expect(automaton.getState().missions.map((mission) => [mission.id, mission.status])).toEqual([
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
      automaton.finishMission(
        "clearing_1",
        "defeat",
        fighters.map((fighterId) => ({ fighterId, survived: true, hp: 5 })),
      ),
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
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
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
      { fighterId: fighters[0]!.id, survived: true, hp: 4 }, // 4/12 = 0.333 > 0.3 → здоров (порог без округления)
      { fighterId: fighters[1]!.id, survived: true, hp: 2 }, // 2/8 = 0.25 ≤ 0.3 → ранение
      { fighterId: fighters[2]!.id, survived: true, hp: 2 }, // 2/7 ≈ 0.286 ≤ 0.3 → ранение
    ]);
    expect(result?.wounded.sort()).toEqual([fighters[1]!.name, fighters[2]!.name].sort());
    const state = automaton.getState();
    expect(state.fighters.find((fighter) => fighter.id === fighters[0]!.id)?.wounded).toBe(false);
    expect(state.fighters.find((fighter) => fighter.id === fighters[1]!.id)?.wounded).toBe(true);
    expect(state.fighters.find((fighter) => fighter.id === fighters[2]!.id)?.wounded).toBe(true);
    expect(state.fighters.find((fighter) => fighter.id === fighters[0]!.id)?.hp).toBe(4);
  });

  it("levels up survivors on victory and does not on defeat", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
    // Исходные трое повысили уровень; рекрут-новобранец остаётся первого уровня.
    const ids = new Set(fighters.map((fighter) => fighter.id));
    expect(
      automaton
        .getState()
        .fighters.filter((fighter) => ids.has(fighter.id))
        .every((fighter) => fighter.level === CONFIG.classUnlockLevel + 1),
    ).toBe(true);

    automaton.scan();
    automaton.startMission("clearing_2");
    automaton.finishMission(
      "clearing_2",
      "defeat",
      automaton.getState().fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
    // Уровни не растут при поражении.
    expect(
      automaton
        .getState()
        .fighters.filter((fighter) => ids.has(fighter.id))
        .every((fighter) => fighter.level === CONFIG.classUnlockLevel + 1),
    ).toBe(true);
  });

  it("adds a new recruit after a victory while under the roster cap", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    const result = automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
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
    automaton.finishMission(
      "clearing_1",
      "defeat",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 6 })),
    );
    expect(automaton.getState().fighters).toHaveLength(3);

    const full = campaign({ ...CONFIG, rosterCap: 3 });
    const fullFighters = full.getState().fighters;
    full.startMission("clearing_1");
    const result = full.finishMission(
      "clearing_1",
      "victory",
      fullFighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
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
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
    const recruit = automaton.getState().fighters.find((fighter) => fighter.unitId === "recruit")!;
    // Уровень 1 < 2: назначение недоступно.
    expect(automaton.assignClass(recruit.id, "volkhv")).toBe(false);

    // Проводим рекрута через ещё одну победу (уровень 2).
    const ids = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.scan();
    automaton.startMission("clearing_2");
    automaton.finishMission(
      "clearing_2",
      "victory",
      ids.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
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

  it("rejects assigning a class outside the configured class list (0.19.2)", () => {
    const automaton = campaign(CONFIG, { classUnitIds: ["bogatyr", "strelets", "znaharka", "volkhv"] });
    const fighters = automaton.getState().fighters;
    // Две победы доводят рекрута до уровня 2 (classUnlockLevel).
    automaton.startMission("clearing_1");
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
    const ids = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.scan();
    automaton.startMission("clearing_2");
    automaton.finishMission(
      "clearing_2",
      "victory",
      ids.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
    const recruit = automaton.getState().fighters.find((fighter) => fighter.unitId === "recruit")!;
    expect(recruit.level).toBe(2);
    // Чужая/несуществующая запись отклоняется перечнем допустимых классов.
    expect(automaton.assignClass(recruit.id, "upyr")).toBe(false);
    expect(automaton.assignClass(recruit.id, "missing_class")).toBe(false);
    expect(automaton.assignClass(recruit.id, "volkhv")).toBe(true);
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
    const result = automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: false, hp: 0 })),
    );
    expect(result?.newRecruit).toBeNull();
  });

  it("exposes mission records in configuration order", () => {
    const automaton = campaign();
    expect(automaton.getMissions().map((mission) => mission.id)).toEqual(["clearing_1", "clearing_2", "clearing_3"]);
    expect(automaton.getMission("clearing_2")?.type).toBe("purge");
    expect(automaton.getMission("missing")).toBeUndefined();
  });
});

describe("createCampaign: хозяйство 0.12", () => {
  it("grants mission rewards on victory and none on defeat", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    const result = automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
    expect(result?.rewards).toEqual({ gold: 10, herbs: 3, artifacts: 1 });
    expect(automaton.getState().resources).toEqual({ gold: 16, herbs: 6, artifacts: 1 });

    // Сканирование расходует 1 траву: 3 + 3 − 1 = 5.
    automaton.scan();
    automaton.startMission("clearing_2");
    const lost = automaton.finishMission(
      "clearing_2",
      "defeat",
      automaton.getState().fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
    expect(lost?.rewards).toEqual({ gold: 0, herbs: 0, artifacts: 0 });
    expect(automaton.getState().resources).toEqual({ gold: 16, herbs: 5, artifacts: 1 });
  });

  it("moves the ship to the finished mission point", () => {
    const automaton = campaign();
    expect(automaton.getState().shipPosition).toEqual({ x: 20, y: 50 });
    const fighters = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
    expect(automaton.getState().shipPosition).toEqual({ x: 20, y: 50 });
    automaton.scan();
    automaton.startMission("clearing_2");
    automaton.finishMission(
      "clearing_2",
      "victory",
      automaton.getState().fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
    expect(automaton.getState().shipPosition).toEqual({ x: 60, y: 50 });
  });

  it("scan opens only points within the configured radius and charges the cost", () => {
    const automaton = campaign();
    // До сканирования запасы { gold 6, herbs 3 }; стоимость — 1 трава.
    const scan = automaton.scan();
    expect(scan).toEqual({ cost: { gold: 0, herbs: 1, artifacts: 0 }, opened: ["clearing_2"] });
    expect(automaton.getState().resources.herbs).toBe(2);
    // clearing_3 (90,50) вне радиуса 40 от (20,50).
    expect(automaton.getState().missions[2]?.status).toBe("locked");
    // Сканирование недопустимо при нехватке трав.
    const poor = campaign({ ...CONFIG, startingResources: { gold: 6, herbs: 0, artifacts: 0 } });
    expect(poor.scan()).toBeNull();
  });

  it("does not charge the cost when the scan opens nothing (0.19.2)", () => {
    const automaton = campaign();
    // Первое сканирование открывает clearing_2 за 1 траву.
    expect(automaton.scan()?.opened).toEqual(["clearing_2"]);
    expect(automaton.getState().resources.herbs).toBe(2);
    // Корабль у (20,50): clearing_2 уже открыта, clearing_3 (90,50) вне
    // радиуса 40 — повторное сканирование не открывает точек и запасы
    // не списывает.
    expect(automaton.scan()).toBeNull();
    expect(automaton.getState().resources.herbs).toBe(2);
  });

  it("crafts items from configuration once, consuming resources", () => {
    const automaton = campaign();
    // Запасы { gold 6, herbs 3 }: оберег меткости стоит 8/3 — не хватает золота.
    expect(automaton.craftItem("aim_charm")).toBe(false);
    const fighters = automaton.getState().fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
    // Запасы { gold 16, herbs 6, artifacts 1 }.
    expect(automaton.craftItem("aim_charm")).toBe(true);
    expect(automaton.getState().resources).toEqual({ gold: 8, herbs: 3, artifacts: 1 });
    expect(automaton.getState().inventory).toEqual(["aim_charm"]);
    // Повторная ковка невозможна.
    expect(automaton.craftItem("aim_charm")).toBe(false);
    // Неизвестный предмет.
    expect(automaton.craftItem("missing_item")).toBe(false);
    // Палица тракта стоит 12 золота — после оберега (16 − 8 = 8) не хватает.
    expect(automaton.craftItem("mace_of_trail")).toBe(false);
    // Вторая победа: +10 золота, −1 трава за сканирование.
    automaton.scan();
    automaton.startMission("clearing_2");
    automaton.finishMission(
      "clearing_2",
      "victory",
      automaton.getState().fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
    expect(automaton.craftItem("mace_of_trail")).toBe(true);
    expect(automaton.getState().inventory).toEqual(["aim_charm", "mace_of_trail"]);
  });

  it("equips and unequips a crafted item on a fighter", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    const bogatyr = fighters[0]!;
    // Нельзя надеть несуществующий предмет.
    expect(automaton.equipItem(bogatyr.id, "aim_charm")).toBe(false);
    const ids = fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    automaton.finishMission(
      "clearing_1",
      "victory",
      ids.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
    automaton.craftItem("aim_charm");
    expect(automaton.equipItem(bogatyr.id, "aim_charm")).toBe(true);
    expect(automaton.getState().fighters.find((fighter) => fighter.id === bogatyr.id)?.equippedItemId).toBe(
      "aim_charm",
    );
    // Предмет единственный: второй боец надеть не может.
    expect(automaton.equipItem(fighters[1]!.id, "aim_charm")).toBe(false);
    // Снятие.
    expect(automaton.equipItem(bogatyr.id, null)).toBe(true);
    expect(automaton.getState().fighters.find((fighter) => fighter.id === bogatyr.id)?.equippedItemId).toBeNull();
    // Снятие без предмета отклоняется.
    expect(automaton.equipItem(bogatyr.id, null)).toBe(false);
  });

  it("exposes craftable items in configuration order", () => {
    const automaton = campaign();
    expect(automaton.getItems().map((item) => item.id)).toEqual(["mace_of_trail", "aim_charm"]);
  });
});

describe("createCampaign: снаряжение и гибель", () => {
  it("returns a fallen fighter's equipment to the ship supply", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    const ids = fighters.map((fighter) => fighter.id);
    automaton.startMission("clearing_1");
    automaton.finishMission(
      "clearing_1",
      "victory",
      ids.map((fighterId) => ({ fighterId, survived: true, hp: 10 })),
    );
    automaton.craftItem("aim_charm");
    automaton.equipItem(fighters[0]!.id, "aim_charm");

    automaton.scan();
    automaton.startMission("clearing_2");
    automaton.finishMission("clearing_2", "defeat", [
      { fighterId: fighters[0]!.id, survived: false, hp: 0 },
      { fighterId: fighters[1]!.id, survived: true, hp: 8 },
      { fighterId: fighters[2]!.id, survived: true, hp: 7 },
    ]);
    const fallen = automaton.getState().fighters.find((fighter) => fighter.id === fighters[0]!.id)!;
    expect(fallen.alive).toBe(false);
    expect(fallen.equippedItemId).toBeNull();
    // Предмет снова доступен для надевания.
    expect(automaton.equipItem(fighters[1]!.id, "aim_charm")).toBe(true);
  });
});

describe("generals in campaign (0.18.0)", () => {
  it("a general that died is excluded from later missions", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    // Миссия без генералов — generalDeaths пуст; затем имитируем гибель Яги.
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((f) => ({ fighterId: f.id, survived: true, hp: 10 })),
      ["baba_yaga"],
    );
    expect(automaton.getState().deadGenerals).toContain("baba_yaga");
  });

  it("a general that fled is not marked dead and may return", () => {
    const automaton = campaign();
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((f) => ({ fighterId: f.id, survived: true, hp: 10 })),
      [],
    );
    expect(automaton.getState().deadGenerals).toEqual([]);
  });
});

describe("createCampaign: chapter prologue (0.20.31)", () => {
  it("defaults chapter to open", () => {
    expect(campaign().getState().chapter).toBe("open");
  });

  it("disables darkness, rewards, wounds, permanent death and recruit in prologue", () => {
    const automaton = campaign(CONFIG, { chapter: "prologue" });
    expect(automaton.getState().chapter).toBe("prologue");
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    const result = automaton.finishMission(
      "clearing_1",
      "victory",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 1 })),
    );
    expect(result).not.toBeNull();
    expect(automaton.getState().darkness).toBe(0);
    expect(automaton.getState().resources).toEqual(CONFIG.startingResources);
    for (const fighter of automaton.getState().fighters) {
      expect(fighter.wounded).toBe(false);
      expect(fighter.level).toBe(CONFIG.classUnlockLevel);
    }
    expect(automaton.getState().fighters.length).toBe(fighters.length);
  });

  it("keeps a fallen fighter alive in prologue", () => {
    const automaton = campaign(CONFIG, { chapter: "prologue" });
    const fighters = automaton.getState().fighters;
    automaton.startMission("clearing_1");
    automaton.finishMission("clearing_1", "defeat", [
      { fighterId: fighters[0]!.id, survived: false, hp: 0 },
      { fighterId: fighters[1]!.id, survived: true, hp: 6 },
      { fighterId: fighters[2]!.id, survived: true, hp: 7 },
    ]);
    expect(automaton.getState().fighters.find((fighter) => fighter.id === fighters[0]!.id)?.alive).toBe(true);
    expect(automaton.getState().phase).toBe("active");
  });

  it("migrates a saved state without chapter to open", () => {
    const base = campaign().getState();
    const legacy = { ...base } as Record<string, unknown>;
    delete legacy.chapter;
    const restored = campaign(CONFIG, { initialState: legacy as never });
    expect(restored.getState().chapter).toBe("open");
  });
});

describe("createCampaign: sandbox after prologue (0.20.35)", () => {
  const UNIT_STATS_PROLOGUE = {
    ...UNIT_STATS,
    mikula_peasant: { maxHealth: 8 },
    fedot_stranded: { maxHealth: 5 },
    vasilisa: { maxHealth: 7 },
  };

  function prologueCampaign(finalId = "clearing_1") {
    return createCampaign(CONFIG, {
      unitStats: UNIT_STATS_PROLOGUE,
      items: ITEMS,
      chapter: "prologue",
      prologueFinalMissionId: finalId,
      initialState: {
        chapter: "prologue",
        darkness: 0,
        darknessMax: 20,
        phase: "active",
        resources: { gold: 0, herbs: 0, artifacts: 0 },
        inventory: [],
        shipPosition: { x: 20, y: 50 },
        missions: [
          { id: "clearing_1", status: "open" },
          { id: "clearing_2", status: "open" },
          { id: "clearing_3", status: "locked" },
        ],
        fighters: [
          {
            id: 1,
            name: "Микула",
            unitId: "mikula_peasant",
            level: 2,
            hp: 8,
            maxHp: 8,
            wounded: false,
            alive: true,
            equippedItemId: null,
            xp: 0,
          },
          {
            id: 2,
            name: "Федот",
            unitId: "fedot_stranded",
            level: 1,
            hp: 5,
            maxHp: 5,
            wounded: false,
            alive: true,
            equippedItemId: null,
            xp: 0,
          },
          {
            id: 3,
            name: "Василиса",
            unitId: "vasilisa",
            level: 1,
            hp: 7,
            maxHp: 7,
            wounded: false,
            alive: true,
            equippedItemId: null,
            xp: 0,
          },
        ],
        deadGenerals: [],
        activeMissionId: null,
        lastResult: null,
      },
    });
  }

  it("opens sandbox after the configured final prologue mission", () => {
    const automaton = prologueCampaign("clearing_1");
    automaton.startMission("clearing_1");
    const result = automaton.finishMission("clearing_1", "victory", [
      { fighterId: 1, survived: true, hp: 8 },
      { fighterId: 2, survived: true, hp: 5 },
      { fighterId: 3, survived: true, hp: 7 },
    ]);
    expect(result?.darknessGained).toBe(0);
    const after = automaton.getState();
    expect(after.chapter).toBe("open");
    expect(after.fighters.map((fighter) => fighter.unitId)).toEqual(["bogatyr", "strelets", "znaharka"]);
    expect(after.fighters[0]?.name).toBe("Микула");
    expect(after.fighters[0]?.level).toBe(2);
    expect(after.resources).toEqual(CONFIG.startingResources);
    expect(after.darkness).toBe(0);
    expect(after.missions[0]?.status).toBe("done");
  });

  it("does not open sandbox before the configured final mission", () => {
    const automaton = prologueCampaign("clearing_2");
    automaton.startMission("clearing_1");
    automaton.finishMission("clearing_1", "victory", [
      { fighterId: 1, survived: true, hp: 8 },
      { fighterId: 2, survived: true, hp: 5 },
      { fighterId: 3, survived: true, hp: 7 },
    ]);
    expect(automaton.getState().chapter).toBe("prologue");
    automaton.startMission("clearing_2");
    automaton.finishMission("clearing_2", "victory", [
      { fighterId: 1, survived: true, hp: 8 },
      { fighterId: 2, survived: true, hp: 5 },
      { fighterId: 3, survived: true, hp: 7 },
    ]);
    expect(automaton.getState().chapter).toBe("open");
  });

  it("applies sandbox economy only after the transition", () => {
    const automaton = prologueCampaign("clearing_1");
    automaton.startMission("clearing_1");
    automaton.finishMission("clearing_1", "victory", [
      { fighterId: 1, survived: true, hp: 8 },
      { fighterId: 2, survived: true, hp: 5 },
      { fighterId: 3, survived: true, hp: 7 },
    ]);
    expect(automaton.getState().darkness).toBe(0);
    automaton.scan();
    automaton.startMission("clearing_2");
    const result = automaton.finishMission("clearing_2", "victory", [
      { fighterId: 1, survived: true, hp: 12 },
      { fighterId: 2, survived: true, hp: 8 },
      { fighterId: 3, survived: true, hp: 7 },
    ]);
    expect(result?.darknessGained).toBe(2);
    expect(automaton.getState().darkness).toBe(2);
    expect(automaton.getState().resources.gold).toBeGreaterThan(CONFIG.startingResources.gold);
  });

  it("openSandboxFromPrologue is idempotent once the chapter is open", () => {
    const automaton = prologueCampaign();
    expect(automaton.openSandboxFromPrologue()).toBe(true);
    expect(automaton.openSandboxFromPrologue()).toBe(false);
    expect(automaton.getState().chapter).toBe("open");
  });

  it("blocks scan and craft while chapter is prologue", () => {
    const automaton = prologueCampaign();
    expect(automaton.scan()).toBeNull();
    expect(automaton.craftItem("aim_charm")).toBe(false);
  });
});
