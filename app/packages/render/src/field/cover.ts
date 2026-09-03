/**
 * Рисование укрытий и щитовых иконок.
 * Перенесено из field-renderer.ts без изменений.
 */

import { Graphics } from "pixi.js";
import { CELL_SIZE } from "./constants.js";
import { shade } from "./math.js";
import { hashCell } from "./math.js";

const C = CELL_SIZE;
const HALF = C / 2;

/** Трещины и сколотый угол полуукрытия (этап 2.9): рисунок детерминирован координатами клетки. */
export function drawCoverDamage(g: Graphics, cx: number, cy: number, w: number, h: number): void {
  const seedX = Math.round(cx);
  const seedY = Math.round(cy);
  // Две ломаные трещины поперёк древесины.
  for (let crackIndex = 0; crackIndex < 2; crackIndex += 1) {
    const x0 = cx - w / 2 + hashCell(seedX, seedY, 31 + crackIndex) * w;
    let px = x0;
    let py = cy - h / 2;
    g.moveTo(px, py);
    for (let step = 1; step <= 3; step += 1) {
      px = x0 + (hashCell(seedX, seedY, 40 + crackIndex * 7 + step) - 0.5) * w * 0.35;
      py = cy - h / 2 + (h * step) / 3;
      g.lineTo(px, py);
    }
    g.stroke({ width: 1, color: 0x3a2a18, alpha: 0.85 });
  }
  // Сколотый угол: тёмный клин в верхнем правом углу.
  const notch = 3 + hashCell(seedX, seedY, 51) * 3;
  g.poly([cx + w / 2 - notch, cy - h / 2, cx + w / 2, cy - h / 2, cx + w / 2, cy - h / 2 + notch]).fill({
    color: 0x241a10,
    alpha: 0.9,
  });
}

/**
 * Граневое укрытие: бревна вдоль всей грани клетки.
 * N/S — горизонтальные, E/W — вертикальные.
 */
