import { describe, expect, it } from "vitest";
import { buildEnemyStrip, rememberEnemies, type RememberedEnemy } from "../src/enemy-strip.js";

/**
 * Полоса противников (0.20.43): снимок стороны отдаёт только видимых
 * (math §8.3), но игрок не должен терять счёт врагам, которые вышли из поля
 * зрения. Видимый ведёт камеру кликом, невидимый — приглушён и не кликается.
 */

function enemy(id: number, configId: string, dead = false): never {
  return { id, configId, dead } as never;
}

describe("enemy strip (0.20.43)", () => {
  it("marks the enemies the host sees right now", () => {
    const known = [enemy(1, "forest_rat"), enemy(2, "forest_rat")];
    const remembered = rememberEnemies(known, new Map<number, RememberedEnemy>());
    const strip = buildEnemyStrip(remembered, known);
    expect(strip.map((entry) => entry.seen)).toEqual([true, true]);
    expect(strip.every((entry) => entry.dead === false)).toBe(true);
  });

  it("keeps a lost enemy in the strip, dimmed and unclickable", () => {
    // Крыса вышла из поля зрения дружины: из снимка она пропала, но игрок
    // помнит, что она на поле, — портрет остаётся приглушённым.
    const remembered = rememberEnemies([enemy(7, "forest_rat")], new Map<number, RememberedEnemy>());
    const strip = buildEnemyStrip(remembered, []);
    expect(strip).toHaveLength(1);
    expect(strip[0]?.seen, "not visible — the camera has nowhere to go").toBe(false);
    expect(strip[0]?.configId).toBe("forest_rat");
  });

  it("brings a lost enemy back to life in the strip when it is seen again", () => {
    const remembered = rememberEnemies([enemy(7, "forest_rat")], new Map<number, RememberedEnemy>());
    expect(buildEnemyStrip(remembered, [])[0]?.seen).toBe(false);
    expect(buildEnemyStrip(remembered, [enemy(7, "forest_rat")])[0]?.seen).toBe(true);
    // Повторное появление не плодит записи.
    expect(buildEnemyStrip(remembered, [enemy(7, "forest_rat")])).toHaveLength(1);
  });

  it("keeps the dead enemy dead even after its cell stops being observed", () => {
    const remembered = rememberEnemies([enemy(7, "forest_rat", true)], new Map<number, RememberedEnemy>());
    // Клетка погибшего больше не наблюдается — он пропал из снимка, но
    // зачёркнутым портретом остаётся в полосе.
    expect(buildEnemyStrip(remembered, [])[0]?.dead).toBe(true);
  });

  it("counts several kinds of enemies separately", () => {
    const known = [enemy(1, "forest_rat"), enemy(2, "upyr")];
    const remembered = rememberEnemies(known, new Map<number, RememberedEnemy>());
    const strip = buildEnemyStrip(remembered, [enemy(2, "upyr")]);
    expect(strip.find((entry) => entry.id === 1)?.seen).toBe(false);
    expect(strip.find((entry) => entry.id === 2)?.seen).toBe(true);
    expect(strip.map((entry) => entry.configId)).toEqual(["forest_rat", "upyr"]);
  });
});
