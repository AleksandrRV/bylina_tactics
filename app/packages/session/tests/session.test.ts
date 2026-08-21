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
  missions: [
    {
      id: "clearing_1",
      type: "purge",
      darknessOnVictory: 2,
      darknessOnDefeat: 4,
      map: MAP,
      enemies: [{ unitId: "upyr", count: 3 }],
    },
    {
      id: "clearing_2",
      type: "purge",
      darknessOnVictory: 2,
      darknessOnDefeat: 4,
      map: MAP,
      enemies: [{ unitId: "upyr", count: 3 }],
    },
  ],
};

describe("createSession", () => {
  it("starts on the boot screen", () => {
    expect(createSession().get().screen).toBe("boot");
  });

  it("reports version 0.10.0", () => {
    expect(APP_VERSION).toBe("0.10.0");
  });

  it("moves between menu and settings", () => {
    const session = createSession("menu");
    session.goTo("settings");
    expect(session.get().screen).toBe("settings");
    session.goTo("menu");
    expect(session.get().screen).toBe("menu");
  });

  it("records an unavailable mode without leaving the menu", () => {
    const session = createSession("menu");
    session.openMode("pvp");
    expect(session.get().screen).toBe("menu");
    expect(session.get().unavailableMode).toBe("pvp");
    session.dismissUnavailable();
    expect(session.get().unavailableMode).toBeNull();
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
    session.bindCampaign(createCampaign(CAMPAIGN_CONFIG));
    session.openCampaign();
    expect(session.get().screen).toBe("campaign");
  });

  it("starts a campaign mission into battle and finishes it with darkness growth", () => {
    const session = createSession("menu");
    session.bindCampaign(createCampaign(CAMPAIGN_CONFIG));
    session.openCampaign();
    expect(session.startCampaignMission("clearing_1")).toBe(true);
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("campaign");
    expect(session.get().activeMissionId).toBe("clearing_1");
    const result = session.finishCampaignMission("victory");
    expect(result).toEqual({ darknessGained: 2, campaignLost: false });
    expect(session.get().screen).toBe("missionResult");
    expect(session.get().outcome).toBe("victory");
    const campaign = session.getCampaign();
    expect(campaign.getState().darkness).toBe(2);
    expect(campaign.getState().missions[1]?.status).toBe("open");
    session.backToCampaign();
    expect(session.get().screen).toBe("campaign");
  });

  it("rejects starting a locked mission", () => {
    const session = createSession("menu");
    session.bindCampaign(createCampaign(CAMPAIGN_CONFIG));
    session.openCampaign();
    expect(session.startCampaignMission("clearing_2")).toBe(false);
    expect(session.get().screen).toBe("campaign");
  });

  it("abandoning a mission returns to the map without consequences", () => {
    const session = createSession("menu");
    session.bindCampaign(createCampaign(CAMPAIGN_CONFIG));
    session.openCampaign();
    session.startCampaignMission("clearing_1");
    session.leaveCampaignMission();
    expect(session.get().screen).toBe("campaign");
    expect(session.getCampaign().getState().darkness).toBe(0);
    expect(session.getCampaign().getState().missions[0]?.status).toBe("open");
  });

  it("loses the campaign when darkness reaches the maximum", () => {
    const session = createSession("menu");
    session.bindCampaign(createCampaign({ ...CAMPAIGN_CONFIG, darknessMax: 4 }));
    session.openCampaign();
    session.startCampaignMission("clearing_1");
    expect(session.finishCampaignMission("defeat")).toEqual({ darknessGained: 4, campaignLost: true });
    expect(session.getCampaign().getState().phase).toBe("lost");
    expect(session.startCampaignMission("clearing_2")).toBe(false);
  });

  it("plays a purge mission end to end and returns to the map with the next point open", () => {
    const session = createSession("menu");
    session.bindCampaign(createCampaign(CAMPAIGN_CONFIG));
    session.openCampaign();
    expect(session.startCampaignMission("clearing_1")).toBe(true);

    // Сражение: фиксированный отладочный бой с летальным луком — один
    // выстрел уничтожает противника, ядро фиксирует победу.
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

    // Итог миссии: Тьма возросла, следующая точка открыта.
    expect(session.finishCampaignMission("victory")).toEqual({ darknessGained: 2, campaignLost: false });
    expect(session.get().screen).toBe("missionResult");
    expect(session.getCampaign().getState().missions.map((point) => point.status)).toEqual(["done", "open"]);
    session.backToCampaign();
    expect(session.get().screen).toBe("campaign");
  });
});
