import { describe, expect, it } from "vitest";
import {
  createTacticsKernel,
  makeGrid,
  weaponStatsFromRecord,
  type EntityState,
  type SkillStats,
  type WeaponStats,
} from "@bylina/core";
import { meleeStrikeOf, planCharge } from "../src/charge-attack.js";

/**
 * Рывок к цели ближнего боя (0.20.50): клетка подхода, её стоимость и
 * случай, когда рывка не бывает. Проверки чистые — своё ядро на
 * коридоре из восьми клеток, без интерфейса.
 */

const SWORD: WeaponStats = weaponStatsFromRecord({
  id: "sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 4,
  maxDmg: 6,
  crit: 15,
  critBonus: 2,
  envDmg: 0,
});
const BOW: WeaponStats = weaponStatsFromRecord({
  id: "bow",
  category: "ranged",
  apCost: 1,
  endsTurn: true,
  range: 6,
  requiresLOS: true,
  aimMod: 0,
  minDmg: 3,
  maxDmg: 5,
  crit: 10,
  critBonus: 1,
  envDmg: 0,
});
const SHIELD_BASH: SkillStats = {
  id: "shield_bash",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  category: "melee",
  resolution: "attack",
  envDmg: 0,
  filter: "enemies",
  cooldownTurns: 1,
  effects: [{ type: "damage", minDmg: 1, maxDmg: 2 }, { type: "knockback" }],
};
const SWEEP: SkillStats = {
  id: "circular_sweep",
  apCost: 1,
  endsTurn: true,
  range: 0,
  requiresLOS: false,
  category: "self",
  resolution: "attack",
  envDmg: 0,
  radius: 1,
  filter: "all",
  effects: [{ type: "damage", minDmg: 3, maxDmg: 4 }],
};

function fighter(overrides: Partial<EntityState> & { id: number; owner: number; x: number }): EntityState {
  return {
    configId: overrides.owner === 1 ? "bogatyr" : "upyr",
    y: 0,
    z: 1,
    dir: 1,
    ap: 2,
    maxAp: 2,
    mobility: 4,
    hp: 12,
    maxHp: 12,
    aim: 70,
    defense: 0,
    weaponId: "sword",
    weaponIds: ["sword", "bow"],
    skillIds: ["shield_bash", "circular_sweep"],
    obstacle: true,
    vision: 10,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
    ...overrides,
  } as EntityState;
}

function setup(heroX: number, enemyX: number, heroAp = 2) {
  const hero = fighter({ id: 1, owner: 1, x: heroX, ap: heroAp });
  const enemy = fighter({ id: 2, owner: 2, x: enemyX });
  const kernel = createTacticsKernel({
    initial: { turnNumber: 1, activeOwner: 1, grid: makeGrid(8, 1), entities: [hero, enemy] },
    weapons: { sword: SWORD, bow: BOW },
    skills: { shield_bash: SHIELD_BASH, circular_sweep: SWEEP },
    seed: 11,
    fogDisabled: true,
  });
  return { kernel, hero, enemy };
}

const weapons = { sword: SWORD, bow: BOW };
const skills = { shield_bash: SHIELD_BASH, circular_sweep: SWEEP };

describe("рывок к цели ближнего боя (0.20.50)", () => {
  it("ведёт в ближайшую по очкам движения клетку, откуда удар достижим", () => {
    const { kernel, hero, enemy } = setup(0, 3);
    const strike = meleeStrikeOf({ type: "weapon", id: "sword" }, weapons, skills)!;
    expect(strike).not.toBeNull();
    const plan = planCharge({
      snapshot: kernel.getSnapshot(),
      actor: hero,
      target: enemy,
      strike,
      reachable: kernel.getReachable(hero.id),
      pathOf: (cell) => kernel.getPath(hero.id, cell),
    });
    // Цель в трёх клетках: бьём из соседней — двух очков движения.
    expect(plan, "рывок найден").not.toBeNull();
    expect(plan!.step.x).toBe(2);
    expect(plan!.mpCost).toBe(2);
    expect(plan!.apCost).toBe(1);
    // Маршрут начинается в своей клетке и заканчивается в клетке подхода.
    expect(plan!.path[0]).toMatchObject({ x: 0, y: 0 });
    expect(plan!.path[plan!.path.length - 1]).toMatchObject({ x: 2, y: 0 });
  });

  it("не предлагает рывок, если удара хватает с места", () => {
    const { kernel, hero, enemy } = setup(0, 1);
    const strike = meleeStrikeOf({ type: "weapon", id: "sword" }, weapons, skills)!;
    const plan = planCharge({
      snapshot: kernel.getSnapshot(),
      actor: hero,
      target: enemy,
      strike,
      reachable: kernel.getReachable(hero.id),
      pathOf: (cell) => kernel.getPath(hero.id, cell),
    });
    expect(plan, "цель рядом — бьём без подхода").toBeNull();
  });

  it("не предлагает рывок без очков действия на удар", () => {
    const { kernel, hero, enemy } = setup(0, 3, 1);
    const strike = meleeStrikeOf({ type: "weapon", id: "sword" }, weapons, skills)!;
    const plan = planCharge({
      snapshot: kernel.getSnapshot(),
      actor: hero,
      target: enemy,
      strike,
      reachable: kernel.getReachable(hero.id),
      pathOf: (cell) => kernel.getPath(hero.id, cell),
    });
    expect(plan, "одно ОД уходит на удар — подхода нет").toBeNull();
  });

  it("не предлагает рывок, если до цели не дойти", () => {
    // Семь клеток при подвижности 4: за два очка действия дойти нельзя.
    const { kernel, hero, enemy } = setup(0, 7);
    const strike = meleeStrikeOf({ type: "weapon", id: "sword" }, weapons, skills)!;
    const plan = planCharge({
      snapshot: kernel.getSnapshot(),
      actor: hero,
      target: enemy,
      strike,
      reachable: kernel.getReachable(hero.id),
      pathOf: (cell) => kernel.getPath(hero.id, cell),
    });
    expect(plan).toBeNull();
  });

  it("не рывок для дальнего оружия и площадного умения", () => {
    expect(meleeStrikeOf({ type: "weapon", id: "bow" }, weapons, skills)).toBeNull();
    expect(meleeStrikeOf({ type: "skill", id: "circular_sweep" }, weapons, skills)).toBeNull();
  });

  it("подходит и под близкое умение одной цели", () => {
    const { kernel, hero, enemy } = setup(0, 3);
    const strike = meleeStrikeOf({ type: "skill", id: "shield_bash" }, weapons, skills);
    expect(strike?.kind).toBe("skill");
    const plan = planCharge({
      snapshot: kernel.getSnapshot(),
      actor: hero,
      target: enemy,
      strike: strike!,
      reachable: kernel.getReachable(hero.id),
      pathOf: (cell) => kernel.getPath(hero.id, cell),
    });
    expect(plan, "удар щитом — тоже рывок").not.toBeNull();
    expect(plan!.step.x).toBe(2);
  });
});
