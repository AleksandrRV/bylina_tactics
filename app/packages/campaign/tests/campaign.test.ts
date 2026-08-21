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
  missions: [purge("clearing_1", 2, 4), purge("clearing_2", 2, 4), purge("clearing_3", 2, 4)],
};

describe("createCampaign", () => {
  it("opens only the first point and starts with zero darkness", () => {
    const campaign = createCampaign(CONFIG);
    const state = campaign.getState();
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
    const campaign = createCampaign(CONFIG);
    expect(campaign.startMission("clearing_2")).toBe(false);
    expect(campaign.startMission("clearing_1")).toBe(true);
    expect(campaign.startMission("clearing_1")).toBe(false);
    expect(campaign.getState().activeMissionId).toBe("clearing_1");
  });

  it("applies victory darkness, marks the point done, and opens the next one", () => {
    const campaign = createCampaign(CONFIG);
    campaign.startMission("clearing_1");
    const result = campaign.finishMission("clearing_1", "victory");
    expect(result).toEqual({ darknessGained: 2, campaignLost: false });
    const state = campaign.getState();
    expect(state.darkness).toBe(2);
    expect(state.missions.map((mission) => [mission.id, mission.status])).toEqual([
      ["clearing_1", "done"],
      ["clearing_2", "open"],
      ["clearing_3", "locked"],
    ]);
    expect(state.lastResult).toEqual({ missionId: "clearing_1", outcome: "victory", darknessGained: 2 });
  });

  it("defeat adds more darkness but does not end the campaign", () => {
    const campaign = createCampaign(CONFIG);
    campaign.startMission("clearing_1");
    expect(campaign.finishMission("clearing_1", "defeat")).toEqual({ darknessGained: 4, campaignLost: false });
    expect(campaign.getState().phase).toBe("active");
    expect(campaign.getState().darkness).toBe(4);
    expect(campaign.getState().missions[1]?.status).toBe("open");
  });

  it("finishing a mission that was not started is rejected", () => {
    const campaign = createCampaign(CONFIG);
    expect(campaign.finishMission("clearing_1", "victory")).toBeNull();
    campaign.startMission("clearing_1");
    expect(campaign.finishMission("clearing_2", "victory")).toBeNull();
  });

  it("abandoning a mission returns to the map without consequences", () => {
    const campaign = createCampaign(CONFIG);
    campaign.startMission("clearing_1");
    campaign.abandonMission();
    const state = campaign.getState();
    expect(state.activeMissionId).toBeNull();
    expect(state.darkness).toBe(0);
    expect(state.missions[0]?.status).toBe("open");
    expect(campaign.startMission("clearing_1")).toBe(true);
  });

  it("loses the campaign when darkness reaches the maximum", () => {
    const campaign = createCampaign({ ...CONFIG, darknessMax: 8 });
    campaign.startMission("clearing_1");
    expect(campaign.finishMission("clearing_1", "defeat")).toEqual({ darknessGained: 4, campaignLost: false });
    campaign.startMission("clearing_2");
    expect(campaign.finishMission("clearing_2", "defeat")).toEqual({ darknessGained: 4, campaignLost: true });
    const state = campaign.getState();
    expect(state.phase).toBe("lost");
    expect(state.darkness).toBe(8);
    expect(campaign.startMission("clearing_3")).toBe(false);
    expect(campaign.finishMission("clearing_3", "victory")).toBeNull();
  });

  it("does not let darkness exceed the maximum", () => {
    const campaign = createCampaign({ ...CONFIG, darknessMax: 5 });
    campaign.startMission("clearing_1");
    campaign.finishMission("clearing_1", "defeat");
    // 0 + 4 = 4 < 5: прирост не обрезается, кампания продолжается.
    expect(campaign.getState().darkness).toBe(4);
    expect(campaign.getState().phase).toBe("active");
    campaign.startMission("clearing_2");
    const result = campaign.finishMission("clearing_2", "defeat");
    // 4 + 4 = 8 → обрезается до максимума, кампания проиграна.
    expect(result).toEqual({ darknessGained: 4, campaignLost: true });
    expect(campaign.getState().darkness).toBe(5);
  });

  it("notifies listeners on state changes", () => {
    const campaign = createCampaign(CONFIG);
    let calls = 0;
    campaign.subscribe(() => {
      calls += 1;
    });
    campaign.startMission("clearing_1");
    campaign.finishMission("clearing_1", "victory");
    campaign.abandonMission();
    expect(calls).toBe(2); // abandonMission без активной миссии не уведомляет
  });

  it("exposes mission records in configuration order", () => {
    const campaign = createCampaign(CONFIG);
    expect(campaign.getMissions().map((mission) => mission.id)).toEqual([
      "clearing_1",
      "clearing_2",
      "clearing_3",
    ]);
    expect(campaign.getMission("clearing_2")?.type).toBe("purge");
    expect(campaign.getMission("missing")).toBeUndefined();
  });
});
