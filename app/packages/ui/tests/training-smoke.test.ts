import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";
import { createMissionMatch, createTacticsKernel, defaultTrainingWeapons, weaponStatsFromRecord, pickEnemyCommand, PLAYER_OWNER, ENEMY_OWNER, livingOf, distH } from "@bylina/core";
import type { EntityState, SkillStats, WeaponStats } from "@bylina/core";

/**
 * Дымовой тест проходимости обучения (0.19.2): каждая миссия обучения
 * доводится до победы на реальном содержимом при разумной стратегии игрока.
 * Защищает от конфигураций, в которых миссия невыполнима в принципе.
 */

function dataTree(): Record<string, string> {
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

function makeKernel(missionId: string, seed: number) {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.training.missions.find((m) => m.id === missionId);
  if (!mission) throw new Error(`no training mission ${missionId}`);
  const weapons: Record<string, WeaponStats> = { ...defaultTrainingWeapons() };
  for (const w of parsed.data.weapons) weapons[w.id] = weaponStatsFromRecord(w);
  const skills: Record<string, SkillStats> = {};
  for (const s of parsed.data.skills) skills[s.id] = s as unknown as SkillStats;
  return createTacticsKernel({
    initial: createMissionMatch({ units: parsed.data.units, map: mission.map, playerSlots: mission.playerSlots, enemies: mission.enemies, seed }),
    weapons,
    skills,
    units: parsed.data.units,
    seed,
  });
}

function nearestFoe(kernel: ReturnType<typeof makeKernel>, actor: EntityState): EntityState | undefined {
  const foes = livingOf(kernel.getSnapshot(), ENEMY_OWNER).filter((entity) => !entity.hidden);
  return [...foes].sort((a, b) => {
    // Источник отравления — приоритетная цель.
    const threat = (entity: EntityState): number => (entity.configId === "kikimora" ? 100 : 0);
    const ta = threat(a) * 1000 + distH(actor.x, actor.y, a.x, a.y);
    const tb = threat(b) * 1000 + distH(actor.x, actor.y, b.x, b.y);
    return ta - tb;
  })[0];
}

function playerAct(kernel: ReturnType<typeof makeKernel>): void {
  const snap = kernel.getSnapshot();
  const players = livingOf(snap, PLAYER_OWNER).sort((a, b) => a.id - b.id);
  let acted = false;
  for (const fighter of players) {
    if (fighter.ap <= 0) continue;
    // Знахарка: лечение раненых, очищение яда, призыв зверя.
    const wounded = players.find((x) => x.hp < x.maxHp && x.id !== fighter.id);
    const heal = fighter.skillIds?.includes("heal") && wounded
      ? kernel.getSkillPreview(fighter.id, "heal", wounded.id)
      : undefined;
    if (heal?.available) {
      kernel.apply({ type: "USE_SKILL", actorId: fighter.id, skillId: "heal", targetId: wounded!.id });
      acted = true;
      continue;
    }
    const poisoned = players.find((x) => x.poison);
    const cleanse = fighter.skillIds?.includes("cleanse") && poisoned
      ? kernel.getSkillPreview(fighter.id, "cleanse", poisoned.id)
      : undefined;
    if (cleanse?.available) {
      kernel.apply({ type: "USE_SKILL", actorId: fighter.id, skillId: "cleanse", targetId: poisoned!.id });
      acted = true;
      continue;
    }
    if (fighter.skillIds?.includes("summon_forest_beast")) {
      const summoned = livingOf(kernel.getSnapshot(), PLAYER_OWNER).some((x) => x.configId === "forest_beast");
      if (!summoned) {
        const nearby = [
          { x: fighter.x + 1, y: fighter.y },
          { x: fighter.x - 1, y: fighter.y },
          { x: fighter.x, y: fighter.y + 1 },
          { x: fighter.x, y: fighter.y - 1 },
          { x: fighter.x + 1, y: fighter.y + 1 },
        ];
        for (const pos of nearby) {
          const preview = kernel.getSkillPreview(fighter.id, "summon_forest_beast", undefined, { x: pos.x, y: pos.y, z: snap.grid.tiles.find((t) => t.x === pos.x && t.y === pos.y)?.z ?? 1 });
          if (preview.available) {
            kernel.apply({ type: "USE_SKILL", actorId: fighter.id, skillId: "summon_forest_beast", targetPos: { x: pos.x, y: pos.y, z: preview.targetPos?.z ?? 1 } });
            acted = true;
            break;
          }
        }
        if (acted) continue;
      }
    }
    // Атака ближайшего врага.
    const foe = nearestFoe(kernel, fighter);
    if (foe) {
      const preview = kernel.getHitPreview(fighter.id, foe.id);
      if (preview.available) {
        kernel.apply({ type: "ATTACK", actorId: fighter.id, targetId: foe.id, weaponId: fighter.weaponId });
        acted = true;
        continue;
      }
    }
    // Движение к ближайшему врагу.
    const reachable = kernel.getReachable(fighter.id);
    if (reachable.length > 0 && foe) {
      const best = [...reachable].sort((a, b) => {
        const da = distH(a.x, a.y, foe.x, foe.y);
        const db = distH(b.x, b.y, foe.x, foe.y);
        return da - db || a.mpCost - b.mpCost;
      })[0];
      if (best) {
        kernel.apply({ type: "MOVE", actorId: fighter.id, to: best });
        acted = true;
        continue;
      }
    }
    if (reachable.length > 0) {
      kernel.apply({ type: "MOVE", actorId: fighter.id, to: reachable[0]! });
      acted = true;
    }
  }
  if (!acted) kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
}

function enemyAct(kernel: ReturnType<typeof makeKernel>): void {
  for (let guard = 0; guard < 96; guard += 1) {
    const snap = kernel.getSnapshot();
    if (snap.activeOwner !== ENEMY_OWNER) break;
    const command = pickEnemyCommand(kernel);
    const applied = command ? kernel.apply(command) : kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
    if (!applied.ok) {
      kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
      break;
    }
    if (!command) break;
  }
}

describe("training missions are winnable (0.19.2)", () => {
  it.each(["movement", "combat", "skills"] as const)("mission %s ends with a victory", (missionId) => {
    const kernel = makeKernel(missionId, 42);
    for (let turn = 0; turn < 80; turn += 1) {
      const snap = kernel.getSnapshot();
      if (snap.activeOwner !== PLAYER_OWNER) {
        enemyAct(kernel);
        continue;
      }
      if (livingOf(snap, ENEMY_OWNER).length === 0) break;
      if (livingOf(snap, PLAYER_OWNER).length === 0) break;
      playerAct(kernel);
    }
    const snap = kernel.getSnapshot();
    console.log(`training ${missionId}: turn ${snap.turnNumber}, players ${livingOf(snap, PLAYER_OWNER).length}, enemies ${livingOf(snap, ENEMY_OWNER).length}`);
    expect(livingOf(snap, ENEMY_OWNER).length).toBe(0);
    expect(livingOf(snap, PLAYER_OWNER).length).toBeGreaterThan(0);
  });
});
