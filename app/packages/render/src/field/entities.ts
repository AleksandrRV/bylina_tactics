/**
 * Рисование фишек (токенов): тени, подставки, арт класса, статусы, полоски.
 * Перенесено из field-renderer.ts без изменений.
 */

import { Graphics } from "pixi.js";
import type { EntityState } from "@bylina/core";
import { CELL_SIZE } from "./constants.js";
import { hashCell } from "./math.js";
import { hexPoints } from "./geometry.js";
import { drawCover } from "./cover.js";
import {
  AIM_IMPOSSIBLE,
  AIM_PRESELECT,
  AIM_READY,
  AP_OFF,
  AP_ON,
  DRUZHINA_LOOK,
  FALLBACK_TOKEN_ART,
  HP_BACK,
  HP_LOW,
  HP_OK,
  NAV_LOOK,
  biomeLookOf,
  type FactionLook,
} from "../palette.js";
import { M1_ART, M5_ART, RECRUIT_ART, type TokenCtx } from "../token-art.js";
import type { DisplayState, FieldView } from "./types.js";

const DRUZHINA: FactionLook = DRUZHINA_LOOK;
const NAV: FactionLook = NAV_LOOK;
const FALLBACK_ART: Record<"druzhina" | "nav", number> = FALLBACK_TOKEN_ART;

/** Богатырь: стальной шлем с наносником, алые плечи, щит с коловратом.
 *  Этап 5.3: плечи шире — силуэт различим без увеличения. */
function drawBogatyr({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 6, 15.5, 8).fill(0x8e2f22);
  g.poly([cx - 8, cy + 9, cx, cy + 3, cx + 8, cy + 9, cx + 8, cy + 12, cx - 8, cy + 12]).fill(0x6f2118);
  g.circle(cx, cy - 3, 8.5).fill(0xb8c0c8);
  g.circle(cx, cy - 3, 8.5).stroke({ width: 1, color: 0x545c64 });
  g.poly([cx - 8, cy - 3, cx, cy - 12.5, cx + 8, cy - 3]).fill(0x9aa4ad);
  g.rect(cx - 1.2, cy - 6, 2.4, 9).fill(0x6d757d);
  g.circle(cx, cy - 8.5, 1.6).fill(0xe8d8a8);
  g.rect(cx - 8.5, cy - 1.5, 17, 2).fill(0x3f464e);
  const sx = cx - 10.5;
  const sy = cy + 6.5;
  g.circle(sx, sy, 6).fill(0xa63b2a);
  g.circle(sx, sy, 6).stroke({ width: 1.4, color: 0xc9a24b });
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 4;
    g.moveTo(sx - Math.cos(a) * 3.6, sy - Math.sin(a) * 3.6)
      .lineTo(sx + Math.cos(a) * 3.6, sy + Math.sin(a) * 3.6)
      .stroke({ width: 1.1, color: 0xe8d8a8 });
  }
}

/** Стрелец: меховая шапка, янтарный кафтан, лук через плечо. */
function drawStrelets({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 6.5, 12.5, 7.5).fill(0xb8792f);
  g.poly([cx - 8, cy + 4, cx + 8, cy + 4, cx + 5, cy + 11, cx - 5, cy + 11]).fill(0x8a5a20);
  g.circle(cx, cy - 2.5, 7).fill(0xdba86a);
  g.ellipse(cx, cy - 6.5, 8, 5).fill(0x4b3a26);
  g.ellipse(cx, cy - 8, 5.5, 3).fill(0x2e2317);
  for (let i = 0; i < 5; i += 1) {
    const dx = -6 + i * 3;
    g.moveTo(cx + dx, cy - 8.5)
      .lineTo(cx + dx + 1.1, cy - 5)
      .stroke({ width: 1, color: 0x6b543a, alpha: 0.8 });
  }
  g.moveTo(cx + 11, cy - 8)
    .quadraticCurveTo(cx + 19.5, cy, cx + 11, cy + 8)
    .stroke({ width: 2.2, color: 0x5f4126 });
  g.moveTo(cx + 11, cy - 8)
    .lineTo(cx + 11, cy + 8)
    .stroke({ width: 0.8, color: 0xd8d2c2, alpha: 0.9 });
  g.moveTo(cx + 3, cy - 9)
    .lineTo(cx + 7.5, cy - 12.5)
    .stroke({ width: 1.4, color: 0x8a5a20 });
  g.poly([cx + 7.5, cy - 12.5, cx + 6, cy - 11, cx + 8.6, cy - 10.6]).fill(0x3a4550);
}

