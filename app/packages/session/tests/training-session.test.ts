import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";
import {
  createMissionMatch,
  createTacticsKernel,
  defaultTrainingWeapons,
  weaponStatsFromRecord,
  pickEnemyCommand,
  PLAYER_OWNER,
  ENEMY_OWNER,
  livingOf,
  distH,
  type WeaponStats,
} from "@bylina/core";
import { createSession } from "../src/index.js";

/**
 * Регрессия 0.20.1: команды обучения шли через session.applyBattleCommand,
 * который отклонял всё на экране "trainingBattle" (screen !== "battle") —
 * персонаж не реагировал на действия, подсказки не продвигались.
 * Тест гоняет миссию обучения через сессию, как это делает интерфейс.
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

function startTrainingSession(missionId: string, seed: number) {
  const parsed = parseContent(readDataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.training.missions.find((m) => m.id === missionId);
  if (!mission) throw new Error(`no mission ${missionId}`);
  const weapons: Record<string, WeaponStats> = { ...defaultTrainingWeapons() };
  for (const w of parsed.data.weapons) weapons[w.id] = weaponStatsFromRecord(w);
  const skills: Record<string, unknown> = {};
  for (const s of parsed.data.skills) skills[s.id] = s;

  const session = createSession("menu");
  expect(session.startTrainingMission(missionId)).toBe(true);
  expect(session.get().screen).toBe("trainingBattle");
  expect(session.get().battleKind).toBe("training");

  const kernel = createTacticsKernel({
    initial: createMissionMatch({
      units: parsed.data.units,
      map: mission.map,
      playerSlots: mission.playerSlots,
      enemies: mission.enemies,
      seed,
    }),
    weapons,
    skills: skills as never,
    units: parsed.data.units,
    seed,
  });
  session.bindTacticsHost(kernel);
  return { session, kernel, mission };
}

function playerAct(session: ReturnType<typeof createSession>): void {
  const snap = session.getBattleSnapshot(PLAYER_OWNER);
  const players = livingOf(snap, PLAYER_OWNER).sort((a, b) => a.id - b.id);
  let acted = false;
  for (const fighter of players) {
    if (fighter.ap <= 0) continue;
    const foes = livingOf(snap, ENEMY_OWNER).filter((e) => !e.hidden);
    if (foes.length > 0) {
      const target = [...foes].sort(
        (a, b) =>
          (a.configId === "kikimora" ? 1000 : 0) +
          distH(fighter.x, fighter.y, a.x, a.y) -
          ((b.configId === "kikimora" ? 1000 : 0) + distH(fighter.x, fighter.y, b.x, b.y)),
      )[0]!;
      const preview = session.getBattleHitPreview(fighter.id, target.id);
      if (preview.available) {
        const applied = session.applyBattleCommand({
          type: "ATTACK",
          actorId: fighter.id,
          targetId: target.id,
          weaponId: fighter.weaponId,
        });
        expect(applied.ok).toBe(true);
        acted = true;
        continue;
      }
    }
    const reach = session.getBattleReachable(fighter.id);
    if (reach.length > 0 && foes.length > 0) {
      const foe = foes[0]!;
      const best = [...reach].sort(
        (a, b) => distH(a.x, a.y, foe.x, foe.y) - distH(b.x, b.y, foe.x, foe.y) || a.mpCost - b.mpCost,
      )[0]!;
      const applied = session.applyBattleCommand({ type: "MOVE", actorId: fighter.id, to: best });
      expect(applied.ok).toBe(true);
      acted = true;
      continue;
    }
    if (reach.length > 0) {
      const applied = session.applyBattleCommand({ type: "MOVE", actorId: fighter.id, to: reach[0]! });
      expect(applied.ok).toBe(true);
      acted = true;
    }
  }
  if (!acted) {
    const applied = session.applyBattleCommand({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    expect(applied.ok).toBe(true);
  }
}

function enemyAct(session: ReturnType<typeof createSession>, kernel: ReturnType<typeof createTacticsKernel>): void {
  for (let guard = 0; guard < 96; guard += 1) {
    const snap = session.getBattleSnapshot(PLAYER_OWNER);
    if (snap.activeOwner !== ENEMY_OWNER) break;
    const command = pickEnemyCommand(kernel);
    const applied = command
      ? session.applyBattleCommand(command)
      : session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
    if (!applied.ok) {
      session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
      break;
    }
    if (!command) break;
  }
}

describe("training missions run through the session (0.20.1 regression)", () => {
  it("applies player commands on the trainingBattle screen", () => {
    const { session } = startTrainingSession("movement", 42);
    const snap = session.getBattleSnapshot(PLAYER_OWNER);
    const fighter = livingOf(snap, PLAYER_OWNER)[0]!;
    const reach = session.getBattleReachable(fighter.id);
    expect(reach.length).toBeGreaterThan(0);
    // Главная регрессия: команда не отклоняется на экране обучения.
    const applied = session.applyBattleCommand({ type: "MOVE", actorId: fighter.id, to: reach[0]! });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.events.some((event) => event.type === "ENTITY_MOVED")).toBe(true);
    }
  });

  it("toggles pause on the trainingBattle screen", () => {
    const { session } = startTrainingSession("combat", 42);
    session.setPaused(true);
    expect(session.get().paused).toBe(true);
    session.setPaused(false);
    expect(session.get().paused).toBe(false);
  });

  it("plays a training mission to victory through the session, enemy turn included", () => {
    const { session, kernel } = startTrainingSession("movement", 42);
    for (let turn = 0; turn < 60; turn += 1) {
      const snap = session.getBattleSnapshot(PLAYER_OWNER);
      if (livingOf(snap, ENEMY_OWNER).length === 0) break;
      if (livingOf(snap, PLAYER_OWNER).length === 0) break;
      if (snap.activeOwner !== PLAYER_OWNER) {
        enemyAct(session, kernel);
        continue;
      }
      playerAct(session);
    }
    const final = session.getBattleSnapshot(PLAYER_OWNER);
    expect(livingOf(final, ENEMY_OWNER).length).toBe(0);
    expect(livingOf(final, PLAYER_OWNER).length).toBeGreaterThan(0);
  });

  it("rejects battle commands outside a battle screen", () => {
    const session = createSession("menu");
    const applied = session.applyBattleCommand({ type: "END_TURN", playerId: "1" });
    expect(applied.ok).toBe(false);
  });

  it("fixes the mission seeds so the environment is stable (0.20.2)", () => {
    const session = createSession("menu");
    expect(session.startTrainingMission("movement")).toBe(true);
    expect(session.get().matchSeed).toBe(101);
    expect(session.startTrainingMission("combat")).toBe(true);
    expect(session.get().matchSeed).toBe(46);
    expect(session.startTrainingMission("skills")).toBe(true);
    expect(session.get().matchSeed).toBe(303);
  });

  it("tracks completed missions and resets progress (0.20.2)", () => {
    const session = createSession("menu");
    session.completeTrainingMission("movement");
    session.completeTrainingMission("combat");
    expect(session.get().trainingDone).toEqual(["movement", "combat"]);
    session.resetTrainingProgress();
    expect(session.get().trainingDone).toEqual([]);
  });
});
