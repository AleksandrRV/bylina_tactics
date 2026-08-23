import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent } from "@bylina/content";
import {
  createMissionMatch, createTacticsKernel, defaultTrainingWeapons, weaponStatsFromRecord,
  pickEnemyCommand, PLAYER_OWNER, ENEMY_OWNER, livingOf, distH, matchOutcome,
  type GameEvent, type SkillStats, type WeaponStats, type TacticsKernel,
} from "@bylina/core";
import {
  hintCompletedByEvents, shouldAutoEndTurn, trainingActionAllowed, trainingManualTurnRecoveryAllowed,
  trainingHintsSorted, trainingStepAfterAutoSkip,
} from "../src/training-progress.js";

/**
 * Проверка режима обучения по правилам интерфейса (0.20.2): те же семена, что
 * в сессии, действующая Навь в миссиях с противником, гейминг действий по
 * trainingActionAllowed, продвижение шагов по событиям игрока, автопропуск
 * погибшей цели и авто-завершение хода. Цель — убедиться, что каждая миссия
 * завершается победой и что реактивные плашки (яд, воскрешение, призыв)
 * действительно срабатывают в реальном бою.
 */

const SESSION_SEEDS: Record<string, number> = { movement: 101, combat: 46, skills: 303 };

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

interface Sim {
  kernel: TacticsKernel;
  step: number;
  notes: { poison: number; resurrect: number; summon: number };
  hints: ReturnType<typeof trainingHintsSorted>;
  hasEnemies: boolean;
  over: "victory" | "defeat" | null;
}

function start(missionId: string): Sim {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.training.missions.find((m) => m.id === missionId)!;
  const weapons: Record<string, WeaponStats> = { ...defaultTrainingWeapons() };
  for (const w of parsed.data.weapons) weapons[w.id] = weaponStatsFromRecord(w);
  const skills: Record<string, SkillStats> = {};
  for (const s of parsed.data.skills) skills[s.id] = s as unknown as SkillStats;
  const seed = SESSION_SEEDS[missionId]!;
  const kernel = createTacticsKernel({
    initial: createMissionMatch({ units: parsed.data.units, map: mission.map, playerSlots: mission.playerSlots, enemies: mission.enemies, seed }),
    weapons, skills, units: parsed.data.units, seed,
  });
  return {
    kernel,
    step: 0,
    notes: { poison: 0, resurrect: 0, summon: 0 },
    hints: trainingHintsSorted(mission.hints),
    hasEnemies: mission.enemies.length > 0,
    over: null,
  };
}

function activeHint(sim: Sim) {
  return sim.hints[sim.step] ?? null;
}

function can(sim: Sim, action: Parameters<typeof trainingActionAllowed>[1]): boolean {
  const h = activeHint(sim);
  return h ? trainingActionAllowed(h.until, action) : true;
}

function track(sim: Sim, events: GameEvent[]): void {
  for (const event of events) {
    if (event.type === "STATUS_CHANGED" && event.status === "POISON" && event.applied) sim.notes.poison += 1;
    if (event.type === "ENTITY_SPAWNED" && event.cause === "RESURRECTION") sim.notes.resurrect += 1;
    if (event.type === "ENTITY_SPAWNED" && event.cause === "SUMMON") sim.notes.summon += 1;
  }
  // Продвижение шага событиями игрока + автопропуск погибшей цели.
  const h = activeHint(sim);
  if (h && hintCompletedByEvents(h, events)) sim.step += 1;
  sim.step = trainingStepAfterAutoSkip(sim.hints, sim.step, sim.kernel.getSnapshot().entities);
}

function autoEnd(sim: Sim): boolean {
  const snap = sim.kernel.getSnapshot();
  const own = snap.entities.filter((e) => !e.dead && e.coverType === 0 && e.owner === PLAYER_OWNER && e.maxAp > 0);
  return shouldAutoEndTurn({
    paused: false, busy: false, enemyPhase: false, isReplay: false, isSpectator: false,
    isTraining: true, activeHint: activeHint(sim), activeOwner: snap.activeOwner,
    viewOwner: PLAYER_OWNER, ownUnits: own, outcomeOngoing: matchOutcome(snap) === "ongoing", isNetGuest: false,
  });
}

function checkOver(sim: Sim): void {
  if (sim.over) return;
  const outcome = matchOutcome(sim.kernel.getSnapshot());
  const done = sim.hints.length > 0 && sim.step >= sim.hints.length;
  // Как в BattleScreen: миссия с противником играется до итога боя
  // (уничтожение Нави), миссия без противника — до последнего шага.
  const complete = sim.hasEnemies ? outcome === "victory" : done;
  if (complete) sim.over = "victory";
  else if (outcome === "defeat") sim.over = "defeat";
}