/** Знахарка: бирюзовый капюшон, светлое лицо, коса, зелье. */
function drawZnaharka({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 7, 12, 7).fill(0x2e5f55);
  g.circle(cx, cy - 2, 9).fill(0x3f8577);
  g.ellipse(cx, cy - 1.5, 5.2, 6).fill(0xe8d2b0);
  g.moveTo(cx - 9.5, cy - 1)
    .quadraticCurveTo(cx - 10.5, cy - 10.5, cx, cy - 12.5)
    .quadraticCurveTo(cx + 10.5, cy - 10.5, cx + 9.5, cy - 1)
    .quadraticCurveTo(cx + 6.5, cy - 6.8, cx, cy - 7.4)
    .quadraticCurveTo(cx - 6.5, cy - 6.8, cx - 9.5, cy - 1)
    .fill(0x35685c);
  g.moveTo(cx - 9.5, cy - 1)
    .quadraticCurveTo(cx - 10.5, cy - 10.5, cx, cy - 12.5)
    .quadraticCurveTo(cx + 10.5, cy - 10.5, cx + 9.5, cy - 1)
    .stroke({ width: 1.2, color: 0x6fb0a0 });
  g.moveTo(cx + 5, cy + 4)
    .quadraticCurveTo(cx + 10, cy + 7, cx + 8.5, cy + 12)
    .stroke({ width: 3, color: 0xb9b099 });
  g.circle(cx + 8.5, cy + 12, 1.6).fill(0x8d8571);
  g.circle(cx - 7.5, cy + 8.5, 2.4).fill(0x7fe07a);
  g.circle(cx - 7.5, cy + 8.5, 2.4).stroke({ width: 0.8, color: 0x2e5f55 });
  g.circle(cx - 7.5, cy + 8, 1).fill(0xd6ffd2);
}

/** Упырь: чёрный плащ-крыло с алым подбоем, бледное лицо, угольные глаза. */
function drawUpyr({ g, cx, cy }: TokenCtx): void {
  g.poly([
    cx - 13,
    cy + 4,
    cx - 8,
    cy + 11,
    cx - 3,
    cy + 6.5,
    cx + 2,
    cy + 11.5,
    cx + 8,
    cy + 6,
    cx + 13,
    cy + 10.5,
    cx + 12,
    cy - 4,
    cx + 6,
    cy - 8,
    cx - 6,
    cy - 8,
    cx - 12,
    cy - 4,
  ]).fill(0x1c1a20);
  g.poly([cx - 7, cy - 4, cx, cy - 1, cx + 7, cy - 4, cx + 5, cy + 1.5, cx - 5, cy + 1.5]).fill(0x8e2f26);
  g.ellipse(cx, cy - 3.5, 5.4, 6.4).fill(0xd8cfc0);
  g.poly([cx - 3.5, cy - 7, cx, cy - 10.5, cx + 3.5, cy - 7]).fill(0x14161c);
  g.circle(cx - 2.1, cy - 3.4, 1.1).fill(0xe0a43a);
  g.circle(cx + 2.1, cy - 3.4, 1.1).fill(0xe0a43a);
  g.moveTo(cx - 6, cy + 5)
    .quadraticCurveTo(cx - 2, cy + 8, cx - 4, cy + 11)
    .stroke({ width: 1.2, color: 0xc9c4b6 });
}

