import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { makeGrid, previewAttack, weaponStatsFromRecord, type EntityState } from "@bylina/core";
import { dataTree } from "./training-sim.js";

/**
 * Баланс пролога (0.20.52).
 *
 * Числа живут в данных (`prologue_bestiary.json5`), а проверка — здесь:
 * крыса слабее (здоровье 2, укус 1–2, половина укусов мимо), а герой с
 * дубиной попадает по ней в 75 случаях из ста. Шанс считается ядром, а не
 * арифметикой теста: поправки высоты, стойки и укрытий остаются в силе.
 */

const parsed = parseContent(dataTree());
if (!parsed.ok) throw new Error(`content parse failed: ${JSON.stringify(parsed.issues)}`);
const bestiary = parsed.data.prologueBestiary;
if (!bestiary) throw new Error("prologue bestiary is missing");

const unit = (id: string): (typeof bestiary.units)[number] => {
  const found = bestiary.units.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`unit is missing: ${id}`);
  return found;
};
const weapon = (id: string): (typeof bestiary.weapons)[number] => {
  const found = bestiary.weapons.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`weapon is missing: ${id}`);
  return found;
};

const rat = unit("forest_rat");
const hero = unit("mikula_peasant");
const teeth = weapon("teeth");
const club = weapon("club");

/** Боец на заданной клетке ровного поля: без укрытий и без перепада высот. */
function fighter(id: number, owner: number, x: number, record: typeof rat, weaponId: string): EntityState {
  return {
    id,
    configId: record.id,
    owner,
    x,
    y: 0,
    z: 1,
    dir: 1,
    ap: 2,
    maxAp: 2,
    mobility: record.mobility,
    hp: record.maxHealth,
    maxHp: record.maxHealth,
    aim: record.aim,
    defense: record.defense,
    weaponId,
    weaponIds: [weaponId],
    skillIds: [],
    obstacle: true,
    vision: record.vision,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
  } as EntityState;
}

const chanceOf = (attacker: EntityState, target: EntityState, stats: typeof club): number | undefined =>
  previewAttack(makeGrid(4, 1), [attacker, target], attacker, target, weaponStatsFromRecord(stats)).chance;

describe("баланс пролога (0.20.52)", () => {
  it("крыса слабее: два здоровья и укус 1–2", () => {
    expect(rat.maxHealth, "здоровье крысы").toBe(2);
    expect(teeth.minDmg, "минимальный укус").toBe(1);
    expect(teeth.maxDmg, "максимальный укус").toBe(2);
    expect(teeth.maxDmg - teeth.minDmg, "разброс укуса").toBeLessThanOrEqual(1);
  });

  it("крыса промахивается в половине случаев", () => {
    // Меткость 50 при нулевой защите героя: ровно половина укусов мимо.
    const chance = chanceOf(fighter(2, 2, 1, rat, teeth.id), fighter(1, 1, 0, hero, club.id), teeth);
    expect(chance, "шанс укуса").toBe(50);
  });

  it("герой с дубиной попадает по крысе в 75 случаях из ста", () => {
    const chance = chanceOf(fighter(1, 1, 0, hero, club.id), fighter(2, 2, 1, rat, teeth.id), club);
    expect(chance, "шанс дубины").toBe(75);
  });

  it("дубина не стала слабее: урон крысу берёт с одного-двух ударов", () => {
    // Здоровье крысы (2) обязано уступать урону дубины: учебная мишень
    // не должна требовать трёх попаданий подряд.
    expect(club.minDmg, "минимальный удар дубины").toBeGreaterThanOrEqual(rat.maxHealth);
  });
});
