import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";
import { createCampaign } from "@bylina/campaign";
import { createMissionMatch, createTacticsKernel, type WeaponStats } from "@bylina/core";

/**
 * Сквозной QA-сценарий выпуска 0.13.0: кампания на реальном содержимом —
 * все типы миссий по порядку открытия, исходы через обычный механизм,
 * сохранение и восстановление после каждой миссии.
 */
function readDataTree(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../content/data");
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json5")) files[full] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

describe("QA flow: campaign end-to-end (0.13.0)", () => {
  it("plays every mission type in order, restores saves, and keeps the roster", () => {
    const parsed = parseContent(readDataTree());
    if (!parsed.ok) throw new Error("content bundle is broken");
    const { campaign: cfg, units, weapons, skills, items } = parsed.data;

    const unitStats: Record<string, { maxHealth: number }> = {};
    for (const unit of units) unitStats[unit.id] = { maxHealth: unit.maxHealth };
    const camp = createCampaign(cfg, { unitStats, items });

    const wStats: Record<string, WeaponStats> = {};
    for (const weapon of weapons) {
      wStats[weapon.id] = {
        id: weapon.id,
        category: weapon.category,
        apCost: weapon.apCost,
        endsTurn: weapon.endsTurn,
        range: weapon.range,
        requiresLOS: weapon.requiresLOS,
        aimMod: weapon.aimMod,
        minDmg: weapon.minDmg,
        maxDmg: weapon.maxDmg,
        crit: weapon.crit,
        critBonus: weapon.critBonus,
        envDmg: weapon.envDmg,
        ignoreHalfCover: weapon.ignoreHalfCover,
        closeRangePenalty: weapon.closeRangePenalty,
      };
    }
    const sStats: Record<string, never> = {};
    for (const skill of skills) sStats[skill.id] = skill as never;

    const played: string[] = [];
    let darkness = 0;
    for (let step = 0; step < 12; step += 1) {
      const open = camp.getState().missions.find((mission) => mission.status === "open" && !played.includes(mission.id));
      if (!open) break;
      const mission = camp.getMission(open.id);
      if (!mission) throw new Error(`mission ${open.id} is missing`);
      const alive = camp.getState().fighters.filter((fighter) => fighter.alive);
      if (alive.length === 0) break;
      const deploy = alive.slice(0, Math.min(5, alive.length)).map((fighter) => fighter.id);
      if (!camp.startMission(open.id)) throw new Error(`cannot start ${open.id}`);

      const match = createMissionMatch({
        units,
        map: mission.map,
        playerSlots: deploy.map((id) => ({ unitId: camp.getState().fighters.find((fighter) => fighter.id === id)!.unitId })),
        enemies: mission.enemies,
        objective: mission.type === "destroy"
          ? { kind: "destroy", unitId: mission.objectiveUnitId! }
          : mission.type === "rescue"
            ? { kind: "rescue", unitId: mission.escorteeUnitId! }
            : mission.type === "recon"
              ? { kind: "recon" }
              : undefined,
        seed: 5 + step,
      });
      const kernel = createTacticsKernel({ initial: match, weapons: wStats, skills: sStats, units, seed: 5 + step });
      const win = kernel.debugAutoWin();
      if (!win.ok) throw new Error(`auto win failed on ${open.id}`);
      const ended = win.events.find((event) => event.type === "MATCH_ENDED");
      const outcome = ended && ended.type === "MATCH_ENDED" && ended.winnerPlayerId === "1" ? "victory" : "defeat";

      // Учёт участников как в BattleScreen: метка высадки либо запись эвакуации.
      const snap = kernel.getSnapshot();
      const participants = deploy.map((fighterId, index) => {
        const entity = snap.entities.find((candidate) =>
          candidate.owner === 1 && candidate.coverType === 0 && candidate.rosterIndex === index,
        );
        if (entity) return { fighterId, survived: !entity.dead, hp: entity.hp };
        const extracted = (snap.extracted ?? []).find((entry) => entry.rosterIndex === index);
        if (extracted) return { fighterId, survived: true, hp: extracted.hp };
        return { fighterId, survived: false, hp: 0 };
      });
      const finish = camp.finishMission(open.id, outcome, participants);
      if (!finish) throw new Error(`finish failed on ${open.id}`);
      darkness = camp.getState().darkness;
      played.push(open.id);

      // Сохранение и восстановление кампании после каждой миссии.
      const saved = JSON.parse(JSON.stringify(camp.getState()));
      const restored = createCampaign(cfg, { unitStats, items, initialState: saved });
      expect(restored.getState().darkness).toBe(darkness);
      camp.scan();
    }

    expect(played).toEqual([
      "clearing_1",
      "clearing_2",
      "clearing_3",
      "clearing_4",
      "clearing_5",
      "destroy_idol_1",
      "rescue_captive_1",
      "recon_route_1",
    ]);
    expect(camp.getState().phase).toBe("active");
    expect(camp.getState().fighters.filter((fighter) => fighter.alive).length).toBeGreaterThan(0);
  });
});