/** Леший: кора, ветвистые рога, мох. */
function drawLeshy({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 6.5, 12, 8).fill(0x4c5c30);
  g.roundRect(cx - 6.5, cy - 7, 13, 13, 4).fill(0x6b4f33);
  g.moveTo(cx - 4, cy - 5)
    .lineTo(cx + 5, cy - 1)
    .moveTo(cx - 5, cy + 2)
    .lineTo(cx + 4, cy + 5)
    .stroke({ width: 0.9, color: 0x463320, alpha: 0.9 });
  for (const side of [-1, 1] as const) {
    const ax = cx + side * 5;
    g.moveTo(ax, cy - 6.5)
      .lineTo(ax + side * 5.5, cy - 13)
      .stroke({ width: 1.8, color: 0xc7b189 });
    g.moveTo(ax + side * 2.6, cy - 9.4)
      .lineTo(ax + side * 1.4, cy - 13.5)
      .stroke({ width: 1.5, color: 0xc7b189 });
    g.moveTo(ax + side * 4.4, cy - 11)
      .lineTo(ax + side * 7.4, cy - 14.5)
      .stroke({ width: 1.5, color: 0xc7b189 });
    g.circle(ax + side * 7.4, cy - 14.5, 1.3).fill(0x5f8a3c);
  }
  g.circle(cx - 2.3, cy - 1.5, 1).fill(0xcfe8a0);
  g.circle(cx + 2.3, cy - 1.5, 1).fill(0xcfe8a0);
  g.ellipse(cx, cy + 5, 5, 3.2).fill(0x5f8a3c);
}

/** Кикимора: сгорбленная фигура, спутанная косма, игла. */
function drawKikimora({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 7, 11.5, 7).fill(0x505c46);
  g.roundRect(cx - 7, cy - 2, 14, 11, 5).fill(0x5a6650);
  g.ellipse(cx, cy - 4.5, 5, 4.6).fill(0xccc39a);
  for (let i = 0; i < 9; i += 1) {
    const a = Math.PI * (0.95 + (i / 8) * 1.1);
    const sx = cx + Math.cos(a) * 5;
    const sy = cy - 4.5 + Math.sin(a) * 4.5;
    const ex = cx + Math.cos(a) * (10 + hashCell(i, 3, 7) * 3);
    const ey = cy - 4.5 + Math.sin(a) * (8 + hashCell(i, 5, 11) * 3) + 3.5;
    g.moveTo(sx, sy)
      .quadraticCurveTo((sx + ex) / 2 + 2, (sy + ey) / 2, ex, ey)
      .stroke({ width: 1.3, color: i % 2 === 0 ? 0x7a8f46 : 0x93a354 });
  }
  g.circle(cx - 1.8, cy - 4.6, 1.1).fill(0xe4d24e);
  g.circle(cx + 1.8, cy - 4.6, 1.1).fill(0xe4d24e);
  g.moveTo(cx + 4, cy + 3)
    .lineTo(cx + 10, cy + 9)
    .stroke({ width: 1, color: 0xb9c0c8 });
  g.moveTo(cx + 9.2, cy + 8.2)
    .lineTo(cx + 10.8, cy + 9.8)
    .stroke({ width: 0.7, color: 0xb9c0c8 });
}

function drawVolkhv({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 6, 11, 7).fill(0x264f57);
  g.poly([cx - 9, cy + 5, cx, cy - 12, cx + 9, cy + 5]).fill(0x357681);
  g.moveTo(cx - 9, cy + 5)
    .lineTo(cx + 9, cy + 5)
    .stroke({ width: 1.2, color: 0x1d3a40 });
  g.circle(cx, cy - 2, 5).fill(0xd9c9a5);
  g.circle(cx - 2, cy - 2, 1.05).fill(0x9ff3ff);
  g.circle(cx + 2, cy - 2, 1.05).fill(0x9ff3ff);
  g.moveTo(cx + 8, cy - 7)
    .lineTo(cx + 12, cy + 11)
    .stroke({ width: 2, color: 0x8b6a42 });
  g.circle(cx + 8, cy - 8, 3).stroke({ width: 1.5, color: 0x75e0eb });
  for (const offset of [0, Math.PI]) {
    const a = performance.now() * 0.003 + offset;
    g.circle(cx + 8 + Math.cos(a) * 4.4, cy - 8 + Math.sin(a) * 4.4, 1.1).fill(0x75e0eb);
  }
}

