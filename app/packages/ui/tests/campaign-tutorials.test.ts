import { describe, expect, it } from "vitest";
import { pendingCampaignHints, type CampaignHintsContext } from "../src/campaign-hints.js";

const ctx = (patch: Partial<CampaignHintsContext>): CampaignHintsContext => ({
  showHints: true,
  done: [],
  onCampaignMap: false,
  lockedCount: 0,
  hasWounded: false,
  rosterTabActive: false,
  forgeTabActive: false,
  onDeployment: false,
  onBattle: false,
  enemyTypes: [],
  onBattleWithGeneral: false,
  ...patch,
});

describe("QA manual: campaign tutorial journey (0.20.1)", () => {
  it("plays the whole onboarding in order, each hint exactly once", () => {
    const shown: string[] = [];
    const done = (): string[] => shown;
    const step = (c: CampaignHintsContext): void => {
      for (const id of pendingCampaignHints({ ...c, done: done() })) {
        if (!shown.includes(id)) shown.push(id);
      }
    };

    // 1. Карта корабля: darkness, scan.
    step(ctx({ onCampaignMap: true, lockedCount: 7 }));
    // 2. Вкладка дружины (без раненых).
    step(ctx({ rosterTabActive: true }));
    // 3. Карта: появился раненый — wound.
    step(ctx({ onCampaignMap: true, lockedCount: 7, hasWounded: true }));
    // 4. Вкладка кузни.
    step(ctx({ forgeTabActive: true }));
    // 5. Высадка (зачистка).
    step(ctx({ onDeployment: true, missionType: "purge" }));
    // 6. Бой 1 (упыри): first_battle.
    step(ctx({ onBattle: true, enemyTypes: ["upyr"] }));
    // 7. Бой 2 (леший): first_leshy.
    step(ctx({ onBattle: true, enemyTypes: ["upyr", "leshy"] }));
    // 8. Бой 3 (кикимора): first_kikimora.
    step(ctx({ onBattle: true, enemyTypes: ["upyr", "kikimora"] }));
    // 9. Высадка спасения: evacuation.
    step(ctx({ onDeployment: true, missionType: "rescue" }));
    // 10. Бой с генералом: general.
    step(ctx({ onBattle: true, enemyTypes: ["upyr", "leshy"], onBattleWithGeneral: true }));
    // 11. Повторные посещения ничего не добавляют.
    step(ctx({ onCampaignMap: true, lockedCount: 3, hasWounded: true }));
    step(ctx({ onBattle: true, enemyTypes: ["leshy", "kikimora"], onBattleWithGeneral: true }));

    expect(shown).toEqual([
      "darkness",
      "scan",
      "roster",
      "wound",
      "forge",
      "deploy",
      "first_battle",
      "first_leshy",
      "first_kikimora",
      "evacuation",
      "general",
    ]);
  });

  it("disabling hints suppresses everything, even already queued ids", () => {
    const c: CampaignHintsContext = ctx({ onCampaignMap: true, lockedCount: 3, hasWounded: true });
    expect(pendingCampaignHints({ ...c, showHints: false })).toEqual([]);
  });

  it("a completed campaign with all missions visited shows nothing new", () => {
    const all = [
      "darkness",
      "scan",
      "roster",
      "wound",
      "forge",
      "deploy",
      "first_battle",
      "first_leshy",
      "first_kikimora",
      "evacuation",
      "general",
    ];
    const c: CampaignHintsContext = ctx({
      done: all,
      onCampaignMap: true,
      lockedCount: 0,
      hasWounded: true,
      onBattle: true,
      enemyTypes: ["upyr", "leshy", "kikimora"],
      onBattleWithGeneral: true,
    });
    expect(pendingCampaignHints(c)).toEqual([]);
  });
});
