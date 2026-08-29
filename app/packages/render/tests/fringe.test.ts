import { describe, expect, it } from "vitest";
import { FRINGE_CELLS, fringeDecor, fringeDepth } from "../src/fringe.js";

/**
 * Опушка за кромкой карты (0.20.41): кадр сцены центрирует цель по центру
 * окна, поэтому за полем видно пространство — оно должно читаться лесом,
 * а не ровной заливкой. Раскладка считается чистой функцией, поэтому
 * проверяется без Пикси.
 */

const COLS = 20;
const ROWS = 6;

const inside = (cols: number, rows: number, x: number, y: number): boolean =>
  x >= 0 && x <= cols - 1 && y >= 0 && y <= rows - 1;

describe("fringe (0.20.41)", () => {
  it("places the forest outside the field only", () => {
    const items = fringeDecor(COLS, ROWS);
    expect(items.length, "опушка не пустая").toBeGreaterThan(100);
    for (const item of items) {
      expect(inside(COLS, ROWS, item.cellX, item.cellY), `клетка ${item.cellX},${item.cellY} внутри поля`).toBe(false);
    }
  });

  it("is reproducible: the same map gives the same forest", () => {
    // Иначе опушка перескакивала бы при каждом перерисовывании статики.
    expect(fringeDecor(COLS, ROWS)).toEqual(fringeDecor(COLS, ROWS));
    expect(fringeDecor(COLS, ROWS)).not.toEqual(fringeDecor(COLS + 1, ROWS));
  });

  it("stays within the fringe radius", () => {
    for (const item of fringeDecor(COLS, ROWS, 4)) {
      expect(Math.max(-item.cellX, item.cellX - (COLS - 1), -item.cellY, item.cellY - (ROWS - 1))).toBeLessThanOrEqual(4);
    }
  });

  it("thins out and darkens with depth", () => {
    const items = fringeDecor(COLS, ROWS);
    const near = items.filter((item) => fringeDepth(item.cellX, item.cellY, COLS, ROWS, FRINGE_CELLS) <= 0.25);
    const far = items.filter((item) => fringeDepth(item.cellX, item.cellY, COLS, ROWS, FRINGE_CELLS) > 0.75);
    const mean = (list: typeof items): number => list.reduce((sum, item) => sum + item.alpha, 0) / list.length;
    // У кромки лес сомкнут и светел, в глубине — редеет и глохнет.
    expect(mean(near)).toBeGreaterThan(mean(far));
    // Плотность на клетку: у кромки выше, чем на внешней границе.
    const nearCells = (COLS + 6) * (ROWS + 6) - COLS * ROWS;
    const farCells = (COLS + 2 * FRINGE_CELLS) * (ROWS + 2 * FRINGE_CELLS) - (COLS + 18) * (ROWS + 18);
    expect(near.length / nearCells).toBeGreaterThan(far.length / farCells);
  });

  it("keeps every detail inside the canvas of one cell", () => {
    // Свесы за клетку допустимы (перекрыты рельефом), но не более полуклетки.
    for (const item of fringeDecor(COLS, ROWS)) {
      expect(Math.abs(item.dx)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(item.dy)).toBeLessThanOrEqual(0.25);
      expect(item.size).toBeGreaterThan(0);
      expect(item.size).toBeLessThan(0.6);
    }
  });

  it("grows nothing for an empty field", () => {
    expect(fringeDecor(0, 0)).toEqual([]);
    expect(fringeDecor(COLS, ROWS, 0)).toEqual([]);
    // Глубина внутри поля нулевая: это и есть условие «не рисовать на поле».
    expect(fringeDepth(3, 2, COLS, ROWS, FRINGE_CELLS)).toBe(0);
    expect(fringeDepth(-1, 2, COLS, ROWS, FRINGE_CELLS)).toBeCloseTo(1 / FRINGE_CELLS);
  });
});
