/**
 * День 9 (0.21.8, P1-4 часть 1): исчерпывающая проверка cloneState.
 *
 * Снимок состояния обязан быть глубокой копией: значения сохранены и ни на
 * одном уровне вложенности нет общей ссылки со снимком, переданным ядру, и
 * между двумя снимками. Без полного набора необязательных полей (poison,
 * panic, skillCooldowns, skillUses, weaponIds, skillIds, immobileTurns,
 * timedLife, extracted, apple, objective, edge) тест пропустил бы ровно те
 * строки cloneState, которые раскладывают вложенные объекты/массивы.
 *
 * Проверка глушением: удаление любой строки глубокого копирования в
 * cloneState делает вложенную структуру общей ссылкой — её находит и обход
 * графа (нет общей ссылки на каждом уровне), и проверка мутациями
 * (изменение снимка не меняет ни другой снимок, ни состояние ядра).
 */
import { describe, expect, it } from "vitest";
import { createTacticsKernel, type TacticsKernel } from "../src/kernel.js";
import { makeGrid } from "../src/grid.js";
import type { EntityState, MatchState } from "../src/types.js";

/** Юнит со всеми необязательными полями, несущими данные. */
function fullEntity(overrides: Partial<EntityState> = {}): EntityState {
  return {
    id: 1,
    configId: "unit-hero",
    owner: 1,
    x: 1,
    y: 1,
    z: 0,
    dir: 0,
    ap: 2,
    maxAp: 2,
    mobility: 5,
    hp: 8,
    maxHp: 10,
    aim: 70,
    defense: 10,
    vision: 8,
    will: 60,
    weaponId: "sword",
    weaponIds: ["sword", "bow"],
    skillIds: ["dash", "fireball"],
    skillCooldowns: { dash: 1, fireball: 2 },
    skillUses: { dash: 0, fireball: 3 },
    obstacle: false,
    dead: false,
    flying: false,
    hidden: false,
    decoy: false,
    poison: { damagePerTurn: 2, turnsLeft: 3 },
    panic: { sourceId: 7, turnsLeft: 1 },
    immobileTurns: 2,
    timedLife: 5,
    countsForElimination: true,
    camouflageMinCover: false,
    providesCamouflage: false,
    preferredRange: 3,
    fleeHp: 2,
    coverType: 1,
    edge: 2,
    overwatch: false,
    defending: true,
    movementSpent: 4,
    rosterIndex: 0,
    ...overrides,
  };
}

/** Полное состояние партии: каждое необязательное поле заполнено. */
function fullMatch(): MatchState {
  const grid = makeGrid(6, 6, 1);
  // Пометить пару клеток: зона эвакуации и домашний край — обе
  // необязательные метки клетки тоже проходят через клон.
  const tile = grid.tiles[0]!;
  tile.extract = true;
  tile.homeOwner = 1;
  tile.blockLOS = true;
  tile.pit = true;

  const entity = fullEntity();
  const foe = fullEntity({ id: 2, configId: "unit-foe", owner: 2, x: 4, y: 4, rosterIndex: undefined });

  return {
    turnNumber: 3,
    activeOwner: 1,
    grid,
    entities: [entity, foe],
    rngSeed: "1234567890",
    rngState: "99887766",
    objective: { kind: "destroy", unitId: "unit-foe" },
    extracted: [{ rosterIndex: 0, hp: 4 }],
    apple: { pos: { x: 2, y: 2, z: 0 }, carrierId: null },
  };
}

/**
 * Обход двух значений: на каждом уровне, где встретились два объекта/массива,
 * ссылки обязаны различаться, а содержимое — совпадать. Возвращает число
 * проверенных «вложенных» узлов (объектов/массивов), чтобы тест доказал, что
 * действительно прошёл по структурам, а не по примитивам.
 */
