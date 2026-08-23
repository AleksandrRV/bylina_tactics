import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";
import { createMissionMatch, createTacticsKernel, defaultTrainingWeapons, weaponStatsFromRecord, pickEnemyCommand, PLAYER_OWNER, ENEMY_OWNER, livingOf, distH } from "@bylina/core";
import type { EntityState, GameEvent, SkillStats, WeaponStats } from "@bylina/core";
import type { TrainingMissionConfig } from "@bylina/content";
import { hintCompletedByEvents } from "../src/training-progress.js";

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

function makeKernel(mission: TrainingMissionConfig, seed: number) {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content broken");
  const weapons: Record<string, WeaponStats> = { ...defaultTrainingWeapons() };
  for (const w of parsed.data.weapons) weapons[w.id] = weaponStatsFromRecord(w);
  const skills: Record<string, SkillStats> = {};
  for (const s of parsed.data.skills) skills[s.id] = s as unknown as SkillStats;
  return createTacticsKernel({
    initial: createMissionMatch({ units: parsed.data.units, map: mission.map, playerSlots: mission.playerSlots, enemies: mission.enemies, seed }),
    weapons, skills, units: parsed.data.units, seed,
  });
}

function nearestFoe(kernel: ReturnType<typeof makeKernel>, actor: EntityState): EntityState | undefined {
  const foes = livingOf(kernel.getSnapshot(), ENEMY_OWNER).filter((e) => !e.hidden);
  return [...foes].sort((a, b) => {
    const ta = (e: EntityState) => (e.configId === "kikimora" ? 1000 : 0) + distH(actor.x, actor.y, e.x, e.y);
    return ta(a) - ta(b);
  })[0];
}

/**
 * Бот, выполняющий ровно то действие, которого ждёт активный шаг подсказки.
 * Возвращает события применённых команд (для продвижения шагов).
 */
