/**
 * Туман войны: кэшируемые слои базы и дрейфа (0.20.20, этап 1.2).
 * Перенесено из field-renderer.ts без изменений.
 */

import { Graphics } from "pixi.js";
import { CELL_SIZE, FOG_DRIFT_INTERVAL_MS } from "./constants.js";
import { visualLevel, faceOf, centerOf } from "./geometry.js";
import type { FieldView, Fx } from "./types.js";

/** Подпись набора видимых/разведанных клеток: меняется только при их изменении. */
export function computeFogSignature(v: FieldView): string {
  if (!v.visibleCells) return "off";
  let h = 0x811c9dc5;
  for (const key of v.visibleCells) {
    for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    h = (h + v.visibleCells.size) >>> 0;
  }
  for (const key of v.exploredCells ?? []) {
    for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ (key.charCodeAt(i) * 3), 16777619) >>> 0;
  }
  return `${h}`;
}

/**
 * База тумана второго поколения (0.20.25, этап 3.5): неразведанная область —
 * плотная мгла; у её границы с разведанной territory — полупрозрачная полоса
 * перехода; разведанные невидимые клетки затемнены умеренно.
 */
export function paintFogBase(fogBaseLayer: Graphics, view: FieldView | null): void {
  const g = fogBaseLayer;
  const v = view;
  if (!v || !v.visibleCells) {
    g.clear();
    return;
  }
  g.clear();
  const C = CELL_SIZE;
  const tiles = v.snapshot.grid.tiles;
  const isKnown = (x: number, y: number): boolean => {
    const key = `${x},${y}`;
    return v.visibleCells!.has(key) || (v.exploredCells?.has(key) ?? false);
  };
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    if (v.visibleCells.has(key)) continue;
    const z = visualLevel(tile);
    const { fx, fy } = faceOf(tile.x, tile.y, z);
    const explored = v.exploredCells?.has(key) ?? false;
    if (!explored) {
      const nearKnown =
        isKnown(tile.x - 1, tile.y) ||
        isKnown(tile.x + 1, tile.y) ||
        isKnown(tile.x, tile.y - 1) ||
        isKnown(tile.x, tile.y + 1);
      g.rect(fx, fy, C, C).fill({ color: 0x080a0c, alpha: nearKnown ? 0.55 : 0.96 });
    } else {
      g.rect(fx, fy, C, C).fill({ color: 0x0c1218, alpha: 0.6 });
    }
  }
}

/**
 * Текстура мглы: перекрывающиеся мягкие полупрозрачные эллипсы вместо
 * резких «клякс» (этап 3.5); при reduced motion — статичная фаза.
 */
export function paintFogDrift(
  fogDriftLayer: Graphics,
  view: FieldView | null,
  now: number,
  reducedMotion: boolean,
): void {
  const g = fogDriftLayer;
  const v = view;
  if (!v || !v.visibleCells) {
    g.clear();
    return;
  }
  g.clear();
  const C = CELL_SIZE;
  const slowT = reducedMotion ? 0 : now * 0.0003;
  for (const tile of v.snapshot.grid.tiles) {
    const key = `${tile.x},${tile.y}`;
    if (v.visibleCells.has(key)) continue;
    if (!(v.exploredCells?.has(key) ?? false)) continue;
    const z = visualLevel(tile);
    const { fx, fy } = faceOf(tile.x, tile.y, z);
    const fogSeed = tile.x * 7919 + tile.y * 6271;
    for (let i = 0; i < 3; i += 1) {
      const h1 = ((fogSeed * (i + 1) * 2654435761) >>> 0) / 4294967296;
      const h2 = (((fogSeed + 31) * (i + 7) * 2246822519) >>> 0) / 4294967296;
      const phase = slowT + h1 * 6.28;
      const drift = Math.sin(phase) * 4;
      const driftY = Math.cos(phase * 0.7 + i) * 3;
      const cx = fx + h1 * C + drift;
      const cy = fy + h2 * C + driftY;
      const fr = 16 + h1 * 18;
      const alpha = reducedMotion ? 0.05 : 0.05 + 0.028 * Math.sin(phase * 1.3 + i * 2.1);
      g.ellipse(cx, cy, fr, fr * 0.72).fill({ color: 0x8a9aaa, alpha });
    }
  }
}

export interface FogState {
  fogSignature: string;
  lastFogDriftAt: number;
  prevVisibleKeys: Set<string> | null;
}

/** Вызывается из кадра: база — по подписи, дрейф — по троттлингу ~15 Гц. */
export function paintFog(
  fogBaseLayer: Graphics,
  fogDriftLayer: Graphics,
  fxs: Fx[],
  view: FieldView | null,
  state: FogState,
  now: number,
  reducedMotion: boolean,
  destroyed: boolean,
  mounted: boolean,
): void {
  if (!view || destroyed || !mounted) return;
  const sig = computeFogSignature(view);
  if (sig !== state.fogSignature) {
    // Рассеивание (этап 3.5): над клетками, ставшими видимыми, мгла
    // сжимается к центру и исчезает — момент исследования ощущается.
    if (state.prevVisibleKeys && view.visibleCells) {
      let revealed = 0;
      for (const tile of view.snapshot.grid.tiles) {
        const key = `${tile.x},${tile.y}`;
        if (!view.visibleCells.has(key) || state.prevVisibleKeys.has(key)) continue;
        const z = visualLevel(tile);
        const { cx, cy } = centerOf(tile.x, tile.y, z);
        fxs.push({ kind: "fogReveal", x: cx, y: cy, start: now });
        revealed += 1;
        if (revealed >= 48) break;
      }
    }
    state.prevVisibleKeys = view.visibleCells ? new Set(view.visibleCells) : null;
    state.fogSignature = sig;
    paintFogBase(fogBaseLayer, view);
    paintFogDrift(fogDriftLayer, view, reducedMotion ? 0 : now, reducedMotion);
    state.lastFogDriftAt = now;
    return;
  }
  if (!reducedMotion && now - state.lastFogDriftAt >= FOG_DRIFT_INTERVAL_MS) {
    state.lastFogDriftAt = now;
    paintFogDrift(fogDriftLayer, view, now, reducedMotion);
  }
}
