/**
 * Графические эффекты: windup, flash, bolt, poof, extract, skill, status,
 * shards, pitfall, fogReveal.
 * Перенесено из field-renderer.ts без изменений.
 */

import { Graphics } from "pixi.js";
import { CELL_SIZE } from "./constants.js";
import { easeOut, easeInOut, hashCell } from "./math.js";
import type { Fx } from "./types.js";

/** Множитель аддитивного слоя (этап 2.2): физичные щепки и пыль — обычная отрисовка. */
export const ADDITIVE_FX: ReadonlySet<Fx["kind"]> = new Set(["windup", "flash", "bolt", "status", "extract", "skill"]);

/**
 * Нарисовать все активные эффекты в слоях.
 * Удаляет завершившиеся эффекты из массива (в-месте).
 */
export function drawFxList(gStatic: Graphics, glowG: Graphics, fxs: Fx[], now: number): void {
  for (let i = fxs.length - 1; i >= 0; i -= 1) {
    const fx = fxs[i];
    if (!fx) continue;
    // Этап 2.2: «волшебные» эффекты складываются с изображением и светятся,
    // физичные (пыль, осколки, щепки) остаются обычной отрисовкой.
    const g = ADDITIVE_FX.has(fx.kind) ? glowG : gStatic;
    if (fx.kind === "windup") {
      const t = (now - fx.start) / 260;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      const color = fx.warm ? 0xf6f2e4 : 0xc8e89a;
      g.circle(fx.x, fx.y, 19 + t * 7).stroke({ width: 2, color, alpha: 0.75 * (1 - t) });
      g.circle(fx.x, fx.y, 24 + t * 9).stroke({ width: 1, color, alpha: 0.4 * (1 - t) });
    } else if (fx.kind === "bolt") {
      const t = (now - fx.start) / fx.dur;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      const e = easeInOut(t);
      const bx = fx.x0 + (fx.x1 - fx.x0) * e;
      const by = fx.y0 + (fx.y1 - fx.y0) * e - Math.sin(Math.PI * t) * 13;
      const color = fx.warm ? 0xffd268 : 0xa8e063;
      const tailT = Math.max(0, e - 0.18);
      const tailX = fx.x0 + (fx.x1 - fx.x0) * tailT;
      const tailY = fx.y0 + (fx.y1 - fx.y0) * tailT - Math.sin(Math.PI * tailT) * 13;
      const nx = -(by - tailY);
      const ny = bx - tailX;
      const nlen = Math.max(1, Math.hypot(nx, ny));
      const width = 5.2 * (1 - t * 0.55);
      g.poly([
        bx,
        by,
        tailX + (nx / nlen) * width,
        tailY + (ny / nlen) * width,
        tailX - (nx / nlen) * width,
        tailY - (ny / nlen) * width,
      ]).fill({ color, alpha: 0.28 * (1 - t * 0.4) });
      for (let trail = 1; trail <= 3; trail += 1) {
        const tt = Math.max(0, e - trail * 0.03);
        const tx = fx.x0 + (fx.x1 - fx.x0) * tt;
        const ty = fx.y0 + (fx.y1 - fx.y0) * tt - Math.sin(Math.PI * tt) * 13;
        g.circle(tx, ty, 3.6 - trail).fill({ color, alpha: 0.5 - trail * 0.14 });
      }
      g.circle(bx, by, 4.4).fill({ color, alpha: 0.85 });
      g.circle(bx, by, 1.9).fill(0xfffbe8);
    } else if (fx.kind === "flash") {
      const t = (now - fx.start) / 340;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      if (fx.miss) {
        g.circle(fx.x, fx.y, 8 + t * 16).stroke({ width: 2, color: 0xb9b4a4, alpha: 0.65 * (1 - t) });
        continue;
      }
      const color = fx.crit ? 0xffd268 : 0xf3ecdc;
      g.circle(fx.x, fx.y, 5 + t * (fx.crit ? 26 : 18)).stroke({ width: 2.6, color, alpha: 0.85 * (1 - t) });
      if (fx.crit) {
        g.circle(fx.x, fx.y, 3 + t * 14).stroke({ width: 1.4, color: 0xff9e4a, alpha: 0.8 * (1 - t) });
      }
      const sparks = fx.crit ? 7 : 5;
      for (let s = 0; s < sparks; s += 1) {
        const a = fx.angle + Math.PI + ((s / sparks) * 2 - 1) * 1.5;
        const r0 = 6 + t * 10;
        const r1 = r0 + 7 * (1 - t * 0.4);
        g.moveTo(fx.x + Math.cos(a) * r0, fx.y + Math.sin(a) * r0)
          .lineTo(fx.x + Math.cos(a) * r1, fx.y + Math.sin(a) * r1)
          .stroke({ width: 1.6, color, alpha: (1 - t) * 0.9 });
      }
    } else if (fx.kind === "skill") {
      const t = (now - fx.start) / fx.dur;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      const palette: Record<string, [number, number]> = {
        heal: [0x74e071, 0xd8ffd0],
        cleanse: [0x55ddea, 0xe5ffff],
        summon_forest_beast: [0x73b64b, 0xd8ef8a],
        aimed_eye: [0xe8b64c, 0xfff0a0],
        roots: [0x769845, 0x49351f],
        poison_needles: [0x83d632, 0xd6ff62],
        raise_skeleton: [0x66b849, 0xd9d5b5],
        panic: [0xa648e8, 0xff5e7a],
        create_illusion: [0x55d5e8, 0xc4f8ff],
        teleport_ally: [0x5398ff, 0x9ee9ff],
        circular_sweep: [0xe8b64c, 0xffe8a0],
        breach: [0xd47b39, 0xf1d19a],
        shield_bash: [0x78aee8, 0xe8f5ff],
      };
      let [primary, secondary] = palette[fx.style] ?? [0x9ad27a, 0xf3ecdc];
      if (!fx.success) [primary, secondary] = [0x6f7470, 0xb0b4ae];
      const px = fx.x0 + (fx.x1 - fx.x0) * easeOut(Math.min(1, t * 1.35));
      const py = fx.y0 + (fx.y1 - fx.y0) * easeOut(Math.min(1, t * 1.35));
      g.circle(px, py, 4 + Math.sin(t * Math.PI) * 8).stroke({ width: 2, color: primary, alpha: 1 - t * 0.5 });
      const count = fx.style === "poison_needles" ? 7 : fx.style === "heal" || fx.style === "cleanse" ? 6 : 10;
      for (let p = 0; p < count; p += 1) {
        const angle = (p / count) * Math.PI * 2 + t * (fx.style === "panic" ? 7 : 3);
        const radius = 5 + t * (fx.style === "roots" ? 25 : 18);
        const sx = px + Math.cos(angle) * radius;
        const sy = py + Math.sin(angle) * radius * 0.65;
        if (fx.style === "heal" || fx.style === "cleanse") {
          g.rect(sx - 1, sy - 4, 2, 8).fill({ color: secondary, alpha: 1 - t });
          g.rect(sx - 4, sy - 1, 8, 2).fill({ color: secondary, alpha: 1 - t });
        } else if (fx.style === "roots") {
          g.moveTo(fx.x1, fx.y1 + 8)
            .quadraticCurveTo(sx, sy, fx.x1 + Math.cos(angle) * 24, fx.y1 + 14)
            .stroke({ width: 2, color: p % 2 ? primary : secondary, alpha: 1 - t * 0.7 });
        } else {
          g.circle(sx, sy, 1.5 + (p % 3) * 0.6).fill({ color: p % 2 ? primary : secondary, alpha: 1 - t });
        }
      }
      if (fx.style === "aimed_eye") {
        g.circle(fx.x1, fx.y1, 14 + t * 5).stroke({ width: 1.5, color: secondary, alpha: 1 - t });
        g.moveTo(fx.x1 - 21, fx.y1)
          .lineTo(fx.x1 + 21, fx.y1)
          .stroke({ width: 1, color: primary, alpha: 1 - t });
        g.moveTo(fx.x1, fx.y1 - 21)
          .lineTo(fx.x1, fx.y1 + 21)
          .stroke({ width: 1, color: primary, alpha: 1 - t });
      }
      if (fx.style === "whistle") {
        const ringRadius = 4 + t * 26;
        g.circle(px, py, ringRadius).stroke({ width: 2.4, color: 0xffe0b0, alpha: (1 - t) * 0.9 });
        g.circle(px, py, ringRadius * 0.66).stroke({ width: 1.2, color: 0xfff4dd, alpha: (1 - t) * 0.7 });
        g.circle(px, py, ringRadius * 0.4).stroke({ width: 0.8, color: 0xfff4dd, alpha: (1 - t) * 0.5 });
        for (let p = 0; p < 4; p += 1) {
          const noteAngle = (p / 4) * Math.PI * 2 + t * 5;
          const noteR = 6 + t * 20;
          g.circle(px + Math.cos(noteAngle) * noteR, py + Math.sin(noteAngle) * noteR * 0.7, 1.6).fill({
            color: 0xffe0b0,
            alpha: 1 - t,
          });
        }
      }
    } else if (fx.kind === "status") {
      const t = (now - fx.start) / 520;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      const colors: Record<string, number> = {
        POISON: 0x78d83d,
        PANIC: 0xb94cff,
        IMMOBILE: 0x709343,
        HIDDEN: 0x78c9b2,
        FLYING: 0x9edfff,
        TIMED: 0x5fd6e8,
        DEFENDING: 0x68aee8,
        OVERWATCH: 0xe8b64c,
      };
      const color = colors[fx.status] ?? 0xf3ecdc;
      const radius = 12 + t * 20;
      g.circle(fx.x, fx.y, radius).stroke({ width: fx.applied ? 2.5 : 1.5, color, alpha: 1 - t });
      for (let p = 0; p < 8; p += 1) {
        const angle = (p / 8) * Math.PI * 2;
        const direction = fx.applied ? 1 : -1;
        g.circle(fx.x + Math.cos(angle) * radius, fx.y + Math.sin(angle) * radius, 2).fill({
          color,
          alpha: (1 - t) * 0.8 * direction * direction,
        });
      }
    } else if (fx.kind === "poof") {
      const t = (now - fx.start) / 430;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      g.circle(fx.x, fx.y - t * 12, 6 + t * 13).fill({ color: 0x2c2c28, alpha: 0.4 * (1 - t) });
      g.circle(fx.x - 4, fx.y - t * 8, 4 + t * 8).fill({ color: 0x3a3a34, alpha: 0.35 * (1 - t) });
    } else if (fx.kind === "extract") {
      const t = (now - fx.start) / 700;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      const rise = t * 26;
      g.ellipse(fx.x, fx.y - rise, 5 + t * 7, 2.4 + t * 3).fill({ color: 0xe8c96a, alpha: 0.5 * (1 - t) });
      for (let p = 0; p < 5; p += 1) {
        const phase = (p / 5 + t * 0.7) % 1;
        const sway = Math.sin(phase * Math.PI * 4 + p * 2.1) * 4;
        g.circle(fx.x + sway, fx.y - 8 - phase * 34, 1.8 * (1 - phase) + 0.6).fill({
          color: 0xf2dd9a,
          alpha: 0.9 * (1 - phase),
        });
      }
      g.circle(fx.x, fx.y - rise * 0.4, 9 * (1 - t * 0.6)).stroke({
        width: 1.6,
        color: 0xe8c96a,
        alpha: 0.8 * (1 - t),
      });
    } else if (fx.kind === "shards") {
      const t = (now - fx.start) / 650;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      const pieces = 13;
      for (let s = 0; s < pieces; s += 1) {
        const hA = hashCell(fx.seed, s, 21);
        const hB = hashCell(fx.seed, s, 22);
        const hC = hashCell(fx.seed, s, 23);
        const angle = hA * Math.PI * 2;
        const speed = 26 + hB * 34;
        const px = fx.x + Math.cos(angle) * speed * t;
        const py = fx.y + Math.sin(angle) * speed * t * 0.6 - (16 + hC * 14) * t + 44 * t * t;
        const size = 2.2 + hC * 2.6;
        const alpha = Math.max(0, 1 - t);
        const color = fx.palette === "wood" ? (hB > 0.5 ? 0xa08050 : 0x6b4f2a) : hB > 0.5 ? 0x2c2c28 : 0x3f3f38;
        if (hB > 0.33) {
          g.roundRect(px - size / 2, py - size / 2, size, size, size * 0.3).fill({ color, alpha });
        } else {
          g.poly([px - size, py + size * 0.7, px, py - size, px + size, py + size * 0.7]).fill({ color, alpha });
        }
      }
    } else if (fx.kind === "pitfall") {
      const t = (now - fx.start) / 700;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      g.circle(fx.x, fx.y, 20 * (1 - t) + 4).fill({ color: 0x05070a, alpha: 0.85 * (1 - t * 0.35) });
      g.circle(fx.x, fx.y, 24 * (1 - t) + 4).stroke({ width: 2, color: 0x000000, alpha: 0.6 * (1 - t) });
    } else if (fx.kind === "fogReveal") {
      const t = (now - fx.start) / 480;
      if (t >= 1) {
        fxs.splice(i, 1);
        continue;
      }
      const radius = Math.max(0.5, (CELL_SIZE / 2) * (1 - easeOut(t)));
      g.circle(fx.x, fx.y, radius).fill({ color: 0x080a0c, alpha: 0.9 * (1 - t) });
    }
  }
}