function actPerHint(kernel: ReturnType<typeof makeKernel>, until: string): GameEvent[] {
  const snap = kernel.getSnapshot();
  const players = livingOf(snap, PLAYER_OWNER).sort((a, b) => a.id - b.id);
  for (const p of players) {
    if (p.ap <= 0) continue;
    if (until === "end_turn") break;
    if (until === "defend") {
      const r = kernel.apply({ type: "DEFEND", actorId: p.id });
      if (r.ok) return r.events;
    }
    if (until === "overwatch") {
      const r = kernel.apply({ type: "OVERWATCH", actorId: p.id });
      if (r.ok) return r.events;
    }
    if (until === "skill") {
      for (const sid of p.skillIds ?? []) {
        const def = kernel.getSkillDefinition(sid);
        if (!def || def.category === "self" || def.resolution !== "auto") continue;
        if (def.effects.some((e) => e.type === "heal")) {
          const wounded = players.find((x) => x.hp < x.maxHp && x.id !== p.id);
          const pre = wounded ? kernel.getSkillPreview(p.id, sid, wounded.id) : undefined;
          if (pre?.available) { const r = kernel.apply({ type: "USE_SKILL", actorId: p.id, skillId: sid, targetId: wounded!.id }); if (r.ok) return r.events; }
        }
        if (def.effects.some((e) => e.type === "applyStatus" && e.status === "poison")) continue; // не лечим яд тут
        if (def.effects.some((e) => e.type === "spawn" && e.spawnKind === "summon")) {
          const reach = kernel.getReachable(p.id);
          const pos = reach[reach.length - 1];
          const pre = pos ? kernel.getSkillPreview(p.id, sid, undefined, { x: pos.x, y: pos.y, z: pos.z }) : undefined;
          if (pre?.available) { const r = kernel.apply({ type: "USE_SKILL", actorId: p.id, skillId: sid, targetPos: { x: pos.x, y: pos.y, z: pos.z } }); if (r.ok) return r.events; }
          continue;
        }
        const foes = livingOf(snap, ENEMY_OWNER).filter((e) => !e.hidden);
        for (const foe of foes) {
          const pre = kernel.getSkillPreview(p.id, sid, foe.id);
          if (pre?.available) { const r = kernel.apply({ type: "USE_SKILL", actorId: p.id, skillId: sid, targetId: foe.id }); if (r.ok) return r.events; }
        }
      }
      continue;
    }
    if (until === "dash") {
      const reach = kernel.getReachable(p.id);
      const dashCell = reach.filter((c) => c.apCost === 2).sort((a, b) => b.mpCost - a.mpCost)[0];
      if (dashCell) { const r = kernel.apply({ type: "MOVE", actorId: p.id, to: dashCell }); if (r.ok) return r.events; }
      continue;
    }
    // move / attack / approach / noop: сначала лечение и очищение (разумный игрок).
    if (until === "noop" || until === "approach") {
      const wounded = players.find((x) => x.hp < x.maxHp && x.id !== p.id);
      const poisoned = players.find((x) => x.poison);
      for (const sid of p.skillIds ?? []) {
        const def = kernel.getSkillDefinition(sid);
        if (!def) continue;
        if (def.effects.some((e) => e.type === "heal") && wounded) {
          const pre = kernel.getSkillPreview(p.id, sid, wounded.id);
          if (pre?.available) { const r = kernel.apply({ type: "USE_SKILL", actorId: p.id, skillId: sid, targetId: wounded.id }); if (r.ok) return r.events; }
        }
        if (def.effects.some((e) => e.type === "removeStatus") && poisoned) {
          const pre = kernel.getSkillPreview(p.id, sid, poisoned.id);
          if (pre?.available) { const r = kernel.apply({ type: "USE_SKILL", actorId: p.id, skillId: sid, targetId: poisoned.id }); if (r.ok) return r.events; }
        }
      }
    }
    // move / attack / approach / noop: атакуем, если цель в радиусе, иначе движемся.
    const foe = nearestFoe(kernel, p);
    if (foe && until !== "move") {
      const pre = kernel.getHitPreview(p.id, foe.id);
      if (pre.available) { const r = kernel.apply({ type: "ATTACK", actorId: p.id, targetId: foe.id, weaponId: p.weaponId }); if (r.ok) return r.events; }
    }
    const reach = kernel.getReachable(p.id);
    const moveCell = reach.filter((c) => c.apCost === 1).sort((a, b) => b.mpCost - a.mpCost)[0] ?? reach[0];
    if (moveCell) { const r = kernel.apply({ type: "MOVE", actorId: p.id, to: moveCell }); if (r.ok) return r.events; }
  }
  // Нет действий — завершаем ход.
  const r = kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
  return r.ok ? r.events : [];
}

function enemyTurn(kernel: ReturnType<typeof makeKernel>): void {
  for (let guard = 0; guard < 96; guard += 1) {
    const snap = kernel.getSnapshot();
    if (snap.activeOwner !== ENEMY_OWNER) break;
    const cmd = pickEnemyCommand(kernel);
    const applied = cmd ? kernel.apply(cmd) : kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
    if (!applied.ok) { kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) }); break; }
    if (!cmd) break;
  }
}

