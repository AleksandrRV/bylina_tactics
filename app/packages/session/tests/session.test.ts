import { describe, expect, it } from "vitest";
import {
  DEBUG_BOW,
  createDebugMatch,
  createTacticsKernel,
} from "@bylina/core";
import { createCampaign } from "@bylina/campaign";
import type { CampaignConfig } from "@bylina/content";
import { APP_VERSION, createSession } from "../src/index.js";

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

const CAMPAIGN_CONFIG: CampaignConfig = {
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
    {
      id: "clearing_1",
      type: "purge",
      darknessOnVictory: 2,
      darknessOnDefeat: 4,
      x: 20,
      y: 50,
      rewards: { gold: 10, herbs: 3, artifacts: 0 },
      map: MAP,
      enemies: [{ unitId: "upyr", count: 3 }],
    },
    {
      id: "clearing_2",
      type: "purge",
      darknessOnVictory: 2,
      darknessOnDefeat: 4,
      x: 60,
      y: 50,
      rewards: { gold: 10, herbs: 3, artifacts: 0 },
      map: MAP,
      enemies: [{ unitId: "upyr", count: 3 }],
    },
  ],
};

const UNIT_STATS = {
  bogatyr: { maxHealth: 12 },
  strelets: { maxHealth: 8 },
  znaharka: { maxHealth: 7 },
  recruit: { maxHealth: 6 },
};

function campaign(config: CampaignConfig = CAMPAIGN_CONFIG) {
  return createCampaign(config, { unitStats: UNIT_STATS });
}

