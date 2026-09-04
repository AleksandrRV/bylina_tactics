import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { compilePrologueLayout, createPrologueMatch, findPath, tileAt, type EntityState } from "@bylina/core";

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

/** Партия миссии пролога по авторской раскладке (юниты — из данных). */
function missionMatch(missionId: string, seed: number) {
  const parsed = parseContent(readDataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.prologue.missions.find((entry) => entry.id === missionId)!;
  const layout = mission.map.layout;
  if (!layout) throw new Error(`нет раскладки у миссии ${missionId}`);
  const units = [...parsed.data.units, ...parsed.data.prologueBestiary.units];
  return { mission, match: createPrologueMatch({ layout, units, seed }) };
}

/**
 * Раскладка М2 «Крик в чаще» (0.20.43). Проверяется не картинка, а
 * проходимость: болото с перепадами ярусов обязано оставлять дорогу к
 * Федоту и от него — к колонке эвакуации, а северная кромка — место для
 * восьми крыс из сервиса подкреплений.
 */
describe("prologue M2 map (0.20.43)", () => {
  const { mission, match } = missionMatch("prologue_cry", 702);
  const grid = match.grid;
  const mikula = match.entities.find((entity) => entity.configId === "mikula_peasant")!;
  const fedot = match.entities.find((entity) => entity.configId === "fedot_stranded")!;
  const others = match.entities.filter((entity) => entity.id !== fedot.id && entity.id !== mikula.id);
  const walker: EntityState = { ...mikula, mobility: 4, ap: 2 };

  it("lays the bog out on three tiers with no two-level steps", () => {
    const tiers = new Set(grid.tiles.map((tile) => tile.z));
    expect([...tiers].sort()).toEqual([0, 1, 2]);
    for (const tile of grid.tiles) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const other = tileAt(grid, tile.x + dx, tile.y + dy);
        if (!other) continue;
        // Перепад в два яруса между соседями — стена: движения через неё нет.
        expect(Math.abs(other.z - tile.z), `скачок у (${tile.x},${tile.y})`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the rescue inside one dash and the way out open", () => {
    const adjacent = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const;
    let cheapest = Number.POSITIVE_INFINITY;
    for (const [dx, dy] of adjacent) {
      const path = findPath(grid, others, walker, fedot.x + dx, fedot.y + dy);
      if (path) cheapest = Math.min(cheapest, path.mpCost);
    }
    expect(Number.isFinite(cheapest), "Федот недостижим").toBe(true);
    // Рывок даёт 8 очков: герой доходит до трясины за одно действие.
    expect(cheapest).toBeLessThanOrEqual(8);

    const extracts = grid.tiles.filter((tile) => tile.extract);
    expect(extracts.length).toBeGreaterThan(0);
    const freed: EntityState = { ...fedot, mobility: 4, ap: 2 };
    for (const cell of extracts) {
      const path = findPath(grid, others, freed, cell.x, cell.y);
      expect(path, `нет пути от Федота к эвакуации (${cell.x},${cell.y})`).toBeTruthy();
    }
  });

  it("leaves the northern thicket free for the rat wave", () => {
    const north = grid.tiles.filter((tile) => tile.y === 0);
    const free = north.filter(
      (tile) =>
        !tile.pit &&
        !tile.blockLOS &&
        !match.entities.some((entity) => !entity.dead && entity.obstacle && entity.x === tile.x && entity.y === tile.y),
    );
    // Сервис подкреплений М2 держит до восьми крыс и селит их на кромке.
    expect(free.length).toBeGreaterThanOrEqual(8);
    expect(mission.map.biome).toBe("swamp");
    // Канон §7.2: трясина — состояние, а не яма.
    expect(grid.tiles.some((tile) => tile.pit)).toBe(false);
  });
});

/**
 * Маркеры раскладки М2 (0.20.45). Сценарий миссии читает их, а не цифры
 * в коде: `F` — точка засады первой пары крыс, `S` — шесть клеток стаи,
 * `E` — клетки эвакуации, которые загораются после стаи. До 0.20.45 стая
 * брала «все `F`, кроме первого» — маркер был один, и шесть крыс не
 * выходили вовсе.
 */
describe("prologue M2 markers (0.20.45)", () => {
  const parsed = parseContent(readDataTree());
  if (!parsed.ok) throw new Error("content parse failed");
  const mission = parsed.data.prologue.missions.find((entry) => entry.id === "prologue_cry")!;
  const layout = mission.map.layout;
  if (!layout) throw new Error("нет раскладки у миссии prologue_cry");
  const compiled = compilePrologueLayout(layout);
  const { match } = missionMatch("prologue_cry", 702);

  it("marks the ambush pair and six swarm cells in the thicket", () => {
    expect(compiled.markers.F).toEqual([{ x: 9, y: 4 }]);
    const swarm = compiled.markers.S ?? [];
    expect(swarm).toHaveLength(6);
    // Стая выбегает из чащи на северной кромке — за спиной отряда, который
    // идёт на запад: крысы догоняют, а не отрезают путь к выходу.
    for (const cell of swarm) {
      expect(cell.y, `стая в чаще, а не в поле: ${cell.x},${cell.y}`).toBeLessThanOrEqual(1);
      const tile = tileAt(match.grid, cell.x, cell.y);
      expect(tile, `клетка стаи вне поля: ${cell.x},${cell.y}`).toBeTruthy();
      expect(tile?.pit).toBe(false);
      expect(tile?.blockLOS).toBe(false);
      expect(
        match.entities.some((entity) => !entity.dead && entity.obstacle && entity.x === cell.x && entity.y === cell.y),
        `клетка стаи занята: ${cell.x},${cell.y}`,
      ).toBe(false);
    }
  });

  it("keeps the exit column a column of six lit cells", () => {
    // Зона открывается ровно этими клетками, а не всей западной колонкой:
    // в колонке двенадцать клеток, и половина из них — не выход.
    expect(compiled.extractCells.map((cell) => `${cell.x},${cell.y}`).sort()).toEqual([
      "0,0",
      "0,1",
      "0,2",
      "0,6",
      "0,7",
      "0,8",
    ]);
  });
});

/**
 * Раскладка М5 «Дорога к могильнику». Тракт учит укрытию: полка с просветами
 * режет рывок, слизни стоят на гряде вне стартового зрения, одна яма на краю.
 */
describe("prologue M5 map", () => {
  const { mission, match } = missionMatch("prologue_road", 705);
  const grid = match.grid;
  const bogatyr = match.entities.find((entity) => entity.configId === "bogatyr")!;
  const slugs = match.entities.filter((entity) => entity.configId === "slug" && !entity.dead);
  const others = match.entities.filter((entity) => entity.id !== bogatyr.id);
  const walker: EntityState = { ...bogatyr, mobility: 4, ap: 2 };

  it("lays the tract on three tiers with a single pit and four slugs", () => {
    expect(mission.map.biome).toBe("meadow");
    expect(mission.fog).toBe(true);
    expect(mission.nextMissionId ?? null).toBeNull();
    const tiers = new Set(grid.tiles.map((tile) => tile.z));
    expect([...tiers].sort()).toEqual([0, 1, 2]);
    for (const tile of grid.tiles) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const other = tileAt(grid, tile.x + dx, tile.y + dy);
        if (!other) continue;
        expect(Math.abs(other.z - tile.z), `скачок у (${tile.x},${tile.y})`).toBeLessThanOrEqual(1);
      }
    }
    expect(slugs).toHaveLength(4);
    expect(slugs.every((slug) => slug.y === 0 && slug.z === 2)).toBe(true);
    expect(grid.tiles.filter((tile) => tile.pit)).toHaveLength(1);
    expect(bogatyr.z).toBe(0);
  });

  it("keeps a walkable gap in the shelf and a path to the ridge", () => {
    const gap = tileAt(grid, 2, 7);
    expect(gap?.blockLOS).toBe(false);
    expect(gap?.pit).toBe(false);
    const ridge = slugs[0]!;
    const approach = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const;
    let cheapest = Number.POSITIVE_INFINITY;
    for (const [dx, dy] of approach) {
      const path = findPath(grid, others, walker, ridge.x + dx, ridge.y + dy);
      if (path) cheapest = Math.min(cheapest, path.mpCost);
    }
    expect(Number.isFinite(cheapest), "гряда недостижима").toBe(true);
    // Первый рывок (8 ОД) не дотягивает до гряды: полка учит подходу.
    expect(cheapest).toBeGreaterThan(8);
  });
});