function drawForestBeast({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 3, 12, 8).fill(0x6f8d43);
  g.circle(cx + 8, cy - 3, 6).fill(0x86a957);
  g.poly([cx + 5, cy - 8, cx + 7, cy - 14, cx + 10, cy - 8]).fill(0x526d32);
  g.poly([cx + 10, cy - 8, cx + 14, cy - 13, cx + 14, cy - 6]).fill(0x526d32);
  g.circle(cx + 10, cy - 3, 1.1).fill(0xe9f5a1);
  g.circle(cx + 6.5, cy - 5, 1.1).fill(0xe9f5a1);
  g.circle(cx - 2, cy + 2, 2.2).fill({ color: 0x526d32, alpha: 0.85 });
  g.circle(cx - 6, cy + 4, 1.8).fill({ color: 0x526d32, alpha: 0.85 });
  g.moveTo(cx - 10, cy + 1)
    .quadraticCurveTo(cx - 18, cy - 7, cx - 13, cy - 12)
    .stroke({ width: 2.5, color: 0x759a49 });
}

function drawIllusion({ g, cx, cy }: TokenCtx): void {
  const outline = { width: 1.5, color: 0xbdf8ff, alpha: 0.85 } as const;
  g.poly([cx, cy - 13, cx + 10, cy + 7, cx, cy + 13, cx - 10, cy + 7]).fill({ color: 0x72dce8, alpha: 0.32 });
  g.poly([cx, cy - 13, cx + 10, cy + 7, cx, cy + 13, cx - 10, cy + 7]).stroke(outline);
  g.moveTo(cx, cy - 13)
    .lineTo(cx, cy + 13)
    .stroke({ width: 1, color: 0xbdf8ff, alpha: 0.45 });
  g.moveTo(cx - 10, cy + 7)
    .lineTo(cx + 10, cy + 7)
    .stroke({ width: 1, color: 0xbdf8ff, alpha: 0.45 });
  g.circle(cx, cy - 2, 4).fill({ color: 0xe8ffff, alpha: 0.6 });
  g.circle(cx - 3.4, cy + 4, 1.1).fill({ color: 0xe8ffff, alpha: 0.5 });
  g.circle(cx + 3.4, cy + 4, 1.1).fill({ color: 0xe8ffff, alpha: 0.5 });
}

/** Идол Нави: каменная стела с ликом; цель уничтожения (0.13.0). */
function drawIdol({ g, cx, cy }: TokenCtx): void {
  g.roundRect(cx - 14, cy + 6, 28, 7, 2)
    .fill({ color: 0x4a4a52, alpha: 1 })
    .stroke({ width: 1, color: 0x2e2e34 });
  g.roundRect(cx - 11, cy - 14, 22, 21, 3)
    .fill(0x5d5d66)
    .stroke({ width: 1.2, color: 0x34343b });
  g.circle(cx, cy - 6, 4.5).fill(0x3f3f47);
  g.circle(cx - 1.6, cy - 7, 1.2).fill(0xb8b8c4);
  g.circle(cx + 1.6, cy - 7, 1.2).fill(0xb8b8c4);
  g.poly([cx - 2.6, cy - 3, cx + 2.6, cy - 3, cx, cy - 0.8]).fill(0x2c2c33);
  g.poly([cx - 8, cy - 11, cx - 6, cy - 11, cx - 7, cy - 9]).fill(0x8a6f4a);
  g.poly([cx + 8, cy - 11, cx + 6, cy - 11, cx + 7, cy - 9]).fill(0x8a6f4a);
  g.poly([cx - 8, cy + 1, cx - 6, cy + 1, cx - 7, cy + 3]).fill(0x8a6f4a);
}

