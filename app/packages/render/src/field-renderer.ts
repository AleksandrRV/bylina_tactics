import {
  effectiveCoverTier,
  terrainCoverTier,
  tileAt,
  type CellPos,
  type EntityState,
  type GameEvent,
  type MatchState,
  type ReachableCell,
  type Tile,
} from "@bylina/core";
import { Application, Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from "pixi.js";

export const RENDER_STATUS = "pixi" as const;
export const CELL_SIZE = 52;
const RISE = 12;
const PAD = 26;

export interface FieldView {
  /** Seed identifies the generated terrain; it changes only when a new map is created. */
  matchSeed: number;
  snapshot: MatchState;
  selectedId: number | null;
  aimId: number | null;
  reachable: ReachableCell[];
  path: CellPos[];
  aimOk: boolean;
  heightMod: -1 | 0 | 1;
  debugMovement?: boolean;
  /** Клетки, которые сторона наблюдает сейчас (ключи «x,y»). Пустое множество = без тумана. */
  visibleCells?: Set<string>;
  /** Клетки, которые сторона когда-либо наблюдала (ключи «x,y»). */
  exploredCells?: Set<string>;
  /** Клетка, до которой линия прицеливания сплошная (препятствие или макс. дальность). */
  aimBreakCell?: CellPos | null;
  /** Клетка, над которой сейчас курсор (для подсветки защиты при перемещении). */
  hoverCell?: CellPos | null;
  /** Подсветка обучающей подсказки (0.19.0): клетка либо сущность. */
  trainingHighlight?: { kind: "cell" | "entity"; x: number; y: number } | null;
}

export interface FieldRenderer {
  mount(host: HTMLElement): Promise<void>;
  update(view: FieldView): void;
  play(events: GameEvent[]): Promise<void>;
  pan(dx: number, dy: number): void;
  destroy(): void;
  setOnActivate(handler: (x: number, y: number) => void): void;
  setOnHover(handler: (x: number, y: number) => void): void;
}

/* ---------- палитра и примитивы ---------- */

function shade(color: number, amount: number): number {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (color & 0xff) + amount));
  return (r << 16) | (g << 8) | b;
}

function mix(a: number, b: number, t: number): number {
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
function hashCell(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Локальный шум для визуальных эффектов (тряска камеры). Начальное значение
 * зависит от времени запуска, поэтому эффект не повторяется кадр в кадр,
 * но не использует стандартный генератор среды (§1 math: источник случайности
 * тактического слоя — только Mulberry32; средство отображения состояния не меняет).
 */
let shakeSeed = (Date.now() >>> 0) || 0x9e3779b9;

function shakeNoise(): number {
  shakeSeed = (Math.imul(shakeSeed, 1664525) + 1013904223) >>> 0;
  return shakeSeed / 4294967296;
}

/* ---------- рельеф ---------- */

/** Верхние грани по уровням: низ — холодный мох, земля — луг, верх — светлая выжженная трава. */
const Z_FACE = [0x2c3a2c, 0x43603f, 0x74925f] as const;
/** Откос (южная стена скалы) по уровням: тёмная земляная огранка. */
const Z_RISER = [0x171a12, 0x23291a, 0x38432a] as const;

function visualLevel(tile: Tile): number {
  return tile.pit ? 0 : tile.z;
}

function neighborLevel(tiles: readonly Tile[], x: number, y: number): number | null {
  const found = tiles.find((tile) => tile.x === x && tile.y === y);
  if (!found) return null;
  return visualLevel(found);
}

/* ---------- токены ---------- */

interface FactionLook {
  ring: number;
  ringDark: number;
  disc: number;
}

const DRUZHINA: FactionLook = { ring: 0xe8b64c, ringDark: 0x57431a, disc: 0x241c12 };
const NAV: FactionLook = { ring: 0x8bc34a, ringDark: 0x1e3311, disc: 0x131b10 };

interface TokenCtx {
  g: Graphics;
  cx: number;
  cy: number;
}

/** Богатырь: стальной шлем с наносником, алые плечи, щит с коловратом. */
function drawBogatyr({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 6, 13, 8).fill(0x8e2f22);
  g.poly([cx - 6, cy + 9, cx, cy + 3, cx + 6, cy + 9, cx + 6, cy + 12, cx - 6, cy + 12]).fill(0x6f2118);
  g.circle(cx, cy - 3, 8.5).fill(0xb8c0c8);
  g.circle(cx, cy - 3, 8.5).stroke({ width: 1, color: 0x545c64 });
  g.poly([cx - 8, cy - 3, cx, cy - 12.5, cx + 8, cy - 3]).fill(0x9aa4ad);
  g.rect(cx - 1.2, cy - 6, 2.4, 9).fill(0x6d757d);
  g.circle(cx, cy - 8.5, 1.6).fill(0xe8d8a8);
  g.rect(cx - 7, cy - 1.5, 14, 2).fill(0x3f464e);
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
  g.moveTo(cx + 9.5, cy - 7)
    .quadraticCurveTo(cx + 14.5, cy, cx + 9.5, cy + 8)
    .stroke({ width: 2, color: 0x5f4126 });
  g.moveTo(cx + 9.5, cy - 7)
    .lineTo(cx + 9.5, cy + 8)
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
  g.moveTo(cx - 9, cy - 2)
    .quadraticCurveTo(cx - 9.5, cy - 9, cx, cy - 11)
    .quadraticCurveTo(cx + 9.5, cy - 9, cx + 9, cy - 2)
    .stroke({ width: 3, color: 0x6fb0a0 });
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
    cx - 13, cy + 4,
    cx - 8, cy + 11,
    cx - 3, cy + 6.5,
    cx + 2, cy + 11.5,
    cx + 8, cy + 6,
    cx + 13, cy + 10.5,
    cx + 12, cy - 4,
    cx + 6, cy - 8,
    cx - 6, cy - 8,
    cx - 12, cy - 4,
  ]).fill(0x1c1a20);
  g.poly([cx - 7, cy - 4, cx, cy - 1, cx + 7, cy - 4, cx + 5, cy + 1.5, cx - 5, cy + 1.5]).fill(0x8e2f26);
  g.ellipse(cx, cy - 3.5, 5.4, 6.4).fill(0xd8cfc0);
  g.poly([cx - 3.5, cy - 7, cx, cy - 10.5, cx + 3.5, cy - 7]).fill(0x14161c);
  g.circle(cx - 2.1, cy - 3.4, 0.95).fill(0xe0a43a);
  g.circle(cx + 2.1, cy - 3.4, 0.95).fill(0xe0a43a);
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
  g.circle(cx - 1.8, cy - 4.6, 0.85).fill(0xe4d24e);
  g.circle(cx + 1.8, cy - 4.6, 0.85).fill(0xe4d24e);
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
  g.circle(cx, cy - 2, 5).fill(0xd9c9a5);
  g.circle(cx - 2, cy - 2, 0.8).fill(0x9ff3ff);
  g.circle(cx + 2, cy - 2, 0.8).fill(0x9ff3ff);
  g.moveTo(cx + 8, cy - 7).lineTo(cx + 12, cy + 11).stroke({ width: 2, color: 0x8b6a42 });
  g.circle(cx + 8, cy - 8, 3).stroke({ width: 1.5, color: 0x75e0eb });
}

function drawForestBeast({ g, cx, cy }: TokenCtx): void {
  g.ellipse(cx, cy + 3, 12, 8).fill(0x6f8d43);
  g.circle(cx + 8, cy - 3, 6).fill(0x86a957);
  g.poly([cx + 5, cy - 8, cx + 7, cy - 14, cx + 10, cy - 8]).fill(0x526d32);
  g.poly([cx + 10, cy - 8, cx + 14, cy - 13, cx + 14, cy - 6]).fill(0x526d32);
  g.circle(cx + 10, cy - 3, 0.9).fill(0xe9f5a1);
  g.moveTo(cx - 10, cy + 1).quadraticCurveTo(cx - 18, cy - 7, cx - 13, cy - 12)
    .stroke({ width: 2.5, color: 0x759a49 });
}

function drawIllusion({ g, cx, cy }: TokenCtx): void {
  g.poly([cx, cy - 13, cx + 10, cy + 7, cx, cy + 13, cx - 10, cy + 7]).fill({ color: 0x72dce8, alpha: 0.32 });
  g.poly([cx, cy - 13, cx + 10, cy + 7, cx, cy + 13, cx - 10, cy + 7]).stroke({ width: 1.5, color: 0xbdf8ff, alpha: 0.85 });
  g.circle(cx, cy - 2, 4).fill({ color: 0xe8ffff, alpha: 0.6 });
}

/** Идол Нави: каменная стела с ликом; цель уничтожения (0.13.0). */
function drawIdol({ g, cx, cy }: TokenCtx): void {
  // Постамент.
  g.roundRect(cx - 14, cy + 6, 28, 7, 2).fill({ color: 0x4a4a52, alpha: 1 }).stroke({ width: 1, color: 0x2e2e34 });
  // Стела.
  g.roundRect(cx - 11, cy - 14, 22, 21, 3).fill(0x5d5d66).stroke({ width: 1.2, color: 0x34343b });
  // Лик.
  g.circle(cx, cy - 6, 4.5).fill(0x3f3f47);
  g.circle(cx - 1.6, cy - 7, 1).fill(0xb8b8c4);
  g.circle(cx + 1.6, cy - 7, 1).fill(0xb8b8c4);
  g.poly([cx - 2.6, cy - 3, cx + 2.6, cy - 3, cx, cy - 0.8]).fill(0x2c2c33);
  // Руны по бокам.
  g.poly([cx - 8, cy - 11, cx - 6, cy - 11, cx - 7, cy - 9]).fill(0x8a6f4a);
  g.poly([cx + 8, cy - 11, cx + 6, cy - 11, cx + 7, cy - 9]).fill(0x8a6f4a);
  g.poly([cx - 8, cy + 1, cx - 6, cy + 1, cx - 7, cy + 3]).fill(0x8a6f4a);
}

