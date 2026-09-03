/**
 * Атмосфера экрана: Тьма, виньетка, зерно (0.20.25, этапы 3.6/3.7).
 * Перенесено из field-renderer.ts без изменений.
 */

import { Graphics, Container, TilingSprite, Texture } from "pixi.js";
import type { FieldView } from "./types.js";
import { CINEMATIC_ACCENT } from "./constants.js";

/** Детерминированная процедурная текстура зерна (без новых файлов арта). */
let grainTexture: Texture | null = null;
export function getGrainTexture(): Texture {
  if (grainTexture) return grainTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.WHITE;
  const image = ctx.createImageData(size, size);
  let seed = 0x9e3779b9;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 118 + (seed % 62);
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  grainTexture = Texture.from(canvas);
  return grainTexture;
}

/** Виньетка и зерно статичны — рисуются при монтаже и смене размера холста. */
export function paintVignette(vignetteG: Container, w: number, h: number, reducedMotion: boolean): void {
  vignetteG.removeChildren().forEach((child) => child.destroy());
  if (reducedMotion) return; // на слабых устройствах отключается первым
  if (w <= 0 || h <= 0) return;
  const g = new Graphics();
  // Затемнение углов: полосы от края внутрь, суммарно ~25% у кромки.
  const steps = 10;
  const maxInset = Math.min(w, h) * 0.22;
  for (let i = steps; i >= 1; i -= 1) {
    const inset = ((i - 1) / steps) * maxInset;
    g.rect(inset, inset, w - inset * 2, h - inset * 2).stroke({
      width: maxInset / steps + 1,
      color: 0x000000,
      alpha: 0.028,
    });
  }
  vignetteG.addChild(g);
  // Матовое зерно 3–5% прозрачности, полностью статичное.
  const grain = new TilingSprite({ texture: getGrainTexture(), width: w, height: h });
  grain.alpha = 0.04;
  vignetteG.addChild(grain);
}

/** Холодный слой Тьмы: сила привязана к доле счётчика кампании. */
export function paintDarkness(
  darknessG: Graphics,
  view: FieldView | null,
  w: number,
  h: number,
  mounted: boolean,
  destroyed: boolean,
): void {
  darknessG.clear();
  const ratio = view?.darkness ?? 0;
  if (!mounted || destroyed || ratio <= 0) return;
  darknessG.rect(0, 0, w, h).fill({
    color: 0x0a1826,
    alpha: Math.min(0.4, 0.06 + 0.32 * ratio),
  });
}

/**
 * Акцент кадра сцены (0.20.40): по цели шага с `accent` пульсирует
 * янтарное кольцо со вспышкой.
 */
export function paintCinematicAccent(
  accentLayer: Graphics,
  cinematicAccent: { x: number; y: number } | null,
  now: number,
  reducedMotion: boolean,
  destroyed: boolean,
  mounted: boolean,
  cellSize: number,
): void {
  accentLayer.clear();
  const point = cinematicAccent;
  if (!point || destroyed || !mounted) return;
  const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(now * 0.0055) * 0.5;
  const C = cellSize;
  accentLayer.circle(point.x, point.y, C * 0.44).fill({ color: CINEMATIC_ACCENT, alpha: 0.05 + pulse * 0.07 });
  accentLayer
    .circle(point.x, point.y, C * (0.4 + pulse * 0.09))
    .stroke({ width: 1.6 + pulse * 1.8, color: CINEMATIC_ACCENT, alpha: 0.3 + pulse * 0.5 });
  accentLayer.circle(point.x, point.y, C * 0.3).stroke({ width: 1.2, color: 0xf3ecdc, alpha: 0.16 + pulse * 0.22 });
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 2) * i + Math.PI / 4;
    const inner = C * (0.5 + pulse * 0.05);
    const outer = C * (0.62 + pulse * 0.07);
    accentLayer
      .moveTo(point.x + Math.cos(angle) * inner, point.y + Math.sin(angle) * inner)
      .lineTo(point.x + Math.cos(angle) * outer, point.y + Math.sin(angle) * outer)
      .stroke({ width: 2, color: CINEMATIC_ACCENT, alpha: 0.25 + pulse * 0.45 });
  }
}

/**
 * Краевая стрелка к цели обучающего указания за пределами экрана (этап 5.4).
 */
export function paintEdgeArrow(
  edgeArrowG: Graphics,
  targetScreen: { x: number; y: number } | null,
  w: number,
  h: number,
  now: number,
  reducedMotion: boolean,
  destroyed: boolean,
  mounted: boolean,
): void {
  edgeArrowG.clear();
  if (!targetScreen || destroyed || !mounted) return;
  if (w <= 0 || h <= 0) return;
  const screen = targetScreen;
  // Цель в пределах экрана — стрелка не нужна.
  if (screen.x >= 0 && screen.x <= w && screen.y >= 0 && screen.y <= h) return;
  const margin = 30;
  const ax = Math.min(w - margin, Math.max(margin, screen.x));
  const ay = Math.min(h - margin, Math.max(margin, screen.y));
  const angle = Math.atan2(screen.y - ay, screen.x - ax);
  const motionNow = reducedMotion ? 12000 : now;
  const pulse = 0.55 + Math.sin(motionNow * 0.008) * 0.35;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pt = (dx: number, dy: number): [number, number] => [ax + dx * cos - dy * sin, ay + dx * sin + dy * cos];
  const tip = pt(13, 0);
  const left = pt(-7, 8);
  const right = pt(-7, -8);
  edgeArrowG.poly([tip[0], tip[1], left[0], left[1], right[0], right[1]]).fill({ color: 0xe0b34a, alpha: pulse });
  edgeArrowG
    .poly([tip[0], tip[1], left[0], left[1], right[0], right[1]])
    .stroke({ width: 1.5, color: 0xf3ecdc, alpha: 0.7 * pulse + 0.2 });
}