describe("QA manual: training missions follow the hint steps exactly", () => {
  it("movement mission: noop -> move -> end_turn -> dash -> end_turn, then victory", () => {
    const parsed = parseContent(dataTree());
    if (!parsed.ok) throw new Error("content broken");
    const mission = parsed.data.training.missions.find((m) => m.id === "movement")!;
    const kernel = makeKernel(mission, 42);
    const hints = [...mission.hints].sort((a, b) => a.step - b.step);
    let step = 0;
    const visited: string[] = [];
    // В «Первых шагах» противника нет (окружение соответствует уроку
    // перемещения), поэтому не прерываем цикл по отсутствию врага — ведём
    // игрока по шагам подсказки до их завершения.
    const hasEnemies = mission.enemies.length > 0;
    for (let turn = 0; turn < 60 && step < hints.length; turn += 1) {
      const snap = kernel.getSnapshot();
      if (snap.activeOwner !== PLAYER_OWNER) { enemyTurn(kernel); continue; }
      if (hasEnemies && livingOf(snap, ENEMY_OWNER).length === 0) break;
      const until = hints[step]!.until;
      const events = actPerHint(kernel, until);
      if (until === "end_turn" && events.some((e) => e.type === "TURN_CHANGED")) {
        visited.push(until);
        step += 1;
        continue;
      }
      if (hintCompletedByEvents(hints[step]!, events)) {
        visited.push(until);
        step += 1;
      }
    }
    expect(visited).toEqual(["noop", "move", "end_turn", "dash", "end_turn"]);
    // После шагов — победа в бою.
    for (let turn = 0; turn < 60; turn += 1) {
      const snap = kernel.getSnapshot();
      if (livingOf(snap, ENEMY_OWNER).length === 0) break;
      if (livingOf(snap, PLAYER_OWNER).length === 0) break;
      if (snap.activeOwner !== PLAYER_OWNER) { enemyTurn(kernel); continue; }
      actPerHint(kernel, "noop");
    }
    const finalSnap = kernel.getSnapshot();
    console.log("movement final: turn", finalSnap.turnNumber,
      "player hp", livingOf(finalSnap, PLAYER_OWNER).map((e) => `${e.configId}:${e.hp}`).join(","),
      "enemy hp", livingOf(finalSnap, ENEMY_OWNER).map((e) => `${e.configId}:${e.hp}`).join(","));
    expect(livingOf(kernel.getSnapshot(), ENEMY_OWNER).length).toBe(0);
  });

  it("combat mission: attack -> approach, then victory", () => {
    const parsed = parseContent(dataTree());
    if (!parsed.ok) throw new Error("content broken");
    const mission = parsed.data.training.missions.find((m) => m.id === "combat")!;
    const kernel = makeKernel(mission, 42);
    const hints = [...mission.hints].sort((a, b) => a.step - b.step);
    let step = 0;
    const visited: string[] = [];
    for (let turn = 0; turn < 60 && step < hints.length; turn += 1) {
      const snap = kernel.getSnapshot();
      if (snap.activeOwner !== PLAYER_OWNER) { enemyTurn(kernel); continue; }
      const until = hints[step]!.until;
      const events = actPerHint(kernel, until);
      if (hintCompletedByEvents(hints[step]!, events)) { visited.push(until); step += 1; }
    }
    expect(visited[0]).toBe("attack");
    expect(visited).toContain("approach");
    for (let turn = 0; turn < 60; turn += 1) {
      const snap = kernel.getSnapshot();
      if (livingOf(snap, ENEMY_OWNER).length === 0) break;
      if (snap.activeOwner !== PLAYER_OWNER) { enemyTurn(kernel); continue; }
      actPerHint(kernel, "noop");
    }
    expect(livingOf(kernel.getSnapshot(), ENEMY_OWNER).length).toBe(0);
  });

  it("skills mission: skill -> defend -> overwatch, then victory", () => {
    const parsed = parseContent(dataTree());
    if (!parsed.ok) throw new Error("content broken");
    const mission = parsed.data.training.missions.find((m) => m.id === "skills")!;
    const kernel = makeKernel(mission, 42);
    const hints = [...mission.hints].sort((a, b) => a.step - b.step);
    let step = 0;
    const visited: string[] = [];
    for (let turn = 0; turn < 80 && step < hints.length; turn += 1) {
      const snap = kernel.getSnapshot();
      if (snap.activeOwner !== PLAYER_OWNER) { enemyTurn(kernel); continue; }
      const until = hints[step]!.until;
      const events = actPerHint(kernel, until);
      if (hintCompletedByEvents(hints[step]!, events)) { visited.push(until); step += 1; }
    }
    const preFinal = kernel.getSnapshot();
    expect(visited).toEqual(["skill", "defend", "overwatch"]);
    for (let turn = 0; turn < 80; turn += 1) {
      const snap = kernel.getSnapshot();
      if (livingOf(snap, ENEMY_OWNER).length === 0) break;
      if (livingOf(snap, PLAYER_OWNER).length === 0) break;
      if (snap.activeOwner !== PLAYER_OWNER) { enemyTurn(kernel); continue; }
      actPerHint(kernel, "noop");
    }
    const snap2 = kernel.getSnapshot();
    expect(livingOf(kernel.getSnapshot(), ENEMY_OWNER).length).toBe(0);
  });
});
