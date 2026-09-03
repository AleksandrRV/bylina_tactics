/**
 * Чистые математические вспомогательные функции рендерера.
 * Перенесены из field-renderer.ts без изменений.
 */

export function shade(color: number, amount: number): number {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (color & 0xff) + amount));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)
  );
}

/** Детерминированный хеш клетки → [0, 1). Декор стабилен между кадрами. */
export function hashCell(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Локальный шум для визуальных эффектов (тряска камеры). Начальное значение
 * зависит от времени запуска, поэтому эффект не повторяется кадр в кадр,
 * но не использует стандартный генератор среды (§1 math: источник случайности
 * тактического слоя — только Mulberry32; средство отображения состояния не меняет).
 */
let shakeSeed = Date.now() >>> 0 || 0x9e3779b9;

export function shakeNoise(): number {
  shakeSeed = (Math.imul(shakeSeed, 1664525) + 1013904223) >>> 0;
  return shakeSeed / 4294967296;
}