describe("createSession", () => {
  it("starts on the boot screen", () => {
    expect(createSession().get().screen).toBe("boot");
  });

  it("reports version 0.20.5", () => {
    expect(APP_VERSION).toBe("0.20.5");
  });

  it("moves between menu and settings", () => {
    const session = createSession("menu");
    session.goTo("settings");
    expect(session.get().screen).toBe("settings");
    session.goTo("menu");
    expect(session.get().screen).toBe("menu");
  });

  it("opens the pvp room from the menu (mode is available since 0.14.0)", () => {
    const session = createSession("menu");
    session.openMode("pvp");
    expect(session.get().screen).toBe("pvpRoom");
  });

  it("is the only UI gateway that applies battle commands", () => {
    const session = createSession("menu");
    const host = createTacticsKernel();
    session.bindTacticsHost(host);
    expect(session.applyBattleCommand({ type: "END_TURN", playerId: "1" }).ok).toBe(false);
    session.openQuickMatch();
    session.selectDifficulty("easy");
    expect(session.applyBattleCommand({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    expect(session.getBattleSnapshot(1).activeOwner).toBe(2);
  });

  it("opens quick match difficulty and starts a battle", () => {
    const session = createSession("menu");
    session.openQuickMatch();
    expect(session.get().screen).toBe("difficulty");
    session.selectDifficulty("hard");
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("quick");
    expect(session.get().difficulty).toBe("hard");
    session.finishMatch("victory");
    expect(session.get().screen).toBe("result");
    expect(session.get().outcome).toBe("victory");
    session.playAgain();
    expect(session.get().screen).toBe("difficulty");
  });

  it("opens the campaign map from the menu", () => {
    const session = createSession("menu");
    session.bindCampaign(campaign());
    session.openCampaign();
    expect(session.get().screen).toBe("campaign");
  });

  it("starts a mission into deployment and confirms a squad", () => {
    const session = createSession("menu");
    session.bindCampaign(campaign());
    session.openCampaign();
    expect(session.startCampaignMission("clearing_1")).toBe(true);
    expect(session.get().screen).toBe("deployment");
    expect(session.get().battleKind).toBe("campaign");
    expect(session.get().activeMissionId).toBe("clearing_1");

    const fighters = session.getCampaign().getState().fighters;
    const ids = fighters.map((fighter) => fighter.id);
    expect(session.confirmDeployment(ids)).toBe(true);
    expect(session.get().screen).toBe("battle");
    expect(session.get().deployment).toEqual(ids);

    // Нельзя подтвердить высадку с погибшим или пустую.
    session.leaveCampaignMission();
    session.startCampaignMission("clearing_1");
    expect(session.confirmDeployment([])).toBe(false);
    expect(session.confirmDeployment([999])).toBe(false);
  });

  it("enforces deployMin and deployMax from the campaign config", () => {
    const session = createSession("menu");
    session.bindCampaign(campaign({ ...CAMPAIGN_CONFIG, deployMin: 2, deployMax: 2 }));
    session.openCampaign();
    session.startCampaignMission("clearing_1");
    const fighters = session.getCampaign().getState().fighters;
    const ids = fighters.map((fighter) => fighter.id);

    // Меньше deployMin — отклоняется.
    expect(session.confirmDeployment([ids[0]!])).toBe(false);
    expect(session.get().screen).toBe("deployment");
    // Больше deployMax — отклоняется.
    expect(session.confirmDeployment(ids)).toBe(false);
    // В границах конфигурации — принимается.
    expect(session.confirmDeployment(ids.slice(0, 2))).toBe(true);
    expect(session.get().screen).toBe("battle");
    expect(session.get().deployment).toEqual(ids.slice(0, 2));
  });

  it("rejects starting a locked mission", () => {
    const session = createSession("menu");
    session.bindCampaign(campaign());
    session.openCampaign();
    expect(session.startCampaignMission("clearing_2")).toBe(false);
    expect(session.get().screen).toBe("campaign");
  });

  it("abandoning a mission returns to the map without consequences", () => {
    const session = createSession("menu");
    session.bindCampaign(campaign());
    session.openCampaign();
    session.startCampaignMission("clearing_1");
    session.leaveCampaignMission();
    expect(session.get().screen).toBe("campaign");
    expect(session.getCampaign().getState().darkness).toBe(0);
    expect(session.getCampaign().getState().missions[0]?.status).toBe("open");
  });

  it("finishes a mission with participants and grows darkness", () => {
    const session = createSession("menu");
    session.bindCampaign(campaign());
    session.openCampaign();
    session.startCampaignMission("clearing_1");
    const fighters = session.getCampaign().getState().fighters;
    session.confirmDeployment(fighters.map((fighter) => fighter.id));

    const host = createTacticsKernel({
      weapons: {
        [DEBUG_BOW.id]: { ...DEBUG_BOW, minDmg: 20, maxDmg: 20, aimMod: 100, crit: 0, critBonus: 0 },
      },
      initial: createDebugMatch(),
      seed: 1,
    });
    session.bindTacticsHost(host);

    const attack = session.applyBattleCommand({ type: "ATTACK", actorId: 1, targetId: 4, weaponId: DEBUG_BOW.id });
    expect(attack.ok).toBe(true);
    expect(attack.ok && attack.events.some((event) => event.type === "MATCH_ENDED" && event.winnerPlayerId === "1")).toBe(true);
    expect(session.getBattleOutcome()).toBe("victory");

    const result = session.finishCampaignMission(
      "victory",
      fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 10 })),
    );
    expect(result).toMatchObject({ darknessGained: 2, campaignLost: false });
    expect(session.get().screen).toBe("missionResult");
    // Следующая точка открывается сканированием корабля.
    expect(session.getCampaign().getState().missions.map((point) => point.status)).toEqual(["done", "locked"]);
    const scan = session.getCampaign().scan();
    expect(scan?.opened).toEqual(["clearing_2"]);
    session.backToCampaign();
    expect(session.get().screen).toBe("campaign");
  });

  it("loses the campaign when darkness reaches the maximum", () => {
    const session = createSession("menu");
    session.bindCampaign(campaign({ ...CAMPAIGN_CONFIG, darknessMax: 4 }));
    session.openCampaign();
    session.startCampaignMission("clearing_1");
    const fighters = session.getCampaign().getState().fighters;
    session.confirmDeployment(fighters.map((fighter) => fighter.id));
    expect(
      session.finishCampaignMission("defeat", fighters.map((fighter) => ({ fighterId: fighter.id, survived: true, hp: 5 }))),
    ).toMatchObject({ darknessGained: 4, campaignLost: true });
    expect(session.getCampaign().getState().phase).toBe("lost");
    expect(session.startCampaignMission("clearing_2")).toBe(false);
  });
});