/** Княжна: спасаемое лицо; белая фигурка с кокошником и алой накидкой (0.13.0). */
function drawCaptive({ g, cx, cy }: TokenCtx): void {
  // Кокошник.
  g.poly([cx - 7, cy - 10, cx + 7, cy - 10, cx + 5, cy - 4, cx - 5, cy - 4]).fill(0xd9b64a).stroke({ width: 0.8, color: 0x8a6f2a });
  g.circle(cx, cy - 11, 3).fill(0xe8d9b0);
  // Платье-колокол.
  g.poly([cx - 8, cy - 2, cx + 8, cy - 2, cx + 11, cy + 12, cx - 11, cy + 12]).fill(0xb83a3a).stroke({ width: 0.8, color: 0x6e2222 });
  // Пояс.
  g.poly([cx - 8, cy - 2, cx + 8, cy - 2, cx + 8, cy + 1, cx - 8, cy + 1]).fill(0xd9b64a);
  // Руки.
  g.poly([cx - 10, cy + 1, cx - 13, cy + 6, cx - 10, cy + 6]).fill(0xe8d9b0);
  g.poly([cx + 10, cy + 1, cx + 13, cy + 6, cx + 10, cy + 6]).fill(0xe8d9b0);
}

/** Баба Яга: ведьма в ступе; полёт, контроль, пороговый уход (0.18.0). */
function drawBabaYaga({ g, cx, cy }: TokenCtx): void {
  // Ступа (тёмное дерево) с парящим ореолом.
  g.ellipse(cx, cy + 9, 11, 5).fill(0x3a2a1a).stroke({ width: 1, color: 0x241a10 });
  g.ellipse(cx, cy + 6, 7.5, 4).fill(0x241a10);
  // Пламя под ступой.
  g.ellipse(cx, cy + 12, 5, 2.5).fill({ color: 0x7a4a2a, alpha: 0.9 });
  g.ellipse(cx, cy + 13, 3, 1.6).fill({ color: 0xc97a3a, alpha: 0.95 });
  // Ведьма: платок и серый плащ.
  g.circle(cx, cy - 3, 6).fill(0x8a8f98).stroke({ width: 0.8, color: 0x4a4e55 });
  g.circle(cx, cy - 3.4, 4.4).fill(0xd8cfc0);
  g.poly([cx - 6.5, cy - 2, cx + 6.5, cy - 2, cx + 4.5, cy + 6, cx - 4.5, cy + 6]).fill(0x5a5f68);
  // Платок-узел.
  g.circle(cx, cy - 8.6, 2).fill(0x8a4a3a);
  // Крючковатый нос.
  g.poly([cx + 3.4, cy - 4.6, cx + 6, cy - 3.2, cx + 3.4, cy - 2.4]).fill(0xd8cfc0);
  // Метла за спиной.
  g.moveTo(cx + 7, cy + 4).lineTo(cx + 13, cy - 2).stroke({ width: 1.4, color: 0x6b4f2a });
  g.poly([cx + 11, cy - 1, cx + 16, cy - 4, cx + 13, cy + 1]).fill(0xa08050);
  // Изумрудное свечение зелья.
  g.circle(cx - 4, cy + 2.4, 1.8).fill({ color: 0x5fd6a8, alpha: 0.9 });
}

/** Соловей-Разбойник: разбойник с луком и свитком (0.18.0). */
function drawSolovey({ g, cx, cy }: TokenCtx): void {
  // Плащ разбойника.
  g.poly([cx - 9, cy - 4, cx + 9, cy - 4, cx + 7, cy + 11, cx - 7, cy + 11]).fill(0x4a4a3a).stroke({ width: 0.8, color: 0x2c2c22 });
  // Голова с шапкой.
  g.circle(cx, cy - 6, 5.5).fill(0xd8c9a8);
  g.poly([cx - 6, cy - 9, cx + 6, cy - 9, cx + 4, cy - 4, cx - 4, cy - 4]).fill(0x8a2a2a);
  // Борода.
  g.poly([cx - 3.4, cy - 3, cx + 3.4, cy - 3, cx, cy + 2.4]).fill(0x6b5b48);
  // Лук в руке.
  g.moveTo(cx + 8, cy - 2).quadraticCurveTo(cx + 14, cy + 2, cx + 8, cy + 7).stroke({ width: 1.4, color: 0x8a6a3a });
  g.moveTo(cx + 8, cy - 2).lineTo(cx + 8, cy + 7).stroke({ width: 0.6, color: 0xd8cfc0 });
  // Свисток у пояса (золотой).
  g.circle(cx - 2, cy + 7, 2).fill(0xd9b64a).stroke({ width: 0.6, color: 0x8a6f2a });
}

