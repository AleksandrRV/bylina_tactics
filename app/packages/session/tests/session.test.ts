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

  it("reports version 0.20.47", () => {
    expect(APP_VERSION).toBe("0.20.47");
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
    // Один и тот же боец не может занимать две позиции высадки.
    expect(session.confirmDeployment([ids[0]!, ids[0]!])).toBe(false);
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

describe("createSession battle checkpoint (0.20.32)", () => {
  it("restores the snapshot without recording replay commands", () => {
    const session = createSession("menu");
    session.openQuickMatch();
    session.selectDifficulty("easy");
    const host = createTacticsKernel({ initial: createDebugMatch(), seed: 2 });
    session.bindTacticsHost(host);
    expect(session.saveBattleCheckpoint()).toBe(true);
    const before = host.getSnapshot();
    session.applyBattleCommand({ type: "END_TURN", playerId: "1" });
    expect(host.getSnapshot().activeOwner).not.toBe(before.activeOwner);
    const draftBefore = session.getReplayDraft();
    expect(session.restoreBattleCheckpoint()).toBe(true);
    expect(host.getSnapshot().activeOwner).toBe(before.activeOwner);
    expect(session.getReplayDraft()).toEqual(draftBefore);
  });
});

describe("createSession prologue route (0.20.31)", () => {
  it("does not start the prologue when the feature flag is off", () => {
    const session = createSession("menu");
    expect(session.startPrologue("prologue_brushwood", false)).toBe(false);
    expect(session.get().prologueMissionId ?? null).toBeNull();
    expect(session.get().screen).toBe("menu");
  });

  it("records the prologue mission id when enabled", () => {
    const session = createSession("menu");
    expect(session.startPrologue("prologue_brushwood", true)).toBe(true);
    expect(session.get().prologueMissionId).toBe("prologue_brushwood");
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("prologue");
  });

  it("opens the next prologue mission as a new battle (0.20.38)", () => {
    const session = createSession("menu");
    session.startPrologue("prologue_brushwood", true);
    const first = session.get().battleEpoch ?? 0;
    expect(first).toBeGreaterThan(0);
    // Переход «итог миссии → следующая миссия» не покидает экран боя:
    // эпоха обязана прирасти, иначе экран продолжит прежнюю партию.
    session.advancePrologue("prologue_cry");
    expect(session.get().screen).toBe("battle");
    expect(session.get().prologueMissionId).toBe("prologue_cry");
    expect(session.get().battleEpoch ?? 0).toBe(first + 1);
  });

  it("opens a repeated prologue mission as a new battle (0.20.38)", () => {
    const session = createSession("menu");
    session.startPrologue("prologue_brushwood", true);
    const first = session.get().battleEpoch ?? 0;
    // Повтор той же миссии («ещё раз» после поражения): та же миссия и тот
    // же посев, но партия новая — эпоха прирастает и здесь.
    session.startPrologue("prologue_brushwood", true);
    expect(session.get().battleEpoch ?? 0).toBe(first + 1);
  });

  it("keeps the battle epoch while the same battle runs (0.20.38)", () => {
    const session = createSession("menu");
    session.openQuickMatch();
    session.selectDifficulty("easy");
    const epoch = session.get().battleEpoch ?? 0;
    expect(epoch).toBeGreaterThan(0);
    // Пауза и ходы — не новый бой: экран не должен перемонтироваться.
    session.setPaused(true);
    expect(session.get().battleEpoch ?? 0).toBe(epoch);
    session.setPaused(false);
    expect(session.get().battleEpoch ?? 0).toBe(epoch);
  });

  it("opens the campaign sandbox when the prologue chain ends (0.20.35)", () => {
    const session = createSession("menu");
    const automaton = createCampaign(CAMPAIGN_CONFIG, { chapter: "prologue", unitStats: UNIT_STATS });
    session.bindCampaign(automaton);
    session.startPrologue("prologue_village", true);
    expect(session.getCampaign().getState().chapter).toBe("prologue");
    expect(session.advancePrologue(null)).toBe(true);
    expect(session.get().screen).toBe("campaign");
    expect(session.get().prologueMissionId ?? null).toBeNull();
    expect(session.getCampaign().getState().chapter).toBe("open");
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

describe("continueCampaign (0.20.19)", () => {
  const bindCampaignAutomaton = (session: ReturnType<typeof createSession>): void => {
    session.bindCampaign(createCampaign(CAMPAIGN_CONFIG));
  };

  it("restores the saved campaign-branch context (deployment)", () => {
    const session = createSession("menu");
    bindCampaignAutomaton(session);
    session.completeTrainingMission("movement");
    session.continueCampaign({
      screen: "deployment",
      activeMissionId: "lesnik",
      deployment: [1, 2],
      matchSeed: 77,
    });
    const state = session.get();
    expect(state.screen).toBe("deployment");
    expect(state.battleKind).toBeNull();
    expect(state.activeMissionId).toBe("lesnik");
    expect(state.deployment).toEqual([1, 2]);
    expect(state.matchSeed).toBe(77);
    // Глобальный прогресс переживает продолжение.
    expect(state.trainingDone).toEqual(["movement"]);
  });

  it("restores a campaign battle only with a match snapshot", () => {
    const session = createSession("menu");
    bindCampaignAutomaton(session);
    const match = createDebugMatch();
    session.continueCampaign({
      screen: "battle",
      restoredMatch: match,
    });
    const state = session.get();
    expect(state.screen).toBe("battle");
    expect(state.battleKind).toBe("campaign");
    expect(state.restoredMatch).toBe(match);
    // Без снимка партии бой не восстанавливается — карта корабля.
    session.goTo("menu");
    session.continueCampaign({ screen: "battle" });
    expect(session.get().screen).toBe("campaign");
    expect(session.get().restoredMatch).toBeUndefined();
  });

  it("falls back to the ship map for unknown saved screens", () => {
    const session = createSession("menu");
    bindCampaignAutomaton(session);
    session.continueCampaign({ screen: "campaign" });
    expect(session.get().screen).toBe("campaign");
    // Смена хода сессии не оставляет следов чужих веток.
    expect(session.get().outcome).toBeNull();
    expect(session.get().paused).toBe(false);
  });
});

describe("suspend/resume campaign battle (0.20.17–0.20.19)", () => {
  const makeBattleSession = (): ReturnType<typeof createSession> => {
    const session = createSession("menu");
    const campaign = createCampaign(CAMPAIGN_CONFIG);
    session.bindCampaign(campaign);
    campaign.startMission("clearing_1");
    const kernel = createTacticsKernel({ initial: createDebugMatch(), weapons: { sword: DEBUG_BOW }, seed: 5 });
    session.bindTacticsHost(kernel);
    session.continueCampaign({
      screen: "battle",
      activeMissionId: "clearing_1",
      restoredMatch: createDebugMatch(),
    });
    return session;
  };

  it("suspend keeps the mission in the slot and resumes the battle", () => {
    const session = makeBattleSession();
    session.setPaused(true);
    session.suspendCampaignBattle();
    const suspended = session.get();
    expect(suspended.screen).toBe("menu");
    expect(suspended.paused).toBe(false);
    // Контекст миссии — в слоте; навигационные поля чистые (0.20.19).
    expect(suspended.suspendedCampaign?.activeMissionId).toBe("clearing_1");
    expect(suspended.suspendedCampaign?.restoredMatch).toBeDefined();
    expect(suspended.battleKind).toBeNull();
    session.resumeCampaign();
    expect(session.get().screen).toBe("battle");
    expect(session.get().activeMissionId).toBe("clearing_1");
    expect(session.get().restoredMatch).toBeDefined();
    expect(session.get().suspendedCampaign).toBeNull();
  });

  it("detours through other modes from the menu do not lose the mission (0.20.19)", () => {
    // Регрессия: вход из меню в обучение/быстрый матч/настройки клал {...idle}
    // и стирал контекст приостановленной миссии — «Продолжить» вело на карту.
    const session = makeBattleSession();
    session.suspendCampaignBattle();
    expect(session.get().screen).toBe("menu");
    session.openTraining();
    session.startTrainingMission("movement");
    session.goTo("menu");
    session.openQuickMatch();
    session.goTo("menu");
    session.goTo("settings");
    session.goTo("menu");
    session.resumeCampaign();
    expect(session.get().screen).toBe("battle");
    expect(session.get().restoredMatch).toBeDefined();
  });

  it("a quick battle in-between keeps the campaign mission in the slot", () => {
    const session = makeBattleSession();
    session.suspendCampaignBattle();
    session.selectDifficulty("normal");
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("quick");
    session.finishMatch("victory");
    session.goTo("menu");
    session.resumeCampaign();
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("campaign");
  });

  it("a mission started in-session suspends and resumes repeatedly", () => {
    const session = createSession("menu");
    const campaign = createCampaign(CAMPAIGN_CONFIG);
    session.bindCampaign(campaign);
    expect(session.startCampaignMission("clearing_1")).toBe(true);
    expect(session.confirmDeployment([1, 2, 3])).toBe(true);
    session.bindTacticsHost(createTacticsKernel({ initial: createDebugMatch(), weapons: { sword: DEBUG_BOW }, seed: 7 }));
    for (let cycle = 0; cycle < 2; cycle += 1) {
      session.suspendCampaignBattle();
      const suspended = session.get();
      expect(suspended.screen).toBe("menu");
      expect(suspended.suspendedCampaign?.activeMissionId).toBe("clearing_1");
      expect(suspended.suspendedCampaign?.restoredMatch).toBeDefined();
      session.resumeCampaign();
      expect(session.get().screen).toBe("battle");
      expect(session.get().activeMissionId).toBe("clearing_1");
    }
  });

  it("suspend to the ship map keeps the mission; Continue returns to it", () => {
    const session = makeBattleSession();
    session.suspendCampaignMission();
    const onMap = session.get();
    expect(onMap.screen).toBe("campaign");
    expect(onMap.suspendedCampaign?.activeMissionId).toBe("clearing_1");
    expect(onMap.suspendedCampaign?.restoredMatch).toBeDefined();
    session.campaignToMenu();
    expect(session.get().screen).toBe("menu");
    expect(session.get().suspendedCampaign?.activeMissionId).toBe("clearing_1");
    session.resumeCampaign();
    expect(session.get().screen).toBe("battle");
  });

  it("a mission suspended before the battle resumes to deployment", () => {
    const session = createSession("menu");
    const campaign = createCampaign(CAMPAIGN_CONFIG);
    session.bindCampaign(campaign);
    session.startCampaignMission("clearing_1");
    session.suspendCampaignMission();
    expect(session.get().screen).toBe("campaign");
    expect(session.get().suspendedCampaign?.activeMissionId).toBe("clearing_1");
    session.openTraining();
    session.goTo("menu");
    session.resumeCampaign();
    expect(session.get().screen).toBe("deployment");
    expect(session.get().activeMissionId).toBe("clearing_1");
  });

  it("abandoning or finishing the mission clears the slot; a new bylina clears it too", () => {
    const session = makeBattleSession();
    session.suspendCampaignBattle();
    expect(session.get().suspendedCampaign).not.toBeNull();
    session.resumeCampaign();
    session.suspendCampaignMission();
    session.leaveCampaignMission();
    expect(session.get().suspendedCampaign).toBeNull();
    session.resumeCampaign();
    expect(session.get().screen).toBe("campaign");
    const second = makeBattleSession();
    second.suspendCampaignBattle();
    second.resumeCampaign();
    second.finishCampaignMission("victory", [], []);
    expect(second.get().suspendedCampaign).toBeNull();
    const third = makeBattleSession();
    third.suspendCampaignBattle();
    third.clearSuspendedCampaign();
    expect(third.get().suspendedCampaign).toBeNull();
  });

  it("resume falls back to the ship map when the mission is finished", () => {
    const session = makeBattleSession();
    session.finishCampaignMission("victory", [], []);
    session.goTo("menu");
    session.resumeCampaign();
    expect(session.get().screen).toBe("campaign");
  });

  it("suspend outside a campaign battle is a plain exit to menu", () => {
    const session = createSession("menu");
    session.bindCampaign(createCampaign(CAMPAIGN_CONFIG));
    session.suspendCampaignBattle();
    expect(session.get().screen).toBe("menu");
    expect(session.get().battleKind).toBeNull();
  });
});