/** Разумный ход игрока по активному шагу; возвращает применена ли команда. */
function playerAct(sim: Sim): boolean {
  const snap = sim.kernel.getSnapshot();
  const players = livingOf(snap, PLAYER_OWNER).sort((a, b) => a.id - b.id);
  // Упырь бьётся первым: его тело поднимает кикимора (плашка воскрешения).
  // Кикимора — последний приоритет; внутри группы — добивание раненых.
  const foes = (from: { x: number; y: number }) => [...livingOf(sim.kernel.getSnapshot(), ENEMY_OWNER)].sort((a, b) => {
    const ka = a.configId === "kikimora" ? 1 : 0;
    const kb = b.configId === "kikimora" ? 1 : 0;
    return ka - kb || a.hp - b.hp || distH(from.x, from.y, a.x, a.y) - distH(from.x, from.y, b.x, b.y) || a.id - b.id;
  });
  const until = activeHint(sim)?.until ?? null;

  // Шаг «умение»: по тексту подсказки сперва Призыв зверя Знахарки —
  // плашка призыва срабатывает именно так.
  if (until === "skill") {
    const znaharka = players.find((x) => x.configId === "znaharka" && x.ap > 0 && (x.skillIds ?? []).includes("summon_forest_beast"));
    if (znaharka && !livingOf(snap, PLAYER_OWNER).some((x) => x.configId === "forest_beast")) {
      const around = [
        { x: znaharka.x + 1, y: znaharka.y }, { x: znaharka.x - 1, y: znaharka.y },
        { x: znaharka.x, y: znaharka.y + 1 }, { x: znaharka.x, y: znaharka.y - 1 },
        { x: znaharka.x + 1, y: znaharka.y + 1 }, { x: znaharka.x - 1, y: znaharka.y - 1 },
      ];
      for (const pos of around) {
        const z = snap.grid.tiles.find((t) => t.x === pos.x && t.y === pos.y)?.z ?? 1;
        const r = sim.kernel.apply({ type: "USE_SKILL", actorId: znaharka.id, skillId: "summon_forest_beast", targetPos: { ...pos, z } });
        if (r.ok) { track(sim, r.events); return true; }
      }
    }
  }

  // Шаг «защитная стойка»/«дозор»: предписанное действие первым же бойцом.
  if (until === "defend") {
    const p = players.find((x) => x.ap > 0 && !x.defending);
    if (p) { const r = sim.kernel.apply({ type: "DEFEND", actorId: p.id }); if (r.ok) { track(sim, r.events); return true; } }
  }
  if (until === "overwatch") {
    const p = players.find((x) => x.ap > 0 && !x.overwatch);
    if (p) { const r = sim.kernel.apply({ type: "OVERWATCH", actorId: p.id }); if (r.ok) { track(sim, r.events); return true; } }
  }

  for (const p of players) {
    if (p.ap <= 0) continue;

    // Выживание: знахарка снимает яд и лечит раненых (умение разрешено шагом).
    if (can(sim, "skill") && (p.skillIds ?? []).includes("cleanse")) {
      const poisoned = players.find((x) => x.poison);
      if (poisoned) { const r = sim.kernel.apply({ type: "USE_SKILL", actorId: p.id, skillId: "cleanse", targetId: poisoned.id }); if (r.ok) { track(sim, r.events); return true; } }
    }
    // Атака, если цель в радиусе и шаг разрешает атаку.
    if (can(sim, "attack")) {
      const target = foes(p)[0];
      if (target) {
        const preview = sim.kernel.getHitPreview(p.id, target.id);
        if (preview.available) {
          const r = sim.kernel.apply({ type: "ATTACK", actorId: p.id, targetId: target.id, weaponId: p.weaponId });
          if (r.ok) { track(sim, r.events); return true; }
        }
      }
    }

    // Лечение — только когда боец заметно ранен: иначе знахарка лечила бы
    // каждый ход вместо атак и бой затягивался до поражения.
    if (can(sim, "skill") && (p.skillIds ?? []).includes("heal")) {
      const wounded = [...players].filter((x) => x.hp * 2 <= x.maxHp).sort((a, b) => a.hp - b.hp)[0];
      if (wounded) { const r = sim.kernel.apply({ type: "USE_SKILL", actorId: p.id, skillId: "heal", targetId: wounded.id }); if (r.ok) { track(sim, r.events); return true; } }
    }

    // Перемещение: для шагов с нужной ценой — клетка этой цены, иначе к врагу.
    if (can(sim, "move") || can(sim, "dash")) {
      const reach = sim.kernel.getReachable(p.id);
      const target = foes(p)[0];
      let cells = reach;
      if (until === "move") cells = reach.filter((c) => c.apCost === 1);
      if (until === "dash") cells = reach.filter((c) => c.apCost === 2);
      const pool = cells.length > 0 ? cells : reach;
      const pick = target
        ? [...pool].sort((a, b) => distH(a.x, a.y, target.x, target.y) - distH(b.x, b.y, target.x, target.y) || a.apCost - b.apCost)[0]
        : [...pool].sort((a, b) => b.mpCost - a.mpCost)[0];
      if (pick) {
        const r = sim.kernel.apply({ type: "MOVE", actorId: p.id, to: pick });
        if (r.ok) { track(sim, r.events); return true; }
      }
    }
  }
  return false;
}