export function drawEdgeCover(
  g: Graphics,
  cx: number,
  cy: number,
  coverType: 1 | 2,
  edge: 0 | 1 | 2 | 3,
  style: "wood" | "stone" | "bush" = "wood",
): void {
  const isHorizontal = edge === 0 || edge === 2;
  const length = C - 4; // длина вдоль грани
  const thick = coverType === 2 ? 10 : 6; // толщина

  // Позиция: на грани клетки.
  let bx: number, by: number, bw: number, bh: number;
  if (edge === 0) {
    bx = cx - HALF + 2;
    by = cy - HALF - thick / 2;
    bw = length;
    bh = thick;
  } else if (edge === 2) {
    bx = cx - HALF + 2;
    by = cy + HALF - thick / 2;
    bw = length;
    bh = thick;
  } else if (edge === 1) {
    bx = cx + HALF - thick / 2;
    by = cy - HALF + 2;
    bw = thick;
    bh = length;
  } else {
    bx = cx - HALF - thick / 2;
    by = cy - HALF + 2;
    bw = thick;
    bh = length;
  }

  if (style === "stone") {
    // Низкая каменная кладка вдоль грани.
    const stoneColor = coverType === 2 ? 0x6f6a5e : 0x8a857a;
    const stoneStroke = 0x3a3630;
    g.roundRect(bx, by, bw, bh, 2).fill(stoneColor);
    g.roundRect(bx, by, bw, bh, 2).stroke({ width: 0.9, color: stoneStroke });
    // Швы между камнями.
    const seams = isHorizontal ? Math.floor(bw / 8) : Math.floor(bh / 8);
    for (let i = 1; i <= seams; i += 1) {
      if (isHorizontal) {
        const sx = bx + (bw * i) / (seams + 1);
        g.moveTo(sx, by + 1)
          .lineTo(sx, by + bh - 1)
          .stroke({ width: 0.7, color: stoneStroke, alpha: 0.7 });
      } else {
        const sy = by + (bh * i) / (seams + 1);
        g.moveTo(bx + 1, sy)
          .lineTo(bx + bw - 1, sy)
          .stroke({ width: 0.7, color: stoneStroke, alpha: 0.7 });
      }
    }
    if (coverType === 1) drawCoverDamage(g, bx + bw / 2, by + bh / 2, bw * 0.8, bh + 2);
    return;
  }

  if (style === "bush") {
    // Живая изгородь: ряд перекрывающихся крон.
    const leaf = coverType === 2 ? 0x3e5c30 : 0x557a40;
    const count = Math.max(3, Math.floor((isHorizontal ? bw : bh) / 6));
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const kx = isHorizontal ? bx + bw * t : bx + bw / 2;
      const ky = isHorizontal ? by + bh / 2 : by + bh * t;
      g.circle(kx, ky, thick / 2 + 0.5).fill(leaf);
      g.circle(kx - 1, ky - 1, thick / 4).fill(shade(leaf, 18));
    }
    return;
  }

  // Дерево (этап 3.4): граневое укрытие — низкий частокол из заострённых
  // столбиков, визуально отличный от целоклеточного завала.
  const stakeCount = Math.max(3, Math.floor((isHorizontal ? bw : bh) / 6));
  const stakeW = (isHorizontal ? bw : bh) / stakeCount;
  const logColor = coverType === 2 ? 0x7a5a32 : 0xa08050;
  const logStroke = 0x3a2a18;
  for (let i = 0; i < stakeCount; i += 1) {
    let sx: number, sy: number, sw: number, sh: number;
    if (isHorizontal) {
      sw = stakeW - 1;
      sh = thick + 1;
      sx = bx + i * stakeW + 0.5;
      sy = by + (edge === 0 ? 0 : -1);
    } else {
      sw = thick + 1;
      sh = stakeW - 1;
      sx = bx + (edge === 3 ? 0 : -1);
      sy = by + i * stakeW + 0.5;
    }
    if (isHorizontal) {
      // Столбик с заострённым верхом (остриё к северу).
      g.poly([sx, sy + sh, sx, sy + 2, sx + sw / 2, sy, sx + sw, sy + 2, sx + sw, sy + sh]).fill(logColor);
      g.poly([sx, sy + sh, sx, sy + 2, sx + sw / 2, sy, sx + sw, sy + 2, sx + sw, sy + sh]).stroke({
        width: 0.7,
        color: logStroke,
      });
    } else {
      // Вертикальный столбик: остриё наружу грани (к востоку либо западу).
      const tipRight = edge === 1;
      const baseX = tipRight ? sx : sx + sw;
      const tipX = tipRight ? sx + sw + 2 : sx - 2;
      const midX = tipRight ? sx + sw - 1.5 : sx + 1.5;
      g.poly([baseX, sy, midX, sy, tipX, sy + sh / 2, midX, sy + sh, baseX, sy + sh])
        .fill(logColor)
        .stroke({ width: 0.7, color: logStroke });
    }
  }
}