/** Княжна: спасаемое лицо; белая фигурка с кокошником и алой накидкой (0.13.0). */
function drawCaptive({ g, cx, cy }: TokenCtx): void {
  g.poly([cx - 7, cy - 10, cx + 7, cy - 10, cx + 5, cy - 4, cx - 5, cy - 4])
    .fill(0xd9b64a)
    .stroke({ width: 0.8, color: 0x8a6f2a });
  g.circle(cx, cy - 11, 3).fill(0xe8d9b0);
  g.poly([cx - 8, cy - 2, cx + 8, cy - 2, cx + 11, cy + 12, cx - 11, cy + 12])
    .fill(0xb83a3a)
    .stroke({ width: 0.8, color: 0x6e2222 });
  g.poly([cx - 8, cy - 2, cx + 8, cy - 2, cx + 8, cy + 1, cx - 8, cy + 1]).fill(0xd9b64a);
  g.poly([cx - 10, cy + 1, cx - 13, cy + 6, cx - 10, cy + 6]).fill(0xe8d9b0);
  g.poly([cx + 10, cy + 1, cx + 13, cy + 6, cx + 10, cy + 6]).fill(0xe8d9b0);
}

/** Баба Яга: ведьма в ступе; полёт, контроль, пороговый уход (0.18.0). */
function drawBabaYaga({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 9, 11, 5)
    .fill(0x3a2a1a)
    .stroke({ width: 1, color: 0x241a10 });
  g.ellipse(cx, cy + 6, 7.5, 4).fill(0x241a10);
  g.ellipse(cx, cy + 12, 5, 2.5).fill({ color: 0x7a4a2a, alpha: 0.9 });
  g.ellipse(cx, cy + 13, 3, 1.6).fill({ color: 0xc97a3a, alpha: 0.95 });
  g.circle(cx, cy - 3, 6)
    .fill(0x8a8f98)
    .stroke({ width: 0.8, color: 0x4a4e55 });
  g.circle(cx, cy - 3.4, 4.4).fill(0xd8cfc0);
  g.poly([cx - 6.5, cy - 2, cx + 6.5, cy - 2, cx + 4.5, cy + 6, cx - 4.5, cy + 6]).fill(0x5a5f68);
  g.circle(cx, cy - 8.6, 2).fill(0x8a4a3a);
  g.poly([cx + 3.4, cy - 4.6, cx + 6, cy - 3.2, cx + 3.4, cy - 2.4]).fill(0xd8cfc0);
  g.moveTo(cx + 7, cy + 4)
    .lineTo(cx + 13, cy - 2)
    .stroke({ width: 1.4, color: 0x6b4f2a });
  g.poly([cx + 11, cy - 1, cx + 16, cy - 4, cx + 13, cy + 1]).fill(0xa08050);
  g.circle(cx - 4, cy + 2.4, 1.8).fill({ color: 0x5fd6a8, alpha: 0.9 });
}

/** Соловей-Разбойник: разбойник с луком и свитком (0.18.0). */
function drawSolovey({ g, cx, cy }: TokenCtx): void {
  g.poly([cx - 9, cy - 4, cx + 9, cy - 4, cx + 7, cy + 11, cx - 7, cy + 11])
    .fill(0x4a4a3a)
    .stroke({ width: 0.8, color: 0x2c2c22 });
  g.circle(cx, cy - 6, 5.5).fill(0xd8c9a8);
  g.poly([cx - 6, cy - 9, cx + 6, cy - 9, cx + 4, cy - 4, cx - 4, cy - 4]).fill(0x8a2a2a);
  g.poly([cx - 3.4, cy - 3, cx + 3.4, cy - 3, cx, cy + 2.4]).fill(0x6b5b48);
  g.moveTo(cx + 8, cy - 2)
    .quadraticCurveTo(cx + 14, cy + 2, cx + 8, cy + 7)
    .stroke({ width: 1.4, color: 0x8a6a3a });
  g.moveTo(cx + 8, cy - 2)
    .lineTo(cx + 8, cy + 7)
    .stroke({ width: 0.6, color: 0xd8cfc0 });
  g.circle(cx - 2, cy + 7, 2)
    .fill(0xd9b64a)
    .stroke({ width: 0.6, color: 0x8a6f2a });
}

const CLASS_ART: Partial<Record<string, (ctx: TokenCtx) => void>> = {
  ...M1_ART,
  ...M5_ART,
  ...RECRUIT_ART,
  bogatyr: drawBogatyr,
  strelets: drawStrelets,
  znaharka: drawZnaharka,
  upyr: drawUpyr,
  leshy: drawLeshy,
  kikimora: drawKikimora,
  volkhv: drawVolkhv,
  forest_beast: drawForestBeast,
  illusion: drawIllusion,
  idol: drawIdol,
  captive: drawCaptive,
  baba_yaga: drawBabaYaga,
  solovey: drawSolovey,
};

