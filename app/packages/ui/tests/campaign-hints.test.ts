import { describe, expect, it } from "vitest";
import { CAMPAIGN_HINT_PERSONAS, pendingCampaignHints, type CampaignHintsContext } from "../src/campaign-hints.js";

const BASE: CampaignHintsContext = {
  showHints: true,
  done: [],
  onCampaignMap: false,
  lockedCount: 0,
  hasWounded: false,
  rosterTabActive: false,
  forgeTabActive: false,
  onDeployment: false,
  onBattleWithGeneral: false,
};

describe("pendingCampaignHints (0.20.0)", () => {
  it("returns an empty list when hints are disabled", () => {
    expect(pendingCampaignHints({ ...BASE, showHints: false, onCampaignMap: true, lockedCount: 3 })).toEqual([]);
  });

  it("shows the campaign-map hints in priority order", () => {
    const hints = pendingCampaignHints({ ...BASE, onCampaignMap: true, lockedCount: 2 });
    expect(hints).toEqual(["darkness", "scan"]);
  });

  it("adds the wound hint only when someone is wounded", () => {
    expect(pendingCampaignHints({ ...BASE, onCampaignMap: true, hasWounded: true })).toEqual(["darkness", "wound"]);
  });

  it("adds tab hints when the corresponding tab is active", () => {
    expect(pendingCampaignHints({ ...BASE, rosterTabActive: true })).toEqual(["roster"]);
    expect(pendingCampaignHints({ ...BASE, forgeTabActive: true })).toEqual(["forge"]);
  });

  it("adds deploy and evacuation hints on deployment, evacuation only for rescue/recon", () => {
    expect(pendingCampaignHints({ ...BASE, onDeployment: true })).toEqual(["deploy"]);
    expect(pendingCampaignHints({ ...BASE, onDeployment: true, missionType: "rescue" })).toEqual(["deploy", "evacuation"]);
    expect(pendingCampaignHints({ ...BASE, onDeployment: true, missionType: "recon" })).toEqual(["deploy", "evacuation"]);
    expect(pendingCampaignHints({ ...BASE, onDeployment: true, missionType: "purge" })).toEqual(["deploy"]);
  });

  it("adds the general hint in a battle with a general", () => {
    expect(pendingCampaignHints({ ...BASE, onBattleWithGeneral: true })).toEqual(["general"]);
  });

  it("does not repeat hints that were already shown", () => {
    const hints = pendingCampaignHints({
      ...BASE,
      done: ["darkness", "scan"],
      onCampaignMap: true,
      lockedCount: 2,
      hasWounded: true,
    });
    expect(hints).toEqual(["wound"]);
  });

  it("every hint has a narrator persona", () => {
    const all = pendingCampaignHints({
      ...BASE,
      onCampaignMap: true,
      lockedCount: 1,
      hasWounded: true,
      rosterTabActive: true,
      forgeTabActive: true,
      onDeployment: true,
      missionType: "recon",
      onBattleWithGeneral: true,
    });
    expect(all.length).toBeGreaterThan(0);
    for (const id of all) expect(CAMPAIGN_HINT_PERSONAS[id]).toBeTruthy();
  });
});