export function drawCover(
  g: Graphics,
  cx: number,
  cy: number,
  coverType: 1 | 2,
  edge?: 0 | 1 | 2 | 3,
  style: "wood" | "stone" | "bush" = "wood",
): void {
  if (edge !== undefined) {
    drawEdgeCover(g, cx, cy, coverType, edge, style);
    return;
  }
  // Целоклеточное укрытие.
  const px = cx;
  const py = cy;
  g.ellipse(px, py + 11, 15, 4.5).fill({ color: 0x000000, alpha: 0.3 });

  if (style === "stone") {
    // Каменная глыба: серые грани независимо от яруса защиты.
    const body = coverType === 2 ? 0x6f6a5e : 0x8a857a;
    const stroke = 0x3a3630;
    g.poly([
      px - 13,
      py + 8,
      px - 11,
      py - 6,
      px - 1,
      py - 11,
      px + 11,
      py - 7,
      px + 13,
      py + 8,
      px + 4,
      py + 10,
      px - 5,
      py + 9,
    ]).fill(body);
    g.poly([px - 11, py - 6, px - 1, py - 11, px + 11, py - 7, px + 3, py - 1]).fill(shade(body, 16));
    g.poly([px - 13, py + 8, px - 5, py + 9, px + 4, py + 10, px + 13, py + 8, px + 6, py + 2, px - 6, py + 3]).fill(
      shade(body, -14),
    );
    g.poly([
      px - 13,
      py + 8,
      px - 11,
      py - 6,
      px - 1,
      py - 11,
      px + 11,
      py - 7,
      px + 13,
      py + 8,
      px + 4,
      py + 10,
      px - 5,
      py + 9,
    ]).stroke({ width: 1, color: stroke, alpha: 0.85 });
    if (coverType === 1) drawCoverDamage(g, px, py, 24, 18);
    return;
  }
  if (style === "bush") {
    // Густой куст: крона из перекрывающихся крон, полный — выше и темнее.
    const leaf = coverType === 2 ? 0x35502a : 0x557a40;
    const light = shade(leaf, 20);
    g.circle(px - 6, py + 4, 6).fill(leaf);
    g.circle(px + 6, py + 4, 6.5).fill(leaf);
    g.circle(px, coverType === 2 ? py - 4 : py - 1, coverType === 2 ? 8 : 6.5).fill(light);
    if (coverType === 2) g.circle(px - 3, py - 7, 5).fill(light);
    // Ягоды-точки для узнаваемости куста.
    g.circle(px - 8, py + 2, 0.9).fill(0x8a3a4a);
    g.circle(px + 7, py + 1, 0.9).fill(0x8a3a4a);
    g.circle(px + 2, py - 6, 0.9).fill(0x8a3a4a);
    return;
  }

  if (coverType === 1) {
    const ly = py + 4;
    g.roundRect(px - 11, ly - 3.5, 22, 7, 3.5).fill(0xa08050);
    g.roundRect(px - 11, ly - 3.5, 22, 7, 3.5).stroke({ width: 0.8, color: 0x4a3a28 });
    g.circle(px - 8, ly, 2.5).fill(0xc4a870);
    g.circle(px - 8, ly, 2.5).stroke({ width: 0.6, color: 0x4a3a28 });
    g.circle(px - 8, ly, 0.9).fill(0x6b4f2a);
    g.roundRect(px - 9, ly - 6, 18, 3.5, 1.8).fill(0xb89060);
    g.roundRect(px - 9, ly - 6, 18, 3.5, 1.8).stroke({ width: 0.6, color: 0x4a3a28 });
    // Этап 2.9: полуукрытие читается и по состоянию древесины.
    drawCoverDamage(g, px, ly - 1.2, 21, 11);
  } else {
    for (let i = 0; i < 3; i += 1) {
      const ly = py + 6 - i * 6;
      g.roundRect(px - 13, ly - 4.4, 26, 8.8, 4.2).fill(0x8a6a42);
      g.roundRect(px - 13, ly - 4.4, 26, 8.8, 4.2).stroke({ width: 1, color: 0x3a2a18 });
      g.circle(px - 10.6, ly, 3.1).fill(0xb28a58);
      g.circle(px - 10.6, ly, 3.1).stroke({ width: 0.8, color: 0x3a2a18 });
      g.circle(px - 10.6, ly, 1.1).fill(0x6b4f2a);
    }
    g.moveTo(px + 4, py - 9)
      .lineTo(px + 11, py - 14)
      .stroke({ width: 2.2, color: 0x6b4f2a });
    g.poly([px + 11, py - 14, px + 9, py - 11.6, px + 12.4, py - 11.4]).fill(0x3a2a18);
  }
}

/**
 * Иконка щита на грани клетки, ближе к центру (к персонажу).
 * Полуукрытие: щит с нижней половиной закрашенной.
 * Полное укрытие: щит полностью закрашенный.
 * @param alpha — прозрачность (1 для активного, 0.35 для hover-клетки).
 */