function enemyTurn(sim: Sim): void {
  for (let guard = 0; guard < 96; guard += 1) {
    const snap = sim.kernel.getSnapshot();
    if (snap.activeOwner !== ENEMY_OWNER) break;
    if (matchOutcome(snap) !== "ongoing") break;
    const command = pickEnemyCommand(sim.kernel);
    const applied = command
      ? sim.kernel.apply(command)
      : sim.kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
    if (!applied.ok) { sim.kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) }); break; }
    track(sim, applied.events);
    if (!command) break;
  }
}

function run(missionId: string, verbose = false): Sim {
  const sim = start(missionId);
  for (let turn = 0; turn < 120 && !sim.over; turn += 1) {
    if (verbose) {
      const s = sim.kernel.getSnapshot();
      const hp = (o: number) => livingOf(s, o).map((e) => `${e.configId}:${e.hp}${e.poison ? "(p)" : ""}${e.defending ? "(d)" : ""}${e.overwatch ? "(o)" : ""}`).join(" ");
      console.log(`t${s.turnNumber} owner=${s.activeOwner} step=${sim.step}/${sim.hints.length} P[${hp(PLAYER_OWNER)}] E[${hp(ENEMY_OWNER)}]`);
    }
    checkOver(sim);
    if (sim.over) break;
    const snap = sim.kernel.getSnapshot();
    if (snap.activeOwner !== PLAYER_OWNER) {
      if (sim.hasEnemies) enemyTurn(sim);
      else sim.kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
      checkOver(sim);
      continue;
    }
    // Ознакомительный шаг — клик (продвигаем без события).
    if (activeHint(sim)?.until === "noop") {
      sim.step = trainingStepAfterAutoSkip(sim.hints, sim.step + 1, sim.kernel.getSnapshot().entities);
      continue;
    }
    const endPlayerTurn = (): void => {
      const r = sim.kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
      if (r.ok) track(sim, r.events); // TURN_CHANGED продвигает шаг «завершите ход».
    };
    if (autoEnd(sim)) { endPlayerTurn(); checkOver(sim); continue; }
    const acted = playerAct(sim);
    if (!acted) endPlayerTurn();
    checkOver(sim);
  }
  return sim;
}

describe("training missions under real UI rules (0.20.2)", () => {
  it("movement completes with a victory", () => {
    const sim = run("movement");
    expect(sim.over).toBe("victory");
    expect(sim.step).toBeGreaterThanOrEqual(sim.hints.length);
  });

  it("combat completes with a victory", () => {
    const sim = run("combat");
    expect(sim.over).toBe("victory");
  });

  it("skills completes with a victory and all reactive notes fire", () => {
    const sim = run("skills");
    expect(sim.over).toBe("victory");
    expect(sim.notes.poison).toBeGreaterThan(0);
    expect(sim.notes.resurrect).toBeGreaterThan(0);
    expect(sim.notes.summon).toBeGreaterThan(0);
  });
});


describe("training AP exhaustion safeguards (0.20.6)", () => {
  const base = (activeHint: { until: string } | null, isTraining = true) => shouldAutoEndTurn({
    paused: false, busy: false, enemyPhase: false, isReplay: false, isSpectator: false,
    isTraining, activeHint: activeHint as Sim["hints"][number] | null,
    activeOwner: PLAYER_OWNER, viewOwner: PLAYER_OWNER, ownUnits: [{ ap: 0 }],
    outcomeOngoing: true, isNetGuest: false,
  });

  it("never auto-ends an unfinished concrete training action", () => {
    for (const until of ["move", "dash", "attack", "skill", "defend", "overwatch", "approach", "end_turn", "noop"]) {
      expect(base({ until })).toBe(false);
    }
  });

  it("keeps normal auto-ending after hints are complete and outside training", () => {
    expect(base(null)).toBe(true);
    expect(base({ until: "attack" }, false)).toBe(true);
  });

  it("allows an explicit recovery turn only after AP are exhausted", () => {
    expect(trainingManualTurnRecoveryAllowed({ until: "skill" } as Sim["hints"][number], [{ ap: 0 }])).toBe(true);
    expect(trainingManualTurnRecoveryAllowed({ until: "attack" } as Sim["hints"][number], [{ ap: 1 }])).toBe(false);
    expect(trainingManualTurnRecoveryAllowed(null, [{ ap: 0 }])).toBe(false);
  });
});