describe("createSession debug auto win", () => {
  it("instantly wins the battle and reports the victory outcome", () => {
    const session = createSession("menu");
    session.openQuickMatch();
    session.selectDifficulty("easy");
    const host = createTacticsKernel();
    session.bindTacticsHost(host);
    const result = session.debugAutoWinBattle();
    expect(result.ok).toBe(true);
    expect(result.ok && result.events.some((event) => event.type === "MATCH_ENDED" && event.winnerPlayerId === "1")).toBe(true);
    expect(session.getBattleOutcome()).toBe("victory");
  });

  it("rejects the debug command outside a battle", () => {
    const session = createSession("menu");
    expect(session.debugAutoWinBattle()).toEqual({ ok: false, reason: "ILLEGAL" });
  });
});

describe("createSession restored save (0.13.0)", () => {
  it("restores a campaign battle screen from the saved state", () => {
    const session = createSession("battle", {
      battleKind: "campaign",
      activeMissionId: "clearing_1",
      deployment: [1, 2],
      matchSeed: 7,
      outcome: null,
      difficulty: null,
      paused: false,
    });
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("campaign");
    expect(session.get().activeMissionId).toBe("clearing_1");
    expect(session.get().deployment).toEqual([1, 2]);
    expect(session.get().matchSeed).toBe(7);
  });

  it("keeps the restored battle in the session state for the battle screen", () => {
    const match = createDebugMatch();
    const session = createSession("battle", { battleKind: "campaign", restoredMatch: match });
    // Идемпотентное чтение: повторный вызов инициализатора (StrictMode)
    // не теряет восстановленный снимок.
    expect(session.get().restoredMatch).toBe(match);
    expect(session.get().restoredMatch).toBe(match);
  });

  it("drops the restored battle when leaving the battle screen", () => {
    const match = createDebugMatch();
    const session = createSession("battle", { battleKind: "campaign", restoredMatch: match });
    session.goTo("menu");
    expect(session.get().restoredMatch).toBeUndefined();
  });
});

