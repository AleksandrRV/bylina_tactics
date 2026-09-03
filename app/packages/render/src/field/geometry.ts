/**
 * Геометрия изометрического поля: конвертации координат, вспомогательные расчёты.
 * Перенесено из field-renderer.ts без изменений.
 */

import type { Tile } from "@bylina/core";
import { CELL_SIZE, RISE, PAD } from "./constants.js";

export function visualLevel(tile: Tile): number {
  return tile.pit ? 0 : tile.z;
}

export function neighborLevel(tiles: readonly Tile[], x: number, y: number): number | null {
  const found = tiles.find((tile) => tile.x === x && tile.y === y);
  if (!found) return null;
  return visualLevel(found);
}

/** Координата верхнего левого угла клетки в мировых пикселях. */
export function faceOf(x: number, y: number, z: number): { fx: number; fy: number } {
  return {
    fx: PAD + x * CELL_SIZE,
    fy: PAD + RISE * 2 + y * CELL_SIZE - z * RISE,
  };
}

/** Координата центра клетки в мировых пикселях. */
export function centerOf(x: number, y: number, z: number): { cx: number; cy: number } {
  const { fx, fy } = faceOf(x, y, z);
  return { cx: fx + CELL_SIZE / 2, cy: fy + CELL_SIZE / 2 };
}

/**
 * Привязка указателя к клетке поля: учитывает поднятую грань и откос под ней.
 * Ряды обходятся снизу вверх — в зоне наложения видна грань южной клетки.
 */
export function cellFromLocalCoords(
  lx: number,
  ly: number,
  tiles: readonly Tile[],
  width: number,
  height: number,
): { x: number; y: number } | null {
  const gx = Math.floor((lx - PAD) / CELL_SIZE);
  if (gx < 0 || gx >= width) return null;
  for (let y = height - 1; y >= 0; y -= 1) {
    const tile = tiles.find((item) => item.x === gx && item.y === y);
    if (!tile) continue;
    const z = visualLevel(tile);
    const { fy } = faceOf(gx, y, z);
    const below = neighborLevel(tiles, gx, y + 1);
    const drop = below === null ? z : Math.max(0, z - below);
    const bottomBelow = fy + CELL_SIZE + drop * RISE;
    if (ly >= fy && ly < bottomBelow) return { x: gx, y };
  }
  return null;
}

/** Вершины правильного шестиугольника (плоская вершина сверху вниз). */
export function hexPoints(cx: number, cy: number, r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  return pts;
}