/** Контекст рисования токена: все данные, нужные drawToken. */
export interface DrawTokenCtx {
  display: Map<number, DisplayState>;
  dying: Map<number, number>;
  flashes: Map<number, number>;
  lunges: Map<number, { dx: number; dy: number }>;
  bumps: Map<number, { dx: number; dy: number }>;
  view: FieldView | null;
  reducedMotion: boolean;
  playing: boolean;
}

/** Рисование одного токена (фишки/сущности) в динамическом слое. */
export function drawToken(
  g: Graphics,
  entity: EntityState,
  motionNow: number,
  ctx: DrawTokenCtx,
  entityPixel: (e: EntityState) => { cx: number; cy: number },
): void {
  const { display, dying, flashes, view, reducedMotion, playing } = ctx;
  const shown = display.get(entity.id);
  const deadNow = shown?.dead ?? entity.dead;
  if (deadNow) return;
  const pixel = entityPixel(entity);
  const cx = pixel.cx;
  const zShown = shown?.z ?? entity.z;
  const isSelected = entity.id === view?.selectedId;
  const lift = isSelected ? 3 : 0;
  const breath =
    !reducedMotion && !playing && entity.coverType === 0
      ? Math.sin(performance.now() * 0.0031 + hashCell(entity.id, 7, 13) * Math.PI * 2) * 1.4
      : 0;
  const dieStart = dying.get(entity.id);
  const fade = dieStart === undefined ? 1 : Math.max(0.25, 1 - ((performance.now() - dieStart) / 700) * 0.75);
  let cy = pixel.cy - lift + breath;
  if (dieStart !== undefined) {
    const settle = Math.min(1, (performance.now() - dieStart) / 700);
    cy += settle * settle * 11;
  }

  if (entity.coverType > 0) {
    drawCover(g, cx, cy, entity.coverType as 1 | 2, entity.edge, biomeLookOf(view?.biome).coverStyle);
    return;
  }

  const faction: FactionLook = entity.owner === 2 ? NAV : DRUZHINA;
  const flash = flashes.get(entity.id) ?? 0;

  if (entity.overwatch) {
    const angle = (-90 + entity.dir * 90) * (Math.PI / 180);
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    const sideX = -forwardY;
    const sideY = forwardX;
    const depth = CELL_SIZE * 7;
    const width = CELL_SIZE * 6;
    g.poly([
      cx + sideX * width,
      cy + sideY * width,
      cx - sideX * width,
      cy - sideY * width,
      cx + forwardX * depth - sideX * width,
      cy + forwardY * depth - sideY * width,
      cx + forwardX * depth + sideX * width,
      cy + forwardY * depth + sideY * width,
    ]).fill({ color: 0xe8b64c, alpha: 0.08 });
  }

  g.ellipse(cx, pixel.cy + 15, 14 + zShown * 3, 4.5 + zShown * 0.8).fill({
    color: 0x000000,
    alpha: Math.min(0.55, Math.max(0.08, (0.32 - zShown * 0.05 + (isSelected ? 0.12 : 0)) * fade)),
  });
  if (entity.owner === 0) {
    // Предметы лежат на земле: подставка не нужна.
  } else if (entity.owner === 2) {
    g.poly(hexPoints(cx, cy, 17.5)).fill(faction.ring);
    g.poly(hexPoints(cx, cy, 17.5)).stroke({ width: 1, color: faction.ringDark });
    g.poly(hexPoints(cx, cy, 14.6)).fill(faction.disc);
  } else {
    g.circle(cx, cy, 17.5).fill(faction.ring);
    g.circle(cx, cy, 17.5).stroke({ width: 1, color: faction.ringDark });
    g.circle(cx, cy, 14.6).fill(faction.disc);
  }

  const art = CLASS_ART[entity.configId];
  if (art) art({ g, cx, cy, entity, motionNow });
  else g.circle(cx, cy, 10).fill(FALLBACK_ART[entity.owner === 2 ? "nav" : "druzhina"]);

  const statusTime = (reducedMotion ? 12000 : performance.now()) * 0.004;
  const camouflaged = Boolean(
    entity.camouflageMinCover &&
    view?.snapshot.entities.some(
      (other) =>
        !other.dead &&
        other.owner === entity.owner &&
        other.id !== entity.id &&
        other.providesCamouflage &&
        Math.max(Math.abs(other.x - entity.x), Math.abs(other.y - entity.y)) <= 1,
    ),
  );
  const statusStack: Array<{
    key: "panic" | "poison" | "immobile" | "timed" | "hidden" | "camouflage";
    priority: number;
  }> = [];
  if (entity.panic) statusStack.push({ key: "panic", priority: 0 });
  if (entity.poison) statusStack.push({ key: "poison", priority: 1 });
  if (entity.immobileTurns) statusStack.push({ key: "immobile", priority: 2 });
  if (entity.timedLife !== undefined) statusStack.push({ key: "timed", priority: 3 });
  if (entity.hidden) statusStack.push({ key: "hidden", priority: 4 });
  if (camouflaged) statusStack.push({ key: "camouflage", priority: 5 });
  statusStack.sort((a, b) => a.priority - b.priority);
  const stackRadii = [23, 27.5, 32];
  for (const [slot, entry] of statusStack.slice(0, 3).entries()) {
    const orbit = stackRadii[slot] ?? 32;
    if (entry.key === "panic") {
      const pulse = 0.55 + Math.sin(statusTime * 2.4) * 0.25;
      g.circle(cx, cy, orbit + pulse * 3).stroke({ width: 2, color: 0xb94cff, alpha: pulse });
      if (slot === 0) {
        g.poly([cx - 2, cy - 27, cx + 2, cy - 27, cx + 1, cy - 18, cx - 1, cy - 18]).fill(0xff5e7a);
        g.circle(cx, cy - 14.5, 1.8).fill(0xff5e7a);
      }
    } else if (entry.key === "poison") {
      for (let i = 0; i < 4; i += 1) {
        const angle = statusTime + (i * Math.PI * 2) / 4;
        const radius = orbit + Math.sin(statusTime * 1.7 + i) * 2;
        g.circle(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius - 2, 2.2 + (i % 2) * 0.7).fill({
          color: 0x78d83d,
          alpha: 0.8,
        });
        g.circle(cx + Math.cos(angle) * radius - 0.6, cy + Math.sin(angle) * radius - 2.8, 0.8).fill({
          color: 0xd7ff8a,
          alpha: 0.9,
        });
      }
    } else if (entry.key === "immobile") {
      const reach = orbit / 24;
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2;
        const x0 = cx + Math.cos(angle) * 10;
        const y0 = cy + Math.sin(angle) * 8 + 9;
        g.moveTo(x0, y0)
          .quadraticCurveTo(
            cx + Math.cos(angle + 0.5) * 19 * reach,
            cy + 14,
            cx + Math.cos(angle) * 24 * reach,
            cy + 12,
          )
          .stroke({ width: 2, color: 0x6f8f3d, alpha: 0.9 });
      }
    } else if (entry.key === "timed") {
      const dots = Math.max(1, Math.min(6, entity.timedLife ?? 1));
      for (let i = 0; i < dots; i += 1) {
        const angle = -Math.PI / 2 + (i / Math.max(1, dots)) * Math.PI * 2;
        g.circle(cx + Math.cos(angle) * orbit, cy + Math.sin(angle) * orbit, 1.9).fill(0x5fd6e8);
      }
    } else if (entry.key === "hidden") {
      g.circle(cx, cy, orbit).stroke({ width: 1.5, color: 0x8fd3bc, alpha: 0.5 + Math.sin(statusTime) * 0.2 });
    } else {
      for (let i = 0; i < 3; i += 1) {
        const angle = statusTime * 0.5 + (i * Math.PI * 2) / 3;
        g.ellipse(cx + Math.cos(angle) * orbit * 0.85, cy + Math.sin(angle) * orbit * 0.55, 3.6, 1.9).fill({
          color: 0x7fb84d,
          alpha: 0.75,
        });
      }
    }
  }
  if (entity.flying) {
    const wing = 7 + Math.sin(statusTime * 2) * 3;
    g.moveTo(cx - 13, cy - 2)
      .quadraticCurveTo(cx - 21, cy - wing, cx - 24, cy + 2)
      .stroke({ width: 2, color: 0xbfe8ff, alpha: 0.8 });
    g.moveTo(cx + 13, cy - 2)
      .quadraticCurveTo(cx + 21, cy - wing, cx + 24, cy + 2)
      .stroke({ width: 2, color: 0xbfe8ff, alpha: 0.8 });
  }

  if (fade < 1) {
    g.circle(cx, cy, 17.5).fill({ color: 0x101410, alpha: (1 - fade) * 0.85 });
  }

  const angle = (-90 + entity.dir * 90) * (Math.PI / 180);
  g.poly([
    cx + Math.cos(angle) * 20.5,
    cy + Math.sin(angle) * 20.5,
    cx + Math.cos(angle + 0.32) * 16,
    cy + Math.sin(angle + 0.32) * 16,
    cx + Math.cos(angle - 0.32) * 16,
    cy + Math.sin(angle - 0.32) * 16,
  ]).fill(faction.ring);

  if (entity.id === view?.selectedId) {
    g.circle(cx, cy, 22).stroke({ width: 2.6, color: 0xe8b64c });
    g.circle(cx, cy, 25.2).stroke({ width: 1, color: 0xe8b64c, alpha: 0.5 });
  }
  if (entity.id === view?.aimId) {
    const aimState = view.aimState ?? (view.aimOk ? "ready" : "blocked");
    const aimRing = aimState === "ready" ? AIM_READY : aimState === "blocked" ? AIM_IMPOSSIBLE : AIM_PRESELECT;
    g.circle(cx, cy, 22).stroke({ width: 2.4, color: aimRing });
  }

  if (flash > 0) {
    g.circle(cx, cy, 20 + (1 - flash) * 6).stroke({ width: 2.6, color: 0xf3ecdc, alpha: flash });
  }

  const hp = shown?.hp ?? entity.hp;
  const maxHp = shown?.maxHp ?? entity.maxHp;
  const ratio = Math.max(0, hp / Math.max(1, maxHp));
  g.roundRect(cx - 15, cy - 27, 30, 4.4, 2).fill({ color: HP_BACK, alpha: 0.62 });
  if (ratio > 0) {
    g.roundRect(cx - 14, cy - 26, 28 * ratio, 2.6, 1.3).fill(ratio > 0.4 ? HP_OK : HP_LOW);
  }

  const pips = Math.max(0, entity.ap);
  for (let i = 0; i < entity.maxAp; i += 1) {
    const px0 = cx - ((entity.maxAp - 1) * 8) / 2 + i * 8;
    g.poly([px0, cy + 21.5, px0 + 2.9, cy + 24.4, px0, cy + 27.3, px0 - 2.9, cy + 24.4]).fill(
      i < pips ? AP_ON : AP_OFF,
    );
  }

  if (entity.defending) {
    const sx = cx + 16;
    const sy = cy - 18;
    g.roundRect(sx - 5, sy - 6, 10, 12, 2).fill(0x388cdc);
    g.roundRect(sx - 5, sy - 6, 10, 12, 2).stroke({ width: 1.2, color: 0x8fd0ff });
    g.moveTo(sx, sy - 3)
      .lineTo(sx, sy + 3)
      .stroke({ width: 1.4, color: 0xf3ecdc });
    g.moveTo(sx - 2.5, sy)
      .lineTo(sx + 2.5, sy)
      .stroke({ width: 1.4, color: 0xf3ecdc });
  }

  if (entity.overwatch) {
    const ox = cx - 16;
    const oy = cy - 18;
    g.circle(ox, oy, 5.5).fill({ color: 0xe8b64c, alpha: 0.9 });
    g.circle(ox, oy, 5.5).stroke({ width: 1, color: 0x57431a });
    g.circle(ox, oy, 2.2).fill(0x1c1a20);
    g.circle(ox + 0.8, oy - 0.8, 0.7).fill(0xf3ecdc);
  }
}