describe("createSession pvp (0.14.0)", () => {
  function pvpSession() {
    const session = createSession("menu");
    session.openPvpRoom();
    expect(session.get().screen).toBe("pvpRoom");
    session.startPvpBattle(["bogatyr", "strelets"], ["bogatyr", "strelets"], 42);
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("pvp");
    expect(session.getPvpSides()).toEqual({ side1: ["bogatyr", "strelets"], side2: ["bogatyr", "strelets"] });
    return session;
  }

  it("routes commands through the local transport and delivers event batches", async () => {
    const session = pvpSession();
    const host = createTacticsKernel({
      initial: {
        turnNumber: 1,
        activeOwner: 1,
        grid: { width: 8, height: 6, tiles: Array.from({ length: 48 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), z: 1, pit: false, blockLOS: false })) },
        entities: [
          { id: 1, configId: "bogatyr", owner: 1, x: 1, y: 2, z: 1, dir: 1, ap: 2, maxAp: 2, mobility: 5, hp: 12, maxHp: 12, aim: 70, defense: 10, will: 40, vision: 12, weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false, coverType: 0, overwatch: false, defending: false, movementSpent: 0 },
          { id: 11, configId: "bogatyr", owner: 2, x: 6, y: 2, z: 1, dir: 3, ap: 2, maxAp: 2, mobility: 5, hp: 12, maxHp: 12, aim: 70, defense: 10, will: 40, vision: 12, weaponId: "sword", weaponIds: ["sword"], skillIds: [], obstacle: true, dead: false, flying: false, coverType: 0, overwatch: false, defending: false, movementSpent: 0 },
        ],
      },
    });
    session.bindTacticsHost(host);

    const events: unknown[] = [];
    const unlisten = session.subscribePvpEvents((batch) => events.push(batch));

    // Ход стороны 1: завершение хода уходит через транспорт, ядро переключает сторону.
    session.sendPvpCommand({ type: "END_TURN", playerId: "1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.getSnapshot().activeOwner).toBe(2);
    expect(events.length).toBe(1);

    // Ход стороны 2.
    session.sendPvpCommand({ type: "END_TURN", playerId: "2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.getSnapshot().activeOwner).toBe(1);
    expect(events.length).toBe(2);
    unlisten();
  });

  it("finishes a pvp match with the winning side", () => {
    const session = pvpSession();
    session.finishPvpMatch(2);
    expect(session.get().screen).toBe("result");
    expect(session.get().pvpWinner).toBe(2);
    expect(session.get().outcome).toBe("defeat");
  });
});

describe("createSession training (0.19.0)", () => {
  it("opens the training screen and starts a mission", () => {
    const session = createSession("menu");
    session.openTraining();
    expect(session.get().screen).toBe("training");
    expect(session.startTrainingMission("combat")).toBe(true);
    expect(session.get().screen).toBe("trainingBattle");
    expect(session.get().battleKind).toBe("training");
    expect(session.get().trainingMissionId).toBe("combat");
  });

  it("rejects an unknown training mission and tracks completion", () => {
    const session = createSession("menu");
    expect(session.startTrainingMission("unknown")).toBe(false);
    session.openTraining();
    session.startTrainingMission("movement");
    session.completeTrainingMission("movement");
    expect(session.get().trainingDone).toContain("movement");
  });
});

describe("createSession training hints (0.19.0)", () => {
  it("completing the mission records progress once", () => {
    const session = createSession("menu");
    session.openTraining();
    session.startTrainingMission("skills");
    session.completeTrainingMission("skills");
    session.completeTrainingMission("skills");
    expect(session.get().trainingDone).toEqual(["skills"]);
  });

  it("keeps training progress across navigation (0.19.1)", () => {
    // Регрессия: переходы между экранами не должны сбрасывать пройденные
    // миссии — раньше goTo() затирал trainingDone через фоновое состояние.
    const session = createSession("menu");
    session.openTraining();
    session.startTrainingMission("movement");
    session.completeTrainingMission("movement");
    session.goTo("training");
    expect(session.get().trainingDone).toContain("movement");
    session.goTo("menu");
    expect(session.get().trainingDone).toContain("movement");
    session.openTraining();
    session.startTrainingMission("combat");
    session.completeTrainingMission("combat");
    session.goTo("training");
    expect(session.get().trainingDone).toEqual(["movement", "combat"]);
  });
});

describe("createSession campaign hints (0.20.0)", () => {
  it("marks a campaign hint as shown exactly once", () => {
    const session = createSession("menu");
    expect(session.isCampaignHintShown("scan")).toBe(false);
    session.markCampaignHintShown("scan");
    expect(session.isCampaignHintShown("scan")).toBe(true);
    session.markCampaignHintShown("scan");
    expect(session.get().campaignHintsDone).toEqual(["scan"]);
  });

  it("keeps shown campaign hints across navigation", () => {
    const session = createSession("menu");
    session.markCampaignHintShown("darkness");
    session.goTo("menu");
    session.openMode("campaign");
    expect(session.isCampaignHintShown("darkness")).toBe(true);
    expect(session.get().campaignHintsDone).toEqual(["darkness"]);
  });
});