const CLASS_ART: Partial<Record<string, (ctx: TokenCtx) => void>> = {
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

const FALLBACK_ART: Record<"druzhina" | "nav", number> = { druzhina: 0xc9a24b, nav: 0x6d9a3a };

/** Деревянная завала-укрытие: полубрус (1) или высокий сруб (2). */
/** Смещение для граневых укрытий: N=0, E=1, S=2, W=3. */
const EDGE_OFFSET: [number, number][] = [[0, -14], [14, 0], [0, 14], [-14, 0]];
const C = CELL_SIZE;
const HALF = C / 2;

/**
 * Граневое укрытие: бревна вдоль всей грани клетки.
 * N/S — горизонтальные, E/W — вертикальные.
 */
function drawEdgeCover(
  g: Graphics,
  cx: number,
  cy: number,
  coverType: 1 | 2,
  edge: 0 | 1 | 2 | 3,
): void {
  const isHorizontal = edge === 0 || edge === 2;
  const length = C - 4; // длина бревна (чуть меньше клетки)
  const thick = coverType === 2 ? 10 : 6; // толщина
  const logColor = coverType === 2 ? 0x7a5a32 : 0xa08050;
  const logStroke = coverType === 2 ? 0x3a2a18 : 0x5a4a38;
  const endColor = coverType === 2 ? 0xb28a58 : 0xc4a870;
  const endStroke = 0x4a3a28;
  const endDot = 0x6b4f2a;

  // Позиция: на грани клетки.
  let bx: number, by: number, bw: number, bh: number;
  if (edge === 0) { bx = cx - HALF + 2; by = cy - HALF - thick / 2; bw = length; bh = thick; }
  else if (edge === 2) { bx = cx - HALF + 2; by = cy + HALF - thick / 2; bw = length; bh = thick; }
  else if (edge === 1) { bx = cx + HALF - thick / 2; by = cy - HALF + 2; bw = thick; bh = length; }
  else { bx = cx - HALF - thick / 2; by = cy - HALF + 2; bw = thick; bh = length; }

  if (isHorizontal) {
    // Горизонтальное бревно.
    g.roundRect(bx, by, bw, bh, thick / 3).fill(logColor);
    g.roundRect(bx, by, bw, bh, thick / 3).stroke({ width: 0.8, color: logStroke });
    // Торцы (кругляши).
    const er = thick / 2 - 0.5;
    g.circle(bx + er + 0.5, by + thick / 2, er).fill(endColor);
    g.circle(bx + er + 0.5, by + thick / 2, er).stroke({ width: 0.6, color: endStroke });
    g.circle(bx + er + 0.5, by + thick / 2, er).fill(endDot);
    g.circle(bx + bw - er - 0.5, by + thick / 2, er).fill(endColor);
    g.circle(bx + bw - er - 0.5, by + thick / 2, er).stroke({ width: 0.6, color: endStroke });
    g.circle(bx + bw - er - 0.5, by + thick / 2, er).fill(endDot);
    // Второе бревно для полного укрытия.
    if (coverType === 2) {
      const by2 = edge === 0 ? by - thick + 1 : by + thick - 1;
      g.roundRect(bx, by2, bw, bh, thick / 3).fill(logColor);
      g.roundRect(bx, by2, bw, bh, thick / 3).stroke({ width: 0.8, color: logStroke });
      g.circle(bx + er + 0.5, by2 + thick / 2, er).fill(endColor);
      g.circle(bx + er + 0.5, by2 + thick / 2, er).stroke({ width: 0.6, color: endStroke });
      g.circle(bx + bw - er - 0.5, by2 + thick / 2, er).fill(endColor);
      g.circle(bx + bw - er - 0.5, by2 + thick / 2, er).stroke({ width: 0.6, color: endStroke });
    }
  } else {
    // Вертикальное бревно.
    g.roundRect(bx, by, bw, bh, thick / 3).fill(logColor);
    g.roundRect(bx, by, bw, bh, thick / 3).stroke({ width: 0.8, color: logStroke });
    const er = thick / 2 - 0.5;
    g.circle(bx + thick / 2, by + er + 0.5, er).fill(endColor);
    g.circle(bx + thick / 2, by + er + 0.5, er).stroke({ width: 0.6, color: endStroke });
    g.circle(bx + thick / 2, by + er + 0.5, er).fill(endDot);
    g.circle(bx + thick / 2, by + bh - er - 0.5, er).fill(endColor);
    g.circle(bx + thick / 2, by + bh - er - 0.5, er).stroke({ width: 0.6, color: endStroke });
    g.circle(bx + thick / 2, by + bh - er - 0.5, er).fill(endDot);
    if (coverType === 2) {
      const bx2 = edge === 1 ? bx + thick - 1 : bx - thick + 1;
      g.roundRect(bx2, by, bw, bh, thick / 3).fill(logColor);
      g.roundRect(bx2, by, bw, bh, thick / 3).stroke({ width: 0.8, color: logStroke });
      g.circle(bx2 + thick / 2, by + er + 0.5, er).fill(endColor);
      g.circle(bx2 + thick / 2, by + er + 0.5, er).stroke({ width: 0.6, color: endStroke });
      g.circle(bx2 + thick / 2, by + bh - er - 0.5, er).fill(endColor);
      g.circle(bx2 + thick / 2, by + bh - er - 0.5, er).stroke({ width: 0.6, color: endStroke });
    }
  }
}

function drawCover(
  g: Graphics,
  cx: number,
  cy: number,
  coverType: 1 | 2,
  edge?: 0 | 1 | 2 | 3,
): void {
  if (edge !== undefined) {
    drawEdgeCover(g, cx, cy, coverType, edge);
    return;
  }
  // Целоклеточное укрытие.
  const px = cx;
  const py = cy;
  g.ellipse(px, py + 11, 15, 4.5).fill({ color: 0x000000, alpha: 0.3 });

  if (coverType === 1) {
    const ly = py + 4;
    g.roundRect(px - 11, ly - 3.5, 22, 7, 3.5).fill(0xa08050);
    g.roundRect(px - 11, ly - 3.5, 22, 7, 3.5).stroke({ width: 0.8, color: 0x4a3a28 });
    g.circle(px - 8, ly, 2.5).fill(0xc4a870);
    g.circle(px - 8, ly, 2.5).stroke({ width: 0.6, color: 0x4a3a28 });
    g.circle(px - 8, ly, 0.9).fill(0x6b4f2a);
    g.roundRect(px - 9, ly - 6, 18, 3.5, 1.8).fill(0xb89060);
    g.roundRect(px - 9, ly - 6, 18, 3.5, 1.8).stroke({ width: 0.6, color: 0x4a3a28 });
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
function drawShieldIcon(
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
  if (edge === 0) { sx = cx; sy = cy - HALF + inset + shieldH / 2; }
  else if (edge === 2) { sx = cx; sy = cy + HALF - inset - shieldH / 2; }
  else if (edge === 1) { sx = cx + HALF - inset - shieldW / 2; sy = cy; }
  else { sx = cx - HALF + inset + shieldW / 2; sy = cy; }

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
  g.moveTo(sx, top + 2).lineTo(sx, bot - 2).stroke({ width: 0.8, color: 0xffffff, alpha: alpha * 0.5 });
  g.moveTo(sx - hw + 2, sy - 1).lineTo(sx + hw - 2, sy - 1).stroke({ width: 0.8, color: 0xffffff, alpha: alpha * 0.5 });
}

/** Могильная отметина павшего: камешки и череп. */
function drawFallen(g: Graphics, cx: number, cy: number): void {
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

/* ---------- эффекты ---------- */

type Fx =
  | { kind: "windup"; x: number; y: number; start: number; warm: boolean }
  | { kind: "flash"; x: number; y: number; start: number; crit: boolean; miss: boolean; angle: number }
  | { kind: "bolt"; x0: number; y0: number; x1: number; y1: number; start: number; dur: number; warm: boolean }
  | { kind: "poof"; x: number; y: number; start: number }
  | { kind: "extract"; x: number; y: number; start: number }
  | { kind: "skill"; x0: number; y0: number; x1: number; y1: number; start: number; dur: number; style: string; success: boolean }
  | { kind: "status"; x: number; y: number; start: number; status: string; applied: boolean };

interface DisplayState {
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

const BOLT_MS_PER_CELL = 30;

export function createFieldRenderer(): FieldRenderer {
  const app = new Application();
  const world = new Container();
  // Terrain is immutable for a generated map and remains outside dynamic overlays.
  const terrain = new Container();
  const fxLayer = new Graphics();
  const debugLayer = new Container();
  world.addChild(terrain, fxLayer, debugLayer);
  world.eventMode = "static";
  world.hitArea = new Rectangle(-4000, -4000, 12000, 12000);

  let destroyed = false;
  let mounted = false;
  let view: FieldView | null = null;
  let onActivate: ((x: number, y: number) => void) | null = null;
  let onHover: ((x: number, y: number) => void) | null = null;
  let userMoved = false;
  let animFrame = 0;

  const display = new Map<number, DisplayState>();
  const lunges = new Map<number, { dx: number; dy: number }>();
  const bumps = new Map<number, { dx: number; dy: number }>();
  const dying = new Map<number, number>();
  const flashes = new Map<number, number>();
  const fxs: Fx[] = [];

  let playing = false;
  let holdDisplay = false;
  let terrainSeed: number | null = null;
  const jobs: Array<{ events: GameEvent[]; done: () => void }> = [];

  let drag = false;
  let dragged = false;
  let lastX = 0;
  let lastY = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  /* ---------- геометрия ---------- */

  const faceOf = (x: number, y: number, z: number): { fx: number; fy: number } => ({
    fx: PAD + x * CELL_SIZE,
    fy: PAD + RISE * 2 + y * CELL_SIZE - z * RISE,
  });

  const centerOf = (x: number, y: number, z: number): { cx: number; cy: number } => {
    const { fx, fy } = faceOf(x, y, z);
    return { cx: fx + CELL_SIZE / 2, cy: fy + CELL_SIZE / 2 };
  };

  const entityPixel = (entity: EntityState): { cx: number; cy: number } => {
    const shown = display.get(entity.id);
    const x = shown?.x ?? entity.x;
    const y = shown?.y ?? entity.y;
    const z = shown?.z ?? entity.z;
    const lunge = lunges.get(entity.id);
    const bump = bumps.get(entity.id);
    const { cx, cy } = centerOf(x, y, z);
    return { cx: cx + (lunge?.dx ?? 0) + (bump?.dx ?? 0), cy: cy + (lunge?.dy ?? 0) + (bump?.dy ?? 0) };
  };

  /**
   * Привязка указателя к клетке: учитывает поднятую грань и откос под ней.
   * Ряды обходятся снизу вверх — в зоне наложения видна грань южной клетки.
   */
  /**
   * Подсветка защищённых граней для сущности: проверяет соседние укрытия
   * и рисует цветную полоску на общей грани.
   */
  const drawProtectionHighlights = (g: Graphics, entity: EntityState, v: FieldView, alpha: number): void => {
    // Проверить все 4 грани клетки entity на наличие укрытий.
    const edges: { dx: number; dy: number; edge: 0 | 1 | 2 | 3 }[] = [
      { dx: 0, dy: -1, edge: 0 }, // north
      { dx: 1, dy: 0, edge: 1 },   // east
      { dx: 0, dy: 1, edge: 2 },   // south
      { dx: -1, dy: 0, edge: 3 },  // west
    ];
    for (const { dx, dy, edge } of edges) {
      const nx = entity.x + dx;
      const ny = entity.y + dy;
      let bestTier: 0 | 1 | 2 = 0;

      // Проверить укрытия-сущности в соседней клетке.
      for (const cover of v.snapshot.entities) {
        if (!cover || cover.dead || cover.coverType === 0) continue;
        if (cover.x !== nx || cover.y !== ny) continue;
        if (Math.abs(cover.z - entity.z) > 1) continue;
        // Граневое укрытие: проверить, что грань смотрит на entity.
        if (cover.edge !== undefined) {
          const oppositeEdge = (edge + 2) % 4;
          if (cover.edge !== oppositeEdge) continue;
        }
        // Эффективная ступень с учётом высоты защитника.
        const eTier = effectiveCoverTier(cover.coverType, false, entity.z, entity.z, cover.z);
        if (eTier > bestTier) bestTier = eTier;
      }

      // Проверить укрытия-сущности в самой клетке entity (edge-based).
      for (const cover of v.snapshot.entities) {
        if (!cover || cover.dead || cover.coverType === 0 || cover.edge === undefined) continue;
        if (cover.x !== entity.x || cover.y !== entity.y) continue;
        if (cover.edge !== edge) continue;
        const eTier = effectiveCoverTier(cover.coverType, false, entity.z, entity.z, cover.z);
        if (eTier > bestTier) bestTier = eTier;
      }

      // Проверить стены (blockLOS) в соседней клетке.
      const neighborTile = tileAt(v.snapshot.grid, nx, ny);
      if (neighborTile && neighborTile.blockLOS) {
        const eTier = effectiveCoverTier(0, true, entity.z, entity.z, neighborTile.z);
        if (eTier > bestTier) bestTier = eTier;
      }

      // Проверить перепад высот (terrain cover).
      if (neighborTile && !neighborTile.pit) {
        const heightDiff = neighborTile.z - entity.z;
        if (heightDiff >= 2) {
          if (2 > bestTier) bestTier = 2;
        } else if (heightDiff === 1) {
          if (1 > bestTier) bestTier = 1;
        }
      }

      if (bestTier > 0) {
        const { cx, cy } = centerOf(entity.x, entity.y, entity.z);
        drawShieldIcon(g, cx, cy, edge, bestTier as 1 | 2, alpha);
      }
    }
  };

  /**
   * Маркеры пересечения луча прицеливания с укрытиями.
   * Рисует ромб в точке пересечения луча с гранью укрытия.
   */
  const drawAimIntersections = (g: Graphics, v: FieldView): void => {
    const sel = v.snapshot.entities.find((e) => e.id === v.selectedId);
    const aim = v.snapshot.entities.find((e) => e.id === v.aimId);
    if (!sel || !aim || sel.dead || aim.dead) return;
    const a = centerOf(sel.x, sel.y, sel.z);
    const b = centerOf(aim.x, aim.y, aim.z);
    const abx = b.cx - a.cx;
    const aby = b.cy - a.cy;
    const abLen = Math.hypot(abx, aby);
    if (abLen < 1) return;

    for (const cover of v.snapshot.entities) {
      if (!cover || cover.dead || cover.coverType === 0) continue;
      // Только укрытия на пути луча.
      const cc = centerOf(cover.x, cover.y, cover.z);
      // Проекция центра укрытия на луч.
      const t = ((cc.cx - a.cx) * abx + (cc.cy - a.cy) * aby) / (abLen * abLen);
      if (t < 0.05 || t > 0.95) continue; // слишком близко к концам
      // Расстояние от центра укрытия до луча.
      const projX = a.cx + abx * t;
      const projY = a.cy + aby * t;
      const dist = Math.hypot(cc.cx - projX, cc.cy - projY);
      if (dist > CELL_SIZE * 0.8) continue; // слишком далеко от луча

      // Найти точку пересечения с гранью укрытия.
      const color = cover.coverType === 2 ? 0xe8b64c : 0x60c8ff;
      const markerSize = 4;
      // Рисуем ромб в точке проекции.
      g.moveTo(projX, projY - markerSize)
        .lineTo(projX + markerSize, projY)
        .lineTo(projX, projY + markerSize)
        .lineTo(projX - markerSize, projY)
        .closePath()
        .fill({ color, alpha: 0.8 })
        .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
    }
  };

  const cellFromLocal = (lx: number, ly: number): { x: number; y: number } | null => {
    if (!view) return null;
    const { tiles, width, height } = view.snapshot.grid;
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
  };

  const fit = (): void => {
    if (!view || userMoved || !mounted) return;
    const cols = view.snapshot.grid.width;
    const rows = view.snapshot.grid.height;
    const bw = cols * CELL_SIZE + PAD * 2;
    const bh = rows * CELL_SIZE + PAD * 2 + RISE * 4;
    const w = app.renderer.width;
    const h = app.renderer.height;
    if (w <= 0 || h <= 0) return;
    const scale = Math.min(w / bw, h / bh, 1.25);
    world.scale.set(scale);
    world.x = (w - bw * scale) / 2;
    world.y = (h - bh * scale) / 2;
  };

  /* ---------- статичный слой: рельеф ---------- */

  const drawTile = (tile: Tile): Graphics => {
    const snapshot = view?.snapshot;
    const g = new Graphics();
    const z = visualLevel(tile);
    const { fy } = faceOf(tile.x, tile.y, z);
    const tiles = snapshot?.grid.tiles ?? [];
    const C = CELL_SIZE;

    // Откосы тянутся вниз от грани до уровня южного соседа (или до основания на краю карты).
    const southLevel = neighborLevel(tiles, tile.x, tile.y + 1);
    const dropSouth = southLevel === null ? z : Math.max(0, z - southLevel);
    if (dropSouth > 0 && !tile.pit) {
      const h = dropSouth * RISE;
      const riser = Z_RISER[z] ?? 0x23291a;
      g.rect(0, C, C, h).fill(mix(riser, 0x1a140c, 0.35));
      g.rect(0, C, C, 2).fill(shade(riser, 26));
      for (let i = 0; i < dropSouth; i += 1) {
        g.rect(0, C + (i + 1) * RISE - 1.5, C, 1.5).fill({ color: 0x000000, alpha: 0.22 });
      }
      g.rect(0, C, 3, h).fill({ color: 0x000000, alpha: 0.16 });
      g.rect(C - 3, C, 3, h).fill({ color: 0x000000, alpha: 0.16 });
      // Камни-выступы на откосе.
      const stones = 1 + Math.floor(hashCell(tile.x, tile.y, 5) * 2);
      for (let i = 0; i < stones; i += 1) {
        const sx = 6 + hashCell(tile.x, tile.y, 11 + i) * (C - 14);
        const sy = C + 3 + hashCell(tile.x, tile.y, 17 + i) * Math.max(1, h - 6);
        g.circle(sx, sy, 1.3).fill(shade(riser, 30));
      }
    }

    // Грань.
    const jitter = (hashCell(tile.x, tile.y, 1) - 0.5) * 14;
    const base = tile.pit ? 0x141a12 : tile.blockLOS ? 0x3c332a : (Z_FACE[z] ?? Z_FACE[1]);
    const fill = tile.pit || tile.blockLOS ? base : shade(base, jitter);
    g.rect(0, 0, C, C).fill(fill);
    if (!tile.pit && !tile.blockLOS) {
      // Мягкий перелив: светлее к северной кромке, темнее к южной.
      g.rect(0, 0, C, 8).fill({ color: 0xffffff, alpha: 0.05 });
      g.rect(0, C - 9, C, 9).fill({ color: 0x000000, alpha: 0.08 });
    }
    g.rect(0, 0, C, C).stroke({ width: 1, color: 0x0c120c, alpha: 0.32 });

    // Тени от более высоких соседей и световые канты над низкими — для всех четырёх сторон,
    // поэтому перепад высот читается и по горизонтали, и по вертикали.
    const sides = [
      { dx: 0, dy: -1, edge: "n" as const },
      { dx: 1, dy: 0, edge: "e" as const },
      { dx: -1, dy: 0, edge: "w" as const },
      { dx: 0, dy: 1, edge: "s" as const },
    ];
    for (const side of sides) {
      const level = neighborLevel(tiles, tile.x + side.dx, tile.y + side.dy);
      if (level === null || tile.pit) continue;
      const diff = level - z;
      if (diff > 0) {
        // Скала рядом: плотная тень от соседа, ширина и сила растут с перепадом.
        const width = 5 + diff * 5;
        const steps = 3;
        for (let i = 0; i < steps; i += 1) {
          const frac = i / steps;
          const alpha = (0.3 - frac * 0.22) * Math.min(1, diff * 0.75);
          if (side.edge === "n") g.rect(0, frac * width, C, width / steps).fill({ color: 0x081008, alpha });
          if (side.edge === "s") g.rect(0, C - width + frac * width, C, width / steps).fill({ color: 0x081008, alpha });
          if (side.edge === "e") g.rect(C - width + frac * width, 0, width / steps, C).fill({ color: 0x081008, alpha });
          if (side.edge === "w") g.rect(frac * width, 0, width / steps, C).fill({ color: 0x081008, alpha });
        }
      } else if (diff < 0 && side.edge !== "s") {
        // Световой кант по кромке над обрывом (южную кромку подчёркивает откос).
        const strength = Math.min(0.4, 0.22 + -diff * 0.1);
        if (side.edge === "n") g.rect(0, 0, C, 2).fill({ color: 0xe8f0d0, alpha: strength });
        if (side.edge === "e") g.rect(C - 2, 0, 2, C).fill({ color: 0xe8f0d0, alpha: strength });
        if (side.edge === "w") g.rect(0, 0, 2, C).fill({ color: 0xe8f0d0, alpha: strength });
      }
    }
    if (dropSouth > 0 && !tile.pit) {
      g.rect(0, C - 2, C, 2).fill({ color: 0xe8f0d0, alpha: 0.3 });
    }

    // Яма: глубокий овал с краями-крошкой.
    if (tile.pit) {
      g.ellipse(C / 2, C / 2 + 1, C / 2 - 5, C / 2 - 7).fill(0x1d241a);
      g.ellipse(C / 2, C / 2 + 2, C / 2 - 8, C / 2 - 11).fill(0x11150e);
      g.ellipse(C / 2, C / 2 + 3, C / 2 - 13, C / 2 - 16).fill(0x070907);
      g.ellipse(C / 2, C / 2 - 7, C / 2 - 6, 3).fill({ color: 0x4a4437, alpha: 0.5 });
      for (let i = 0; i < 4; i += 1) {
        const a = hashCell(tile.x + i, tile.y, 23) * Math.PI * 2;
        const rx = C / 2 + Math.cos(a) * (C / 2 - 6);
        const ry = C / 2 + Math.sin(a) * (C / 2 - 8);
        g.circle(rx, ry, 1.4).fill(0x3f4a35);
      }
    }

    // Камень-глыба (блокирует обзор): валун с гранями.
    if (tile.blockLOS) {
      g.ellipse(C / 2, C - 9, 16, 5).fill({ color: 0x000000, alpha: 0.28 });
      g.poly([6, C - 12, 10, 16, 24, 8, 38, 10, 46, 18, 44, C - 10, 26, C - 6, 12, C - 8]).fill(0x7a6a56);
      g.poly([10, 16, 24, 8, 38, 10, 34, 22, 16, 24]).fill(0x94836b);
      g.poly([12, C - 8, 26, C - 6, 44, C - 10, 40, C - 16, 18, C - 14]).fill(0x584a3a);
      g.poly([6, C - 12, 10, 16, 16, 24, 12, C - 8]).fill(0x6b5b48);
      g.poly([6, C - 12, 10, 16, 24, 8, 38, 10, 46, 18, 44, C - 10, 26, C - 6, 12, C - 8]).stroke({
        width: 1,
        color: 0x35281a,
        alpha: 0.8,
      });
      g.circle(19, 14, 1.6).fill(0xb3a58e);
      g.circle(33, 16, 1.2).fill(0x6b5b48);
    }

    // Травяной декор: стабилен (хеш от координат), не портит читаемость.
    if (!tile.pit && !tile.blockLOS) {
      const blades = 1 + Math.floor(hashCell(tile.x, tile.y, 29) * 3);
      for (let i = 0; i < blades; i += 1) {
        const bx = 5 + hashCell(tile.x, tile.y, 31 + i * 2) * (C - 10);
        const by = 5 + hashCell(tile.x, tile.y, 32 + i * 2) * (C - 10);
        const lean = (hashCell(tile.x, tile.y, 41 + i) - 0.5) * 4;
        g.moveTo(bx, by)
          .lineTo(bx - 1.6 + lean, by - 4.4)
          .stroke({ width: 1.1, color: shade(fill, z === 2 ? -18 : 22) });
        g.moveTo(bx, by)
          .lineTo(bx + 1.8 + lean, by - 3.6)
          .stroke({ width: 1, color: shade(fill, z === 2 ? -10 : 30) });
      }
      if (hashCell(tile.x, tile.y, 47) > 0.82) {
        const fx0 = 8 + hashCell(tile.x, tile.y, 53) * (C - 16);
        const fy0 = 8 + hashCell(tile.x, tile.y, 59) * (C - 16);
        g.ellipse(fx0, fy0, 2.6, 1.5).fill(shade(fill, -24));
      }
      if (hashCell(tile.x, tile.y, 61) > 0.9 && z >= 1) {
        const fx0 = 7 + hashCell(tile.x, tile.y, 67) * (C - 14);
        const fy0 = 7 + hashCell(tile.x, tile.y, 71) * (C - 14);
        g.circle(fx0, fy0, 1.3).fill(0xd8ce9a);
        g.circle(fx0 + 2, fy0 + 1, 1).fill(0xc9b26a);
      }
    }

    g.position.set(PAD + tile.x * CELL_SIZE, fy);
    // Pits are holes in the ground — draw them below non-pit tiles at same Y.
    const zIdx = tile.pit ? tile.y * 100 - 5 : tile.y * 100 + z * 10;
    g.zIndex = zIdx;
    return g;
  };

  const paintStatic = (): void => {
    if (!view || destroyed || !mounted) return;
    terrain.removeChildren().forEach((child) => child.destroy());
    for (const tile of view.snapshot.grid.tiles) {
      terrain.addChild(drawTile(tile));
    }
    terrain.sortableChildren = true;
    terrainSeed = view.matchSeed;
  };

  const paintDebug = (): void => {
    debugLayer.removeChildren().forEach((child) => child.destroy());
    if (!view?.debugMovement) return;
    for (const tile of view.snapshot.grid.tiles) {
      const z = visualLevel(tile);
      const { fx, fy } = faceOf(tile.x, tile.y, z);
      // Координаты клетки (верхний левый угол).
      const coordLabel = new Text({
        text: `${tile.x},${tile.y}`,
        style: {
          fontFamily: "monospace",
          fontSize: 9,
          fill: 0xaaaaaa,
          stroke: { color: 0x000000, width: 2 },
        },
      });
      coordLabel.position.set(fx + 2, fy + 1);
      coordLabel.zIndex = 9999;
      debugLayer.addChild(coordLabel);
      // Стоимость движения (нижний правый угол).
      const reachCell = view.reachable.find((c) => c.x === tile.x && c.y === tile.y);
      if (reachCell) {
        const mpLabel = new Text({
          text: String(reachCell.mpCost),
          style: {
            fontFamily: "monospace",
            fontSize: 12,
            fontWeight: "700",
            fill: 0xf3ecdc,
            stroke: { color: 0x0c120c, width: 3 },
          },
        });
        mpLabel.anchor.set(1, 1);
        mpLabel.position.set(fx + CELL_SIZE - 3, fy + CELL_SIZE - 2);
        mpLabel.zIndex = 9999;
        debugLayer.addChild(mpLabel);
      }
    }
    debugLayer.zIndex = 9999;
  };

  /* ---------- динамический слой: фишки и эффекты ---------- */

  const drawToken = (g: Graphics, entity: EntityState): void => {
    const shown = display.get(entity.id);
    const deadNow = shown?.dead ?? entity.dead;
    if (deadNow) return;
    const { cx, cy } = entityPixel(entity);
    const dieStart = dying.get(entity.id);
    const fade = dieStart === undefined ? 1 : Math.max(0.25, 1 - ((performance.now() - dieStart) / 430) * 0.75);

    if (entity.coverType > 0) {
      drawCover(g, cx, cy, entity.coverType as 1 | 2, entity.edge);
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

    g.ellipse(cx, cy + 15, 15, 5).fill({ color: 0x000000, alpha: 0.32 * fade });
    g.circle(cx, cy, 17.5).fill(faction.ring);
    g.circle(cx, cy, 17.5).stroke({ width: 1, color: faction.ringDark });
    g.circle(cx, cy, 14.6).fill(faction.disc);

    const art = CLASS_ART[entity.configId];
    if (art) art({ g, cx, cy });
    else g.circle(cx, cy, 10).fill(FALLBACK_ART[entity.owner === 2 ? "nav" : "druzhina"]);

    const statusTime = performance.now() * 0.004;
    if (entity.poison) {
      for (let i = 0; i < 4; i += 1) {
        const angle = statusTime + (i * Math.PI * 2) / 4;
        const radius = 20 + Math.sin(statusTime * 1.7 + i) * 2;
        g.circle(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius - 2, 2.2 + (i % 2) * 0.7)
          .fill({ color: 0x78d83d, alpha: 0.8 });
        g.circle(cx + Math.cos(angle) * radius - 0.6, cy + Math.sin(angle) * radius - 2.8, 0.7)
          .fill({ color: 0xd7ff8a, alpha: 0.9 });
      }
    }
    if (entity.panic) {
      const pulse = 0.55 + Math.sin(statusTime * 2.4) * 0.25;
      g.circle(cx, cy, 22 + pulse * 3).stroke({ width: 2, color: 0xb94cff, alpha: pulse });
      g.poly([cx - 2, cy - 27, cx + 2, cy - 27, cx + 1, cy - 18, cx - 1, cy - 18]).fill(0xff5e7a);
      g.circle(cx, cy - 14.5, 1.8).fill(0xff5e7a);
    }
    if (entity.immobileTurns) {
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2;
        const x0 = cx + Math.cos(angle) * 10;
        const y0 = cy + Math.sin(angle) * 8 + 9;
        g.moveTo(x0, y0)
          .quadraticCurveTo(cx + Math.cos(angle + 0.5) * 19, cy + 14, cx + Math.cos(angle) * 24, cy + 12)
          .stroke({ width: 2, color: 0x6f8f3d, alpha: 0.9 });
      }
    }
    if (entity.hidden) {
      g.circle(cx, cy, 24).stroke({ width: 1.5, color: 0x8fd3bc, alpha: 0.5 + Math.sin(statusTime) * 0.2 });
    }
    if (entity.flying) {
      const wing = 7 + Math.sin(statusTime * 2) * 3;
      g.moveTo(cx - 13, cy - 2).quadraticCurveTo(cx - 21, cy - wing, cx - 24, cy + 2)
        .stroke({ width: 2, color: 0xbfe8ff, alpha: 0.8 });
      g.moveTo(cx + 13, cy - 2).quadraticCurveTo(cx + 21, cy - wing, cx + 24, cy + 2)
        .stroke({ width: 2, color: 0xbfe8ff, alpha: 0.8 });
    }
    if (entity.timedLife !== undefined) {
      const dots = Math.max(1, Math.min(6, entity.timedLife));
      for (let i = 0; i < dots; i += 1) {
        const angle = -Math.PI / 2 + (i / Math.max(1, dots)) * Math.PI * 2;
        g.circle(cx + Math.cos(angle) * 22, cy + Math.sin(angle) * 22, 1.8).fill(0x5fd6e8);
      }
    }
    if (entity.camouflageMinCover && view?.snapshot.entities.some((other) =>
      !other.dead && other.owner === entity.owner && other.id !== entity.id && other.providesCamouflage &&
      Math.max(Math.abs(other.x - entity.x), Math.abs(other.y - entity.y)) <= 1
    )) {
      for (let i = 0; i < 3; i += 1) {
        const angle = statusTime * 0.5 + (i * Math.PI * 2) / 3;
        g.ellipse(cx + Math.cos(angle) * 21, cy + Math.sin(angle) * 14, 3.5, 1.8).fill({ color: 0x7fb84d, alpha: 0.75 });
      }
    }

    if (fade < 1) {
      // Угасание павшего: фигура темнеет к моменту смены на могильную отметину.
      g.circle(cx, cy, 17.5).fill({ color: 0x101410, alpha: (1 - fade) * 0.85 });
    }

    // Клин взгляда по направлению (0 — север, далее по часовой).
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
      g.circle(cx, cy, 22).stroke({ width: 2.4, color: 0xaed581 });
    }

    if (flash > 0) {
      g.circle(cx, cy, 20 + (1 - flash) * 6).stroke({ width: 2.6, color: 0xf3ecdc, alpha: flash });
    }

    const hp = shown?.hp ?? entity.hp;
    const maxHp = shown?.maxHp ?? entity.maxHp;
    const ratio = Math.max(0, hp / Math.max(1, maxHp));
    g.roundRect(cx - 15, cy - 27, 30, 4.4, 2).fill({ color: 0x0a0a0a, alpha: 0.62 });
    if (ratio > 0) {
      g.roundRect(cx - 14, cy - 26, 28 * ratio, 2.6, 1.3).fill(ratio > 0.4 ? 0x6fbf4a : 0xd84a3a);
    }

    const pips = Math.max(0, entity.ap);
    for (let i = 0; i < entity.maxAp; i += 1) {
      const px0 = cx - ((entity.maxAp - 1) * 8) / 2 + i * 8;
      g.poly([px0, cy + 21.5, px0 + 2.9, cy + 24.4, px0, cy + 27.3, px0 - 2.9, cy + 24.4]).fill(
        i < pips ? 0xe8b64c : 0x3a382e,
      );
    }

    // Защитная стойка: щит-индикатор.
    if (entity.defending) {
      const sx = cx + 16;
      const sy = cy - 18;
      g.roundRect(sx - 5, sy - 6, 10, 12, 2).fill(0x388cdc);
      g.roundRect(sx - 5, sy - 6, 10, 12, 2).stroke({ width: 1.2, color: 0x8fd0ff });
      g.moveTo(sx, sy - 3).lineTo(sx, sy + 3).stroke({ width: 1.4, color: 0xf3ecdc });
      g.moveTo(sx - 2.5, sy).lineTo(sx + 2.5, sy).stroke({ width: 1.4, color: 0xf3ecdc });
    }

    // Дозор: глаз-индикатор.
    if (entity.overwatch) {
      const ox = cx - 16;
      const oy = cy - 18;
      g.circle(ox, oy, 5.5).fill({ color: 0xe8b64c, alpha: 0.9 });
      g.circle(ox, oy, 5.5).stroke({ width: 1, color: 0x57431a });
      g.circle(ox, oy, 2.2).fill(0x1c1a20);
      g.circle(ox + 0.8, oy - 0.8, 0.7).fill(0xf3ecdc);
    }
  };

  const drawFxList = (g: Graphics, now: number): void => {
    for (let i = fxs.length - 1; i >= 0; i -= 1) {
      const fx = fxs[i];
      if (!fx) continue;
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
        for (let trail = 1; trail <= 3; trail += 1) {
          const tt = Math.max(0, e - trail * 0.03);
          const tx = fx.x0 + (fx.x1 - fx.x0) * tt;
          const ty = fx.y0 + (fx.y1 - fx.y0) * tt - Math.sin(Math.PI * Math.max(0, t - trail * 0.03)) * 13;
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
            g.moveTo(fx.x1, fx.y1 + 8).quadraticCurveTo(sx, sy, fx.x1 + Math.cos(angle) * 24, fx.y1 + 14)
              .stroke({ width: 2, color: p % 2 ? primary : secondary, alpha: 1 - t * 0.7 });
          } else {
            g.circle(sx, sy, 1.5 + (p % 3) * 0.6).fill({ color: p % 2 ? primary : secondary, alpha: 1 - t });
          }
        }
        if (fx.style === "aimed_eye") {
          g.circle(fx.x1, fx.y1, 14 + t * 5).stroke({ width: 1.5, color: secondary, alpha: 1 - t });
          g.moveTo(fx.x1 - 21, fx.y1).lineTo(fx.x1 + 21, fx.y1).stroke({ width: 1, color: primary, alpha: 1 - t });
          g.moveTo(fx.x1, fx.y1 - 21).lineTo(fx.x1, fx.y1 + 21).stroke({ width: 1, color: primary, alpha: 1 - t });
        }
        if (fx.style === "whistle") {
          // «Свист» Соловья: расходящиеся звуковые кольца от источника к цели.
          const ringRadius = 4 + t * 26;
          g.circle(px, py, ringRadius).stroke({ width: 2.4, color: 0xffe0b0, alpha: (1 - t) * 0.9 });
          g.circle(px, py, ringRadius * 0.66).stroke({ width: 1.2, color: 0xfff4dd, alpha: (1 - t) * 0.7 });
          g.circle(px, py, ringRadius * 0.4).stroke({ width: 0.8, color: 0xfff4dd, alpha: (1 - t) * 0.5 });
          // Искры-ноты.
          for (let p = 0; p < 4; p += 1) {
            const noteAngle = (p / 4) * Math.PI * 2 + t * 5;
            const noteR = 6 + t * 20;
            g.circle(px + Math.cos(noteAngle) * noteR, py + Math.sin(noteAngle) * noteR * 0.7, 1.6)
              .fill({ color: 0xffe0b0, alpha: 1 - t });
          }
        }
      } else if (fx.kind === "status") {
        const t = (now - fx.start) / 520;
        if (t >= 1) {
          fxs.splice(i, 1);
          continue;
        }
        const colors: Record<string, number> = {
          POISON: 0x78d83d, PANIC: 0xb94cff, IMMOBILE: 0x709343, HIDDEN: 0x78c9b2,
          FLYING: 0x9edfff, TIMED: 0x5fd6e8, DEFENDING: 0x68aee8, OVERWATCH: 0xe8b64c,
        };
        const color = colors[fx.status] ?? 0xf3ecdc;
        const radius = 12 + t * 20;
        g.circle(fx.x, fx.y, radius).stroke({ width: fx.applied ? 2.5 : 1.5, color, alpha: 1 - t });
        for (let p = 0; p < 8; p += 1) {
          const angle = (p / 8) * Math.PI * 2;
          const direction = fx.applied ? 1 : -1;
          g.circle(fx.x + Math.cos(angle) * radius, fx.y + Math.sin(angle) * radius, 2)
            .fill({ color, alpha: (1 - t) * 0.8 * direction * direction });
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
        // Эвакуация: световой столб, поднимающиеся искры и растворяющийся силуэт (0.13.0).
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
          g.circle(fx.x + sway, fx.y - 8 - phase * 34, 1.8 * (1 - phase) + 0.6)
            .fill({ color: 0xf2dd9a, alpha: 0.9 * (1 - phase) });
        }
        g.circle(fx.x, fx.y - rise * 0.4, 9 * (1 - t * 0.6)).stroke({ width: 1.6, color: 0xe8c96a, alpha: 0.8 * (1 - t) });
      }
    }
  };

  const paintFx = (): void => {
    if (!view || destroyed || !mounted) return;
    const g = fxLayer;
    g.clear();
    const now = performance.now();

    // Movement and route previews are dynamic UI, not part of cached terrain.
    for (const cell of view.reachable) {
      const tile = tileAt(view.snapshot.grid, cell.x, cell.y);
      if (!tile) continue;
      const { fx, fy } = faceOf(tile.x, tile.y, visualLevel(tile));
      const tint = cell.apCost === 1 ? 0x388cdc : 0xe0b34a;
      g.rect(fx + 1, fy + 1, CELL_SIZE - 2, CELL_SIZE - 2).fill({ color: tint, alpha: 0.32 });
      g.rect(fx + 2.5, fy + 2.5, CELL_SIZE - 5, CELL_SIZE - 5).stroke({ width: 1.8, color: tint, alpha: 0.9 });
    }
    for (const cell of view.path) {
      const tile = tileAt(view.snapshot.grid, cell.x, cell.y);
      if (!tile) continue;
      const { fx, fy } = faceOf(tile.x, tile.y, visualLevel(tile));
      g.rect(fx + 4, fy + 4, CELL_SIZE - 8, CELL_SIZE - 8).stroke({ width: 2, color: 0xf6f2e4 });
      g.circle(fx + CELL_SIZE / 2, fy + CELL_SIZE / 2, 2.4).fill(0xf6f2e4);
    }

    // Зона эвакуации: пульсирующее свечение у края поля (0.13.0).
    // Рисуется под туманом войны: разведанные клетки зоны читаются как «выход».
    const extractPulse = 0.5 + Math.sin(now * 0.0022) * 0.25;
    for (const tile of view.snapshot.grid.tiles) {
      if (!tile.extract) continue;
      const z = visualLevel(tile);
      const { fx, fy } = faceOf(tile.x, tile.y, z);
      g.rect(fx + 2, fy + 2, CELL_SIZE - 4, CELL_SIZE - 4).fill({ color: 0xe8c96a, alpha: 0.08 + extractPulse * 0.07 });
      g.rect(fx + 2, fy + 2, CELL_SIZE - 4, CELL_SIZE - 4).stroke({ width: 1.4, color: 0xe8c96a, alpha: 0.3 + extractPulse * 0.35 });
      // Стрелка выхода по центру клетки.
      g.poly([
        fx + CELL_SIZE / 2, fy + 5,
        fx + CELL_SIZE / 2 + 4, fy + 11,
        fx + CELL_SIZE / 2 - 4, fy + 11,
      ]).fill({ color: 0xf2dd9a, alpha: 0.5 + extractPulse * 0.3 });
    }

    // Домашние края состязательного режима (0.16.0): янтарный западный край
    // стороны 1 и синий восточный край стороны 2 — зона доставки яблока.
    for (const tile of view.snapshot.grid.tiles) {
      if (tile.homeOwner === undefined) continue;
      const z = visualLevel(tile);
      const { fx, fy } = faceOf(tile.x, tile.y, z);
      const color = tile.homeOwner === 1 ? 0xe0b34a : 0x6aa9d9;
      const pulse = 0.5 + Math.sin(now * 0.0028 + tile.homeOwner) * 0.25;
      g.rect(fx + 2, fy + 2, CELL_SIZE - 4, CELL_SIZE - 4).stroke({
        width: 1.6,
        color,
        alpha: 0.25 + pulse * 0.3,
      });
      g.rect(fx + 5, fy + 5, CELL_SIZE - 10, CELL_SIZE - 10).stroke({
        width: 0.8,
        color,
        alpha: 0.12 + pulse * 0.18,
      });
    }

    // Молодильное яблоко (0.16.0): пульсирующая фишка в клетке предмета.
    const apple = view.snapshot.apple;
    if (apple) {
      const tile = view.snapshot.grid.tiles.find((candidate) => candidate.x === apple.pos.x && candidate.y === apple.pos.y);
      if (tile) {
        const z = visualLevel(tile);
        const { fx, fy } = faceOf(tile.x, tile.y, z);
        const cx = fx + CELL_SIZE / 2;
        const cy = fy + CELL_SIZE / 2 + 4;
        const pulse = 0.5 + Math.sin(now * 0.003) * 0.25;
        // Свечение.
        g.circle(cx, cy, 10 + pulse * 3).fill({ color: 0xe06a4a, alpha: 0.18 + pulse * 0.1 });
        // Тень.
        g.ellipse(cx, cy + 7, 5, 2).fill({ color: 0x000000, alpha: 0.35 });
        // Яблоко.
        g.circle(cx, cy, 5.5 + pulse * 0.5).fill(0xd94a3a).stroke({ width: 1, color: 0x8a2a1e });
        // Блик.
        g.circle(cx - 1.6, cy - 1.8, 1.6).fill({ color: 0xffe8c9, alpha: 0.85 });
        // Листик и веточка.
        g.moveTo(cx, cy - 5.5).lineTo(cx + 0.6, cy - 8).stroke({ width: 1, color: 0x6b4f2a });
        g.ellipse(cx + 3.4, cy - 8, 2.6, 1.4).fill(0x7fb84d).stroke({ width: 0.6, color: 0x4a7a2e });
      }
    }

    // Туман войны: анимированный оверлей поверх рельефа.
    if (view.visibleCells) {
      const C = CELL_SIZE;
      const slowT = now * 0.0003; // медленная анимация
      for (const tile of view.snapshot.grid.tiles) {
        const key = `${tile.x},${tile.y}`;
        const isVisible = view.visibleCells.has(key);
        const isExplored = view.exploredCells?.has(key) ?? false;
        const z = visualLevel(tile);
        const { fx, fy } = faceOf(tile.x, tile.y, z);

        if (!isVisible && !isExplored) {
          // Неразведанная клетка: полностью скрыта.
          g.rect(fx, fy, C, C).fill({ color: 0x080a0c, alpha: 1.0 });
        } else if (!isVisible && isExplored) {
          // Ранее виденная: затемнение + анимированный туман.
          g.rect(fx, fy, C, C).fill({ color: 0x0c1218, alpha: 0.6 });
          const fogSeed = tile.x * 7919 + tile.y * 6271;
          for (let i = 0; i < 3; i += 1) {
            const h1 = ((fogSeed * (i + 1) * 2654435761) >>> 0) / 4294967296;
            const h2 = (((fogSeed + 31) * (i + 7) * 2246822519) >>> 0) / 4294967296;
            const phase = slowT + h1 * 6.28;
            const drift = Math.sin(phase) * 4;
            const driftY = Math.cos(phase * 0.7 + i) * 3;
            const cx = fx + h1 * C + drift;
            const cy = fy + h2 * C + driftY;
            const fr = 10 + h1 * 16;
            const alpha = 0.05 + 0.03 * Math.sin(phase * 1.3 + i * 2.1);
            g.circle(cx, cy, fr).fill({ color: 0x8a9aaa, alpha });
          }
        }
      }
    }

    // Линия прицеливания: всегда прямая от A к Ц, меняет стиль в точке препятствия.
    const selected = view.snapshot.entities.find((entity) => entity.id === view?.selectedId);
    const aimed = view.snapshot.entities.find((entity) => entity.id === view?.aimId);
    if (selected && aimed && !selected.dead && !aimed.dead) {
      const a = entityPixel(selected);
      const b = entityPixel(aimed);
      const color = view.aimOk ? 0xe8b64c : 0xc45c5c;

      // Вычислить точку разрыва на прямой A→Ц.
      let breakRatio = 1; // 1 = нет разрыва
      if (view.aimBreakCell) {
        // Точка препятствия: центр клетки breakCell, спроецированный на прямую A→Ц.
        const breakTile = view.snapshot.grid.tiles.find((t) => t.x === view!.aimBreakCell!.x && t.y === view!.aimBreakCell!.y);
        const breakZ = visualLevel(breakTile ?? ({ pit: false, z: 0 } as Tile));
        const bc = centerOf(view.aimBreakCell.x, view.aimBreakCell.y, breakZ);
        // Проекция breakCell центра на прямую A→Ц.
        const abx = b.cx - a.cx;
        const aby = b.cy - a.cy;
        const abLen2 = abx * abx + aby * aby;
        if (abLen2 > 1) {
          const t = Math.max(0, Math.min(1, ((bc.cx - a.cx) * abx + (bc.cy - a.cy) * aby) / abLen2));
          breakRatio = t;
        }
      }

      if (breakRatio < 1) {
        // Точка разрыва на прямой.
        const bx = a.cx + (b.cx - a.cx) * breakRatio;
        const by = a.cy + (b.cy - a.cy) * breakRatio;
        // Сплошная часть.
        g.moveTo(a.cx, a.cy).lineTo(bx, by).stroke({ width: 2, color, alpha: 0.85 });
        // Пунктирная часть от разрыва до цели.
        const dx = b.cx - bx;
        const dy = b.cy - by;
        const len = Math.hypot(dx, dy);
        const dashLen = 6;
        const gapLen = 5;
        const steps = Math.max(1, Math.floor(len / (dashLen + gapLen)));
        const ux = dx / (len || 1);
        const uy = dy / (len || 1);
        let pos = 0;
        for (let i = 0; i < steps; i += 1) {
          const x0 = bx + ux * pos;
          const y0 = by + uy * pos;
          pos += dashLen;
          const x1 = bx + ux * Math.min(pos, len);
          const y1 = by + uy * Math.min(pos, len);
          g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.5, color, alpha: 0.4 });
          pos += gapLen;
          if (pos >= len) break;
        }
      } else {
        g.moveTo(a.cx, a.cy).lineTo(b.cx, b.cy).stroke({ width: 2, color, alpha: 0.85 });
      }

      if (view.heightMod !== 0) {
        const mx = (a.cx + b.cx) / 2;
        const my = (a.cy + b.cy) / 2;
        const dir = view.heightMod === 1 ? -1 : 1;
        g.poly([mx, my + dir * 11, mx - 6, my + dir * 2, mx + 6, my + dir * 2]).fill(color);
      }
    }

    const drawOrder = [...view.snapshot.entities].sort((a, b) => {
      const pa = entityPixel(a);
      const pb = entityPixel(b);
      return pa.cy - pb.cy || a.id - b.id;
    });
    for (const entity of drawOrder) {
      // Туман войны: скрывать чужие сущности вне зоны видимости.
      if (view.visibleCells && entity.owner !== 1 && entity.coverType === 0) {
        const key = `${entity.x},${entity.y}`;
        if (!view.visibleCells.has(key)) continue;
      }
      // Скрывать укрытия вне зоны видимости.
      if (view.visibleCells && entity.coverType > 0) {
        const key = `${entity.x},${entity.y}`;
        if (!view.visibleCells.has(key)) {
          const explored = view.exploredCells?.has(key) ?? false;
          if (!explored) continue;
        }
      }
      const shown = display.get(entity.id);
      const dead = shown?.dead ?? entity.dead;
      if (dead && entity.coverType === 0 && !dying.has(entity.id)) {
        if (entity.maxAp > 0) {
          const { cx, cy } = entityPixel(entity);
          drawFallen(g, cx, cy);
        }
        continue;
      }
      drawToken(g, entity);
    }

    // Подсветка защищённых граней выбранного персонажа.
    if (view.selectedId !== null) {
      const sel = view.snapshot.entities.find((e) => e.id === view!.selectedId);
      if (sel && !sel.dead && sel.coverType === 0) {
        drawProtectionHighlights(g, sel, view, 1.0);
      }
    }

    // Подсветка защищённых граней клетки под курсором (при перемещении).
    if (view.hoverCell) {
      const hx = view.hoverCell.x;
      const hy = view.hoverCell.y;
      const hoverEntity: EntityState = {
        x: hx, y: hy, z: view.hoverCell.z,
      } as EntityState;
      drawProtectionHighlights(g, hoverEntity, view, 0.35);
    }

    // Подсветка обучающей подсказки (0.19.0): пульсирующая рамка.
    if (view.trainingHighlight) {
      const { x, y } = view.trainingHighlight;
      const tile = view.snapshot.grid.tiles.find((candidate) => candidate.x === x && candidate.y === y);
      if (tile) {
        const z = visualLevel(tile);
        const { fx, fy } = faceOf(tile.x, tile.y, z);
        const pulse = 0.5 + Math.sin(now * 0.004) * 0.3;
        g.rect(fx + 1, fy + 1, CELL_SIZE - 2, CELL_SIZE - 2).stroke({
          width: 2.4,
          color: 0xe0b34a,
          alpha: 0.45 + pulse * 0.4,
        });
        g.rect(fx + 5, fy + 5, CELL_SIZE - 10, CELL_SIZE - 10).stroke({
          width: 1,
          color: 0xf3ecdc,
          alpha: 0.2 + pulse * 0.25,
        });
      }
    }

    // Маркеры пересечения луча прицеливания с укрытиями.
    if (view.selectedId !== null && view.aimId !== null) {
      drawAimIntersections(g, view);
    }

    drawFxList(g, now);
  };

  const paint = (): void => {
    paintFx();
  };

  /* ---------- хореография событий ---------- */

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });

  const tween = (ms: number, step: (t: number) => void): Promise<void> =>
    new Promise((resolve) => {
      const started = performance.now();
      const frame = (): void => {
        if (destroyed) {
          resolve();
          return;
        }
        const t = Math.min(1, (performance.now() - started) / ms);
        step(t);
        if (t >= 1) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

  /** Мягкий подъезд камеры к месту действия, если оно вне зоны комфорта. */
  const focusOn = async (cxw: number, cyw: number): Promise<void> => {
    if (!mounted || destroyed) return;
    const scale = world.scale.x;
    const w = app.renderer.width;
    const h = app.renderer.height;
    if (w <= 0 || h <= 0) return;
    const sx = world.x + cxw * scale;
    const sy = world.y + cyw * scale;
    const needX = sx < w * 0.26 || sx > w * 0.74;
    const needY = sy < h * 0.32 || sy > h * 0.72;
    if (!needX && !needY) return;
    const tx = world.x + (w * 0.5 - sx) * 0.6;
    const ty = world.y + (h * 0.52 - sy) * 0.6;
    const fromX = world.x;
    const fromY = world.y;
    userMoved = true;
    await tween(220, (t) => {
      const e = easeInOut(t);
      world.x = fromX + (tx - fromX) * e;
      world.y = fromY + (ty - fromY) * e;
    });
  };

  const shake = async (strength: number): Promise<void> => {
    const ox = world.x;
    const oy = world.y;
    await tween(150, (t) => {
      const amp = (1 - t) * strength;
      // Локальный шум тряски камеры: визуальный эффект не использует
      // стандартный генератор среды и не влияет на тактическое состояние.
      world.x = ox + (shakeNoise() * 2 - 1) * amp;
      world.y = oy + (shakeNoise() * 2 - 1) * amp;
    });
    world.x = ox;
    world.y = oy;
  };

  const entityById = (id: number): EntityState | undefined => view?.snapshot.entities.find((e) => e.id === id);

  const playCombat = async (event: Extract<GameEvent, { type: "COMBAT_RESOLVED" }>): Promise<void> => {
    const source = entityById(event.sourceId);
    const target = entityById(event.targetId);
    if (!source || !target) return;
    const from = entityPixel(source);
    const to = entityPixel(target);
    const miss = event.result === "MISS";
    const crit = event.result === "CRIT";
    const angle = Math.atan2(to.cy - from.cy, to.cx - from.cx);
    const warm = source.owner !== 2;

    await focusOn((from.cx + to.cx) / 2, (from.cy + to.cy) / 2);
    fxs.push({ kind: "windup", x: from.cx, y: from.cy, start: performance.now(), warm });
    // Короткая заминка-«замах», чтобы зритель успел увидеть, кто начал атаку.
    await wait(120);

    if (event.actionType === "MELEE") {
      // Выпад: нападающий влетает в цель и толкает её назад.
      const reachX = to.cx - from.cx;
      const reachY = to.cy - from.cy;
      const len = Math.max(1, Math.hypot(reachX, reachY));
      const lungeX = (reachX / len) * Math.min(19, len * 0.45);
      const lungeY = (reachY / len) * Math.min(19, len * 0.45);
      await tween(140, (t) => {
        const e = easeOut(t);
        lunges.set(event.sourceId, { dx: lungeX * e, dy: lungeY * e });
      });
      impact();
      await tween(170, (t) => {
        const e = 1 - easeOut(t);
        lunges.set(event.sourceId, { dx: lungeX * e, dy: lungeY * e });
      });
      lunges.delete(event.sourceId);
    } else {
      // Дальний бой: снаряд летит по дуге, промах уходит мимо цели.
      const sign = (event.sourceId + event.targetId) % 2 === 0 ? 1 : -1;
      const perpX = Math.cos(angle + Math.PI / 2) * sign;
      const perpY = Math.sin(angle + Math.PI / 2) * sign;
      const missDist = 15 + ((event.sourceId * 3 + event.targetId) % 3) * 4;
      const tx = miss ? to.cx + perpX * missDist : to.cx;
      const ty = miss ? to.cy + perpY * missDist : to.cy;
      const dist = Math.hypot(to.cx - from.cx, to.cy - from.cy);
      const dur = Math.min(460, 170 + (dist / CELL_SIZE) * BOLT_MS_PER_CELL);
      fxs.push({ kind: "bolt", x0: from.cx, y0: from.cy, x1: tx, y1: ty, start: performance.now(), dur, warm });
      await wait(dur);
      impact();
    }

    function impact(): void {
      if (miss) {
        fxs.push({ kind: "flash", x: to.cx, y: to.cy, start: performance.now(), crit: false, miss: true, angle });
        bumps.set(event.targetId, { dx: Math.cos(angle + Math.PI / 2) * 6, dy: Math.sin(angle + Math.PI / 2) * 6 });
        window.setTimeout(() => bumps.delete(event.targetId), 180);
        return;
      }
      fxs.push({ kind: "flash", x: to.cx, y: to.cy, start: performance.now(), crit, miss: false, angle });
      flashes.set(event.targetId, 1);
      window.setTimeout(() => flashes.delete(event.targetId), 260);
      // Попадание отбрасывает цель от нападающего; здоровье падает именно в момент удара.
      bumps.set(event.targetId, { dx: Math.cos(angle) * (crit ? 10 : 7), dy: Math.sin(angle) * (crit ? 10 : 7) });
      window.setTimeout(() => bumps.delete(event.targetId), 200);
      const shown = display.get(event.targetId);
      if (shown) shown.hp = Math.max(0, shown.hp - event.damageDealt);
      if (crit) void shake(4.5);
      else void shake(2.6);
    }
  };

  const displayPixel = (entityId: number): { cx: number; cy: number } | null => {
    const entity = entityById(entityId);
    if (entity) return entityPixel(entity);
    const shown = display.get(entityId);
    return shown ? centerOf(shown.x, shown.y, shown.z) : null;
  };

  const playSkill = async (event: Extract<GameEvent, { type: "SKILL_RESOLVED" }>): Promise<void> => {
    const from = displayPixel(event.sourceId);
    if (!from) return;
    const target = event.targetId !== undefined ? displayPixel(event.targetId) : null;
    const targetPos = event.targetPos;
    const to = targetPos ? centerOf(targetPos.x, targetPos.y, targetPos.z) : target ?? from;
    await focusOn((from.cx + to.cx) / 2, (from.cy + to.cy) / 2);
    fxs.push({ kind: "skill", x0: from.cx, y0: from.cy, x1: to.cx, y1: to.cy, start: performance.now(), dur: 560, style: event.skillId, success: event.success });
    await wait(280);
  };

  const playOne = async (event: GameEvent): Promise<void> => {
    if (event.type === "SKILL_RESOLVED") {
      await playSkill(event);
      return;
    }
    if (event.type === "STATUS_CHANGED") {
      const at = displayPixel(event.entityId);
      if (at) {
        fxs.push({ kind: "status", x: at.cx, y: at.cy, start: performance.now(), status: event.status, applied: event.applied });
        await wait(140);
      }
      return;
    }
    if (event.type === "ENTITY_SPAWNED") {
      const at = centerOf(event.entity.x, event.entity.y, event.entity.z);
      fxs.push({ kind: "skill", x0: at.cx, y0: at.cy, x1: at.cx, y1: at.cy, start: performance.now(), dur: 520, style: event.cause === "ILLUSION" ? "create_illusion" : event.cause === "RESURRECTION" ? "raise_skeleton" : "summon_forest_beast", success: true });
      await wait(260);
      return;
    }
    if (event.type === "ENTITY_REMOVED") {
      const at = displayPixel(event.entityId);
      if (at) {
        fxs.push({
          kind: event.reason === "EXTRACTED" ? "extract" : "poof",
          x: at.cx,
          y: at.cy,
          start: performance.now(),
        });
        await wait(event.reason === "EXTRACTED" ? 420 : 260);
      }
      display.delete(event.entityId);
      return;
    }
    if (event.type === "ENTITY_MOVED") {
      const moved = event.path;
      if (moved.length === 0) return;
      const shown = display.get(event.entityId);
      const first = moved[0];
      if (shown && first) {
        shown.x = first.x;
        shown.y = first.y;
        shown.z = first.z;
      }
      const entity = entityById(event.entityId);
      if (entity) {
        const mid = moved[Math.floor(moved.length / 2)];
        if (mid) {
          const { cx, cy } = centerOf(mid.x, mid.y, mid.z);
          await focusOn(cx, cy);
        }
      }
      const stepMs = event.isDash ? 58 : 76;
      for (let i = 1; i < moved.length; i += 1) {
        const a = moved[i - 1];
        const b = moved[i];
        if (!a || !b || !shown) continue;
        await tween(stepMs, (t) => {
          shown.x = a.x + (b.x - a.x) * t;
          shown.y = a.y + (b.y - a.y) * t;
          shown.z = a.z + (b.z - a.z) * t;
        });
      }
      const last = moved[moved.length - 1];
      if (last && shown) {
        shown.x = last.x;
        shown.y = last.y;
        shown.z = last.z;
      }
      return;
    }
    if (event.type === "ENTITY_DISPLACED") {
      const shown = display.get(event.entityId);
      if (shown) {
        shown.x = event.from.x;
        shown.y = event.from.y;
        shown.z = event.from.z;
        await tween(150, (t) => {
          shown.x = event.from.x + (event.to.x - event.from.x) * t;
          shown.y = event.from.y + (event.to.y - event.from.y) * t;
          shown.z = event.from.z + (event.to.z - event.from.z) * t;
        });
      }
      return;
    }
    if (event.type === "COMBAT_RESOLVED") {
      await playCombat(event);
      return;
    }
    if (event.type === "STAT_CHANGED") {
      const shown = display.get(event.entityId);
      if (shown && event.stat === "HP") {
        shown.hp = Math.min(shown.maxHp, Math.max(0, event.newValue));
      }
      return;
    }
    if (event.type === "ENTITY_DIED") {
      const shown = display.get(event.entityId);
      if (shown) shown.hp = 0;
      const entity = entityById(event.entityId);
      if (entity) {
        const { cx, cy } = entityPixel(entity);
        fxs.push({ kind: "poof", x: cx, y: cy, start: performance.now() });
        dying.set(event.entityId, performance.now());
        await wait(430);
        dying.delete(event.entityId);
      }
      if (shown) shown.dead = true;
      return;
    }
    if (event.type === "TURN_CHANGED") {
      await wait(230);
    }
  };

  const drain = async (): Promise<void> => {
    if (playing) return;
    playing = true;
    const frame = (): void => {
      paint();
      if (playing && !destroyed) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    while (jobs.length > 0) {
      const job = jobs.shift();
      if (!job) break;
      // eslint-disable-next-line no-await-in-loop
      for (const event of job.events) {
        // eslint-disable-next-line no-await-in-loop
        await playOne(event);
        if (destroyed) break;
      }
      job.done();
    }
    playing = false;
    holdDisplay = false;
    // Восстановить истинное состояние после постановки.
    if (view) {
      for (const entity of view.snapshot.entities) {
        display.set(entity.id, { x: entity.x, y: entity.y, z: entity.z, hp: entity.hp, maxHp: entity.maxHp, dead: entity.dead });
      }
    }
    lunges.clear();
    bumps.clear();
    paint();
  };

  /* ---------- ввод ---------- */

  const onDown = (event: FederatedPointerEvent): void => {
    pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const a = pts[0];
      const b = pts[1];
      if (a && b) pinch = Math.hypot(a.x - b.x, a.y - b.y);
      drag = false;
      return;
    }
    drag = true;
    dragged = false;
    lastX = event.global.x;
    lastY = event.global.y;
  };

  const onMove = (event: FederatedPointerEvent): void => {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
    }
    if (pointers.size === 2 && pinch > 0) {
      const pts = [...pointers.values()];
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      world.scale.set(Math.min(1.8, Math.max(0.55, world.scale.x * (dist / pinch))));
      pinch = dist;
      userMoved = true;
      return;
    }
    if (!drag) {
      const local = world.toLocal(event.global);
      const cell = cellFromLocal(local.x, local.y);
      if (cell) onHover?.(cell.x, cell.y);
      return;
    }
    const dx = event.global.x - lastX;
    const dy = event.global.y - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    if (dragged) {
      world.x += dx;
      world.y += dy;
      userMoved = true;
    }
    lastX = event.global.x;
    lastY = event.global.y;
  };

  const onUp = (event: FederatedPointerEvent): void => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!drag) return;
    drag = false;
    if (dragged) return;
    const local = world.toLocal(event.global);
    const cell = cellFromLocal(local.x, local.y);
    if (cell) onActivate?.(cell.x, cell.y);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    world.x -= event.deltaX;
    world.y -= event.deltaY;
    userMoved = true;
  };

  const onContext = (event: Event): void => {
    event.preventDefault();
  };

  const animLoop = (): void => {
    if (destroyed) return;
    if (!playing && view?.visibleCells) {
      paintFx();
    }
    animFrame = requestAnimationFrame(animLoop);
  };

  return {
    async mount(element) {
      if (destroyed) return;
      const common = {
        background: 0x101410,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: element,
        preferWebGLVersion: 2 as const,
      };
      try {
        await app.init({ ...common, preference: "webgl" });
      } catch {
        await app.init(common);
      }
      if (destroyed) {
        app.destroy(true);
        return;
      }
      const canvas = app.canvas;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.touchAction = "none";
      element.appendChild(canvas);
      app.stage.addChild(world);
      world.on("pointerdown", onDown);
      world.on("pointermove", onMove);
      world.on("pointerup", onUp);
      world.on("pointerupoutside", onUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", onContext);
      mounted = true;
      fit();
      paintStatic();
      paintFx();
      animFrame = requestAnimationFrame(animLoop);
    },
    update(next) {
      view = next;
      for (const entity of next.snapshot.entities) {
        const shown = display.get(entity.id);
        if (!shown || !holdDisplay) {
          display.set(entity.id, {
            x: entity.x,
            y: entity.y,
            z: entity.z,
            hp: entity.hp,
            maxHp: entity.maxHp,
            dead: entity.dead,
          });
        } else {
          shown.maxHp = entity.maxHp;
        }
      }
      // The map seed changes only when a battlefield is generated. State updates
      // redraw overlays/tokens, never the cached terrain graphics.
      if (terrainSeed !== next.matchSeed) paintStatic();
      paintDebug();
      fit();
      paint();
    },
    play(events) {
      return new Promise((done) => {
        holdDisplay = true;
        jobs.push({ events, done });
        void drain();
      });
    },
    pan(dx, dy) {
      world.x += dx;
      world.y += dy;
      userMoved = true;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(animFrame);
      jobs.length = 0;
      if (mounted) {
        world.off("pointerdown", onDown);
        world.off("pointermove", onMove);
        world.off("pointerup", onUp);
        world.off("pointerupoutside", onUp);
        try {
          app.canvas.removeEventListener("wheel", onWheel);
          app.canvas.removeEventListener("contextmenu", onContext);
        } catch {
          /* canvas already gone */
        }
      }
      try {
        app.destroy(true);
      } catch {
        /* already torn down */
      }
      mounted = false;
    },
    setOnActivate(handler) {
      onActivate = handler;
    },
    setOnHover(handler) {
      onHover = handler;
    },
  };
}