function assertDeepDistinct(expected: unknown, actual: unknown, path: string): number {
  if (typeof expected !== "object" || expected === null) {
    expect(actual, path).toEqual(expected);
    return 0;
  }
  expect(actual, `${path}: ожидается объект`).not.toBeNull();
  // Ключевая проверка cloneState: вложенная структура — не та же ссылка.
  expect(actual, `${path}: общая ссылка — cloneState не скопировал уровень`).not.toBe(expected);

  let nodes = 1;
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: массив`).toBe(true);
    const actualArray = actual as unknown[];
    expect(actualArray.length, `${path}: длина`).toBe(expected.length);
    expected.forEach((item, index) => {
      nodes += assertDeepDistinct(item, actualArray[index], `${path}[${index}]`);
    });
  } else {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = Object.keys(expectedRecord);
    expect(Object.keys(actualRecord).sort(), `${path}: набор ключей`).toEqual(keys.sort());
    for (const key of keys) {
      nodes += assertDeepDistinct(expectedRecord[key], actualRecord[key], `${path}.${key}`);
    }
  }
  return nodes;
}

/** Собрать все объекты/массивы внутри значения (включая корень). */
function collectReferences(value: unknown, out: object[] = []): object[] {
  if (typeof value !== "object" || value === null) return out;
  out.push(value);
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, out);
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) collectReferences(item, out);
  }
  return out;
}

describe("cloneState: глубокая копия снимка", () => {
  it("сохраняет все значения, включая полностью заполненные необязательные поля", () => {
    const initial = fullMatch();
    const kernel = createTacticsKernel({ initial });
    const snapshot = kernel.getSnapshot();
    expect(snapshot).toEqual(
      // ядро переустанавливает rngState из ГПСЧ и проставляет rngSeed;
      // сравниваем по структуре, не привязываясь к служебным полям RNG.
      expect.objectContaining({
        turnNumber: 3,
        activeOwner: 1,
        objective: { kind: "destroy", unitId: "unit-foe" },
        extracted: [{ rosterIndex: 0, hp: 4 }],
        apple: { pos: { x: 2, y: 2, z: 0 }, carrierId: null },
      }),
    );
    const hero = snapshot.entities[0]!;
    expect(hero.poison).toEqual({ damagePerTurn: 2, turnsLeft: 3 });
    expect(hero.panic).toEqual({ sourceId: 7, turnsLeft: 1 });
    expect(hero.skillCooldowns).toEqual({ dash: 1, fireball: 2 });
    expect(hero.skillUses).toEqual({ dash: 0, fireball: 3 });
    expect(hero.weaponIds).toEqual(["sword", "bow"]);
    expect(hero.skillIds).toEqual(["dash", "fireball"]);
    expect(hero.immobileTurns).toBe(2);
    expect(hero.timedLife).toBe(5);
    expect(hero.edge).toBe(2);
    expect(hero.rosterIndex).toBe(0);
    expect(snapshot.grid.tiles[0]).toMatchObject({ extract: true, homeOwner: 1, blockLOS: true, pit: true });
  });

  it("ни на одном уровне вложенности нет общей ссылки со снимком, переданным ядру", () => {
    const initial = fullMatch();
    const kernel = createTacticsKernel({ initial });
    const snapshot = kernel.getSnapshot();
    // Сравниваем по полям, которые передали: служебные rngSeed/rngState ядро
    // перезаписывает, поэтому проверяем структуру состояния целиком по
    // переданным вложенным объектам.
    const compared =
      assertDeepDistinct(initial.grid, snapshot.grid, "grid") +
      assertDeepDistinct(initial.entities, snapshot.entities, "entities") +
      assertDeepDistinct(initial.objective, snapshot.objective, "objective") +
      assertDeepDistinct(initial.extracted, snapshot.extracted, "extracted") +
      assertDeepDistinct(initial.apple, snapshot.apple, "apple");
    // Прошли по вложенной структуре, а не только по примитивам.
    expect(compared).toBeGreaterThan(20);
    // Сами объекты-сущности и сетка — тоже новые ссылки (клон проходит по
    // массиву, а не возвращает переданный элемент).
    expect(snapshot.entities[0]).not.toBe(initial.entities[0]);
    expect(snapshot.entities[1]).not.toBe(initial.entities[1]);
    expect(snapshot.grid).not.toBe(initial.grid);
    expect(snapshot.grid.tiles[0]).not.toBe(initial.grid.tiles[0]);
    expect(snapshot.apple).not.toBe(initial.apple);
    expect(snapshot.extracted).not.toBe(initial.extracted);
    expect(snapshot.objective).not.toBe(initial.objective);
    // Явная проверка на каждом из «горячих» вложенных полей.
    const hero = snapshot.entities[0]!;
    const initialHero = initial.entities[0]!;
    expect(hero.poison).not.toBe(initialHero.poison);
    expect(hero.panic).not.toBe(initialHero.panic);
    expect(hero.skillCooldowns).not.toBe(initialHero.skillCooldowns);
    expect(hero.skillUses).not.toBe(initialHero.skillUses);
    expect(hero.weaponIds).not.toBe(initialHero.weaponIds);
    expect(hero.skillIds).not.toBe(initialHero.skillIds);
    expect(snapshot.apple!.pos).not.toBe(initial.apple!.pos);
  });

  it("два последовательных снимка не делят ссылки", () => {
    const kernel = createTacticsKernel({ initial: fullMatch() });
    const first = kernel.getSnapshot();
    const second = kernel.getSnapshot();
    const refsFirst = new Set(collectReferences(first));
    const refsSecond = collectReferences(second);
    const shared = refsSecond.filter((ref) => refsFirst.has(ref));
    expect(shared, `общие ссылки между снимками: ${shared.length}`).toHaveLength(0);
    expect(second).toEqual(first);
  });

  it("мутация выданного снимка не меняет состояние ядра и другой снимок", () => {
    const kernel = createTacticsKernel({ initial: fullMatch() });
    const snapshot = kernel.getSnapshot();
    // Портировать вложенные структуры: ядро не должно видеть этих изменений.
    snapshot.entities[0]!.hp = 0;
    snapshot.entities[0]!.poison!.turnsLeft = 99;
    snapshot.entities[0]!.skillCooldowns!.dash = 99;
    snapshot.entities[0]!.weaponIds!.push("hacked-weapon");
    snapshot.grid.tiles[0]!.pit = false;
    if (snapshot.objective && "unitId" in snapshot.objective) snapshot.objective.unitId = "tampered";
    snapshot.extracted!.push({ rosterIndex: 99, hp: 1 });
    snapshot.apple!.carrierId = 5;
    snapshot.apple!.pos.x = 99;

    const fresh = kernel.getSnapshot();
    expect(fresh.entities[0]!.hp).not.toBe(0);
    expect(fresh.entities[0]!.poison!.turnsLeft).toBe(3);
    expect(fresh.entities[0]!.skillCooldowns!.dash).toBe(1);
    expect(fresh.entities[0]!.weaponIds).not.toContain("hacked-weapon");
    expect(fresh.grid.tiles[0]!.pit).toBe(true);
    expect(fresh.objective).toEqual({ kind: "destroy", unitId: "unit-foe" });
    expect(fresh.objective && "unitId" in fresh.objective ? fresh.objective.unitId : "").toBe("unit-foe");
    expect(fresh.extracted).toEqual([{ rosterIndex: 0, hp: 4 }]);
    expect(fresh.apple!.carrierId).toBeNull();
    expect(fresh.apple!.pos.x).toBe(2);
  });

  it("мутация исходного состояния после создания ядра не влияет на ядро", () => {
    const initial = fullMatch();
    const kernel = createTacticsKernel({ initial });
    initial.entities[0]!.hp = 0;
    initial.entities[0]!.poison!.damagePerTurn = 99;
    initial.grid.tiles[0]!.blockLOS = false;
    initial.extracted!.push({ rosterIndex: 5, hp: 9 });
    const snapshot = kernel.getSnapshot();
    expect(snapshot.entities[0]!.hp).toBe(8);
    expect(snapshot.entities[0]!.poison!.damagePerTurn).toBe(2);
    expect(snapshot.grid.tiles[0]!.blockLOS).toBe(true);
    expect(snapshot.extracted).toEqual([{ rosterIndex: 0, hp: 4 }]);
  });

  it("повторная загрузка состояния делает глубокую копию загружаемого снимка", () => {
    const first = createTacticsKernel({ initial: fullMatch() });
    const loaded = first.getSnapshot();
    const before = structuredClone(loaded);
    // Второй экземпляр ядра принимает снимок как initial — это путь
    // loadMatch: cloneState обязан скопировать и его.
    const second: TacticsKernel = createTacticsKernel({ initial: loaded });
    loaded.entities[0]!.hp = 0;
    loaded.entities[0]!.skillUses!.fireball = 99;
    loaded.grid.tiles[0]!.pit = false;
    const secondSnapshot = second.getSnapshot();
    expect(secondSnapshot.entities[0]!.hp).toBe(before.entities[0]!.hp);
    expect(secondSnapshot.entities[0]!.skillUses!.fireball).toBe(before.entities[0]!.skillUses!.fireball);
    expect(secondSnapshot.grid.tiles[0]!.pit).toBe(before.grid.tiles[0]!.pit);
  });
});