export function drawShieldIcon(
  g: Graphics,
  cx: number,
  cy: number,
  edge: 0 | 1 | 2 | 3,
  coverType: 1 | 2,
  alpha: number,
): void {
  const shieldW = 8;
  const shieldH = 10;
  // Позиция: на грани клетки, смещена к центру.
  const inset = 4;
  let sx: number, sy: number;
  if (edge === 0) {
    sx = cx;
    sy = cy - HALF + inset + shieldH / 2;
  } else if (edge === 2) {
    sx = cx;
    sy = cy + HALF - inset - shieldH / 2;
  } else if (edge === 1) {
    sx = cx + HALF - inset - shieldW / 2;
    sy = cy;
  } else {
    sx = cx - HALF + inset + shieldW / 2;
    sy = cy;
  }

  const hw = shieldW / 2;
  const hh = shieldH / 2;
  const color = coverType === 2 ? 0xe8b64c : 0x60c8ff;
  const darkColor = coverType === 2 ? 0x8a6a24 : 0x3080b0;

  // Форма щита: верх — прямоугольник, низ — треугольник (заострение).
  const top = sy - hh;
  const mid = sy + hh * 0.2;
  const bot = sy + hh;

  // Контур щита.
  g.moveTo(sx - hw, top)
    .lineTo(sx + hw, top)
    .lineTo(sx + hw, mid)
    .lineTo(sx, bot)
    .lineTo(sx - hw, mid)
    .closePath()
    .stroke({ width: 1.2, color: darkColor, alpha });

  if (coverType === 2) {
    // Полное укрытие: полностью закрашенный щит.
    g.moveTo(sx - hw, top)
      .lineTo(sx + hw, top)
      .lineTo(sx + hw, mid)
      .lineTo(sx, bot)
      .lineTo(sx - hw, mid)
      .closePath()
      .fill({ color, alpha: alpha * 0.75 });
  } else {
    // Полуукрытие: нижняя половина закрашена.
    const splitY = sy;
    g.moveTo(sx - hw, splitY)
      .lineTo(sx + hw, splitY)
      .lineTo(sx + hw, mid)
      .lineTo(sx, bot)
      .lineTo(sx - hw, mid)
      .closePath()
      .fill({ color, alpha: alpha * 0.65 });
  }

  // Крест на щите.
  g.moveTo(sx, top + 2)
    .lineTo(sx, bot - 2)
    .stroke({ width: 0.8, color: 0xffffff, alpha: alpha * 0.5 });
  g.moveTo(sx - hw + 2, sy - 1)
    .lineTo(sx + hw - 2, sy - 1)
    .stroke({ width: 0.8, color: 0xffffff, alpha: alpha * 0.5 });
}

/** Могильная отметина павшего: камешки и череп. */
export function drawFallen(g: Graphics, cx: number, cy: number): void {
  g.ellipse(cx, cy + 7, 12, 4).fill({ color: 0x000000, alpha: 0.3 });
  g.ellipse(cx - 5, cy + 5, 5, 3.2).fill(0x4a4d48);
  g.ellipse(cx + 5.5, cy + 6, 4, 2.6).fill(0x3c3f3a);
  g.ellipse(cx + 1, cy + 3, 3.4, 2.2).fill(0x555850);
  g.circle(cx - 1, cy - 2.5, 5.4).fill(0xd8d2c2);
  g.circle(cx - 1, cy - 2.5, 5.4).stroke({ width: 1, color: 0x6a6558 });
  g.circle(cx - 3.1, cy - 3.4, 1.25).fill(0x2a2a26);
  g.circle(cx + 1.1, cy - 3.4, 1.25).fill(0x2a2a26);
  g.rect(cx - 2.4, cy + 1.2, 2.8, 2.4).fill(0xd8d2c2);
}
