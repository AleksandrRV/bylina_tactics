import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAINING_UNITS,
  ENEMY_OWNER,
  PLAYER_OWNER,
  createMissionMatch,
  createTacticsKernel,
  defaultWeapons,
  type MatchState,
  type SkillStats,
  type TacticsKernel,
  type TrainingEnemyScript,
  type TrainingEnemyScriptState,
} from "../src/index.js";
import { pickScriptedEnemyCommand } from "../src/training-ai.js";

/**
 * Сценарий Нави режима обучения (0.20.13): линейная очередь действий,
 * авто-сближение при недосягаемости и пропуск невыполнимых записей.
 * Все решения детерминированы. Полный сквозной прогон сценария миссий
 * (яд, воскрешение) покрыт тестами packages/ui на реальном содержимом.
 */

const MAP = {
  width: 10,
  height: 8,
  pitChance: 0.04,
  coverDensity: 0.06,
  wallDensity: 0.02,
  edgeCoverChance: 0.4,
  halfCoverChance: 0.5,
  heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
};

const SKILLS: Record<string, SkillStats> = {
  poison_needles: {
    id: "poison_needles",
    apCost: 1,
    endsTurn: true,
    range: 5,
    requiresLOS: true,
    category: "ranged",
    resolution: "auto",
    envDmg: 0,
    filter: "enemies",
    cooldownTurns: 3,
    effects: [{ type: "applyStatus", status: "poison", duration: 3, magnitude: 2 }],
  },
  raise_skeleton: {
    id: "raise_skeleton",
    apCost: 1,
    endsTurn: true,
    range: 4,
    requiresLOS: true,
    category: "ranged",
    resolution: "auto",
    envDmg: 0,
    filter: "all",
    maxUsesPerBattle: 1,
    effects: [{ type: "spawn", unitId: "upyr", spawnKind: "resurrection" }],
  },
};

function makeKernel(playerSlots: string[], enemies: { unitId: string; count: number }[], seed: number): TacticsKernel {
  const initial: MatchState = createMissionMatch({
    units: Object.values(DEFAULT_TRAINING_UNITS),
    map: MAP,
    playerSlots,
    enemies,
    seed,
  });
  return createTacticsKernel({
    initial,
    weapons: defaultWeapons(),
    skills: SKILLS,
    units: Object.values(DEFAULT_TRAINING_UNITS),
    seed,
  });
}

const COMBAT_SCRIPT: TrainingEnemyScript = {
  priority: [],
  actions: [{ unitId: "upyr", kind: "attack", targetUnitId: "bogatyr", weaponId: "claws" }, { kind: "endTurn" }],
};

describe("pickScriptedEnemyCommand (0.20.13)", () => {
  it("returns null outside the enemy phase", () => {
    const kernel = makeKernel(["bogatyr"], [{ unitId: "upyr", count: 1 }], 46);
    const decision = pickScriptedEnemyCommand(kernel, COMBAT_SCRIPT, { index: 0 });
    expect(decision.command).toBeNull();
  });

  it("follows the scripted queue: approach steps keep the entry pending", () => {
    const kernel = makeKernel(["bogatyr"], [{ unitId: "upyr", count: 1 }], 46);
    kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    const state: TrainingEnemyScriptState = { index: 0 };
    // Первая команда: атака недосягаема — шаг сближения, запись не погашена.
    const first = pickScriptedEnemyCommand(kernel, COMBAT_SCRIPT, state);
    expect(first.command?.type).toBe("MOVE");
    expect(first.state.index).toBe(0);
    kernel.apply(first.command!);
    // Атака всё ещё недосягаема — снова сближение без расхода записи.
    const second = pickScriptedEnemyCommand(kernel, COMBAT_SCRIPT, first.state);
    expect(["MOVE", "ATTACK"]).toContain(second.command?.type);
    // Очередь непогашенных записей не двигалась.
    expect(second.state.index).toBe(second.command?.type === "MOVE" ? 0 : 1);
    // Исполняем записи до конца хода стороны: очередь доходит до маркера.
    let cursor = second.state;
    let sawEnd = false;
    for (let i = 0; i < 8; i += 1) {
      const snap = kernel.getSnapshot();
      if (snap.activeOwner !== ENEMY_OWNER) break;
      const decision = pickScriptedEnemyCommand(kernel, COMBAT_SCRIPT, cursor);
      cursor = decision.state;
      if (!decision.command) {
        sawEnd = true;
        kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        break;
      }
      if (!kernel.apply(decision.command).ok) break;
    }
    expect(sawEnd).toBe(true);
    expect(cursor.index).toBe(2);
  });

  it("skips actions of missing executors and moves to the next entry", () => {
    const kernel = makeKernel(["bogatyr"], [{ unitId: "upyr", count: 1 }], 46);
    kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    const script: TrainingEnemyScript = {
      priority: [],
      actions: [
        { unitId: "kikimora", kind: "skill", skillId: "poison_needles", targetUnitId: "bogatyr" },
        { unitId: "upyr", kind: "defend" },
        { kind: "endTurn" },
      ],
    };
    const decision = pickScriptedEnemyCommand(kernel, script, { index: 0 });
    // Кикиморы на поле нет — запись пропущена, упырь получает стойку.
    expect(decision.command?.type).toBe("DEFEND");
    expect(decision.state.index).toBe(2);
  });

  it("is deterministic: identical runs yield identical commands", () => {
    const a = makeKernel(
      ["bogatyr", "znaharka", "strelets"],
      [
        { unitId: "upyr", count: 1 },
        { unitId: "kikimora", count: 1 },
      ],
      303,
    );
    const b = makeKernel(
      ["bogatyr", "znaharka", "strelets"],
      [
        { unitId: "upyr", count: 1 },
        { unitId: "kikimora", count: 1 },
      ],
      303,
    );
    a.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    b.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    for (let i = 0; i < 6; i += 1) {
      const da = pickScriptedEnemyCommand(a, undefined, { index: 0 });
      const db = pickScriptedEnemyCommand(b, undefined, { index: 0 });
      expect(JSON.stringify(da.command)).toBe(JSON.stringify(db.command));
      if (!da.command || !db.command) break;
      a.apply(da.command);
      b.apply(db.command);
    }
  });

  it("falls back to the deterministic AI when the queue is exhausted", () => {
    const kernel = makeKernel(["bogatyr"], [{ unitId: "upyr", count: 1 }], 46);
    kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    const decision = pickScriptedEnemyCommand(kernel, { priority: [], actions: [] }, { index: 0 });
    expect(decision.command).not.toBeNull();
    expect(["MOVE", "ATTACK", "OVERWATCH"]).toContain(decision.command!.type);
  });
});
