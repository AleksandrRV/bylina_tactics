import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";
import { createPvpMatch, createTacticsKernel, type WeaponStats } from "@bylina/core";
import { createSession } from "../src/index.js";

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

function buildWorld() {
  const parsed = parseContent(readDataTree());
  if (!parsed.ok) throw new Error("content broken");
  const { units, weapons, pvp } = parsed.data;
  const wStats: Record<string, WeaponStats> = {};
  for (const w of weapons) {
    wStats[w.id] = { id: w.id, category: w.category, apCost: w.apCost, endsTurn: w.endsTurn, range: w.range, requiresLOS: w.requiresLOS, aimMod: w.aimMod, minDmg: w.minDmg, maxDmg: w.maxDmg, crit: w.crit, critBonus: w.critBonus, envDmg: w.envDmg, ignoreHalfCover: w.ignoreHalfCover, closeRangePenalty: w.closeRangePenalty };
  }
  return { units, weapons: wStats, pvp };
}

describe("QA pvp full match (0.14.0)", () => {
  it("alternates turns, respects fog for the other side, and ends with the winner", async () => {
    const { units, weapons, pvp } = buildWorld();
    const pool = pvp.pool.slice(0, 3);
    const session = createSession("menu");
    session.openPvpRoom();
    session.startPvpBattle([...pool], [...pool], 2024);

    // Детерминированный урон: все оружия бьют на 20 (автономный сценарий).
    const lethalWeapons: Record<string, WeaponStats> = {};
    for (const [id, weapon] of Object.entries(weapons)) {
      lethalWeapons[id] = { ...weapon, minDmg: 20, maxDmg: 20 };
    }
    const match = createPvpMatch({ units, map: pvp.map!, side1: pool, side2: pool, seed: 2024 });
    // Расстановка: все бойцы сторон вплотную парами; гарантированное попадание.
    const side1Units = match.entities.filter((e) => e.owner === 1 && e.coverType === 0).sort((a, b) => a.id - b.id);
    const side2Units = match.entities.filter((e) => e.owner === 2 && e.coverType === 0).sort((a, b) => a.id - b.id);
    // Расчистка клеток расстановки (генератор мог создать ямы/стены).
    for (let y = 4; y <= 9; y += 1) {
      for (const x of [5, 6]) {
        const tile = match.grid.tiles.find((t) => t.x === x && t.y === y)!;
        tile.pit = false;
        tile.blockLOS = false;
      }
    }
    side1Units.forEach((unit, i) => {
      unit.x = 5;
      unit.y = 4 + i;
      unit.z = match.grid.tiles.find((t) => t.x === 5 && t.y === 4 + i)!.z;
      unit.aim = 100;
      unit.defense = 0;
    });
    side2Units.forEach((unit, i) => {
      unit.x = 6;
      unit.y = 4 + i;
      unit.z = match.grid.tiles.find((t) => t.x === 6 && t.y === 4 + i)!.z;
      unit.aim = 100;
      unit.defense = 0;
    });
    const host = createTacticsKernel({ initial: match, weapons: lethalWeapons, skills: {}, units, seed: 2024 });
    session.bindTacticsHost(host);

    const endEvents: unknown[] = [];
    const allEvents: unknown[] = [];
    session.subscribePvpEvents((events) => {
      allEvents.push(events);
      const end = events.find((e) => e.type === "MATCH_ENDED");
      if (end && end.type === "MATCH_ENDED") {
        endEvents.push(end);
        const winner = end.winnerPlayerId === "1" ? 1 : end.winnerPlayerId === "2" ? 2 : null;
        if (winner) session.finishPvpMatch(winner);
      }
    });

    // Контракт сокращения: в снимок стороны входят только видимые чужие юниты.
    const visible2 = host.getVisibleCells(2);
    const snap2 = host.getSnapshotFor(2);
    for (const e of snap2.entities) {
      if (e.owner === 1 && e.coverType === 0) {
        expect(visible2.has(`${e.x},${e.y}`)).toBe(true);
      }
    }

    // Ход 1: каждый боец стороны 1 атакует своего визави — вся сторона 2 гибнет.
    const live1 = host.getSnapshot().entities.filter((e) => e.owner === 1 && e.coverType === 0 && !e.dead).sort((a, b) => a.id - b.id);
    const live2 = host.getSnapshot().entities.filter((e) => e.owner === 2 && e.coverType === 0 && !e.dead).sort((a, b) => a.id - b.id);
    live1.forEach((attacker, index) => {
      const target = live2[index];
      if (target) session.sendPvpCommand({ type: "ATTACK", actorId: attacker.id, targetId: target.id, weaponId: attacker.weaponId });
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(host.getSnapshot().entities.filter((e) => e.owner === 2 && e.coverType === 0 && !e.dead)).toHaveLength(0);
    expect(endEvents.length).toBeGreaterThan(0);
    expect(session.get().screen).toBe("result");
    expect(session.get().pvpWinner).toBe(1);
  });

  it("play again opens a fresh room and a fresh battle", async () => {
    const { units, weapons, pvp } = buildWorld();
    const pool = pvp.pool;
    const session = createSession("menu");
    session.openPvpRoom();
    session.startPvpBattle([...pool], [...pool], 1);
    session.finishPvpMatch(2);
    expect(session.get().screen).toBe("result");

    session.openPvpRoom();
    expect(session.get().screen).toBe("pvpRoom");
    expect(session.get().pvpWinner).toBeNull();

    session.startPvpBattle([...pool], [...pool], 2);
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("pvp");
    expect(session.get().pvp).toEqual({ side1: pool, side2: pool });
  });
});
