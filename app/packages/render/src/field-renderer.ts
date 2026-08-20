import {
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

const CLASS_ART: Partial<Record<string, (ctx: TokenCtx) => void>> = {
  bogatyr: drawBogatyr,
  strelets: drawStrelets,
  znaharka: drawZnaharka,
  upyr: drawUpyr,
  leshy: drawLeshy,
  kikimora: drawKikimora,
};

const FALLBACK_ART: Record<"druzhina" | "nav", number> = { druzhina: 0xc9a24b, nav: 0x6d9a3a };

/** Деревянная завала-укрытие: полубрус (1) или высокий сруб (2). */
function drawCover(g: Graphics, cx: number, cy: number, coverType: 1 | 2): void {
  g.ellipse(cx, cy + 11, 15, 4.5).fill({ color: 0x000000, alpha: 0.3 });
  const logs = coverType === 2 ? 3 : 2;
  for (let i = 0; i < logs; i += 1) {
    const ly = cy + 6 - i * 6;
    g.roundRect(cx - 13, ly - 4.4, 26, 8.8, 4.2).fill(0x8a6a42);
    g.roundRect(cx - 13, ly - 4.4, 26, 8.8, 4.2).stroke({ width: 1, color: 0x3a2a18 });
    g.circle(cx - 10.6, ly, 3.1).fill(0xb28a58);
    g.circle(cx - 10.6, ly, 3.1).stroke({ width: 0.8, color: 0x3a2a18 });
    g.circle(cx - 10.6, ly, 1.1).fill(0x6b4f2a);
  }
  g.moveTo(cx + 4, cy - 9)
    .lineTo(cx + 11, cy - 14)
    .stroke({ width: 2.2, color: 0x6b4f2a });
  g.poly([cx + 11, cy - 14, cx + 9, cy - 11.6, cx + 12.4, cy - 11.4]).fill(0x3a2a18);
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
  | { kind: "poof"; x: number; y: number; start: number };

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
  const ground = new Container();
  const fxLayer = new Graphics();
  world.addChild(ground, fxLayer);
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
  let staticDirty = true;
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

    // Досягаемость и маршрут — поверх грани.
    if (view) {
      const reachCell = view.reachable.find((cell) => cell.x === tile.x && cell.y === tile.y);
      if (reachCell) {
        const tint = reachCell.apCost === 1 ? 0x388cdc : 0xe0b34a;
        g.rect(1, 1, C - 2, C - 2).fill({ color: tint, alpha: 0.32 });
        g.rect(2.5, 2.5, C - 5, C - 5).stroke({ width: 1.8, color: tint, alpha: 0.9 });
      }
      if (view.path.some((cell) => cell.x === tile.x && cell.y === tile.y)) {
        g.rect(4, 4, C - 8, C - 8).stroke({ width: 2, color: 0xf6f2e4 });
        g.circle(C / 2, C / 2, 2.4).fill(0xf6f2e4);
      }
    }

    g.position.set(PAD + tile.x * CELL_SIZE, fy);
    g.zIndex = tile.y * 100 + z * 10;
    return g;
  };

  const drawDebugLabel = (tile: Tile): Text | null => {
    if (!view?.debugMovement) return null;
    const reachCell = view.reachable.find((cell) => cell.x === tile.x && cell.y === tile.y);
    if (!reachCell) return null;
    const z = visualLevel(tile);
    const { fy } = faceOf(tile.x, tile.y, z);
    const label = new Text({
      text: String(reachCell.mpCost),
      style: {
        fontFamily: "monospace",
        fontSize: 12,
        fontWeight: "600",
        fill: 0xf3ecdc,
        stroke: { color: 0x0c120c, width: 3 },
      },
    });
    label.anchor.set(1, 1);
    label.position.set(PAD + tile.x * CELL_SIZE + CELL_SIZE - 4, fy + CELL_SIZE - 3);
    label.zIndex = tile.y * 100 + z * 10 + 5;
    return label;
  };

  const paintStatic = (): void => {
    if (!view || destroyed || !mounted) return;
    ground.removeChildren().forEach((child) => child.destroy());
    for (const tile of view.snapshot.grid.tiles) {
      ground.addChild(drawTile(tile));
      const label = drawDebugLabel(tile);
      if (label) ground.addChild(label);
    }
    ground.sortableChildren = true;
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
      drawCover(g, cx, cy, entity.coverType as 1 | 2);
      return;
    }

    const faction: FactionLook = entity.owner === 2 ? NAV : DRUZHINA;
    const flash = flashes.get(entity.id) ?? 0;

    g.ellipse(cx, cy + 15, 15, 5).fill({ color: 0x000000, alpha: 0.32 * fade });
    g.circle(cx, cy, 17.5).fill(faction.ring);
    g.circle(cx, cy, 17.5).stroke({ width: 1, color: faction.ringDark });
    g.circle(cx, cy, 14.6).fill(faction.disc);

    const art = CLASS_ART[entity.configId];
    if (art) art({ g, cx, cy });
    else g.circle(cx, cy, 10).fill(FALLBACK_ART[entity.owner === 2 ? "nav" : "druzhina"]);

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

    // Щит: защитная стойка.
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
      } else if (fx.kind === "poof") {
        const t = (now - fx.start) / 430;
        if (t >= 1) {
          fxs.splice(i, 1);
          continue;
        }
        g.circle(fx.x, fx.y - t * 12, 6 + t * 13).fill({ color: 0x2c2c28, alpha: 0.4 * (1 - t) });
        g.circle(fx.x - 4, fx.y - t * 8, 4 + t * 8).fill({ color: 0x3a3a34, alpha: 0.35 * (1 - t) });
      }
    }
  };

  const paintFx = (): void => {
    if (!view || destroyed || !mounted) return;
    const g = fxLayer;
    g.clear();
    const now = performance.now();

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

    // Линия прицеливания: сплошная до точки разрыва, затем пунктир.
    const selected = view.snapshot.entities.find((entity) => entity.id === view?.selectedId);
    const aimed = view.snapshot.entities.find((entity) => entity.id === view?.aimId);
    if (selected && aimed && !selected.dead && !aimed.dead) {
      const a = entityPixel(selected);
      const b = entityPixel(aimed);
      const color = view.aimOk ? 0xe8b64c : 0xc45c5c;

      if (view.aimBreakCell) {
        const breakTile = view.snapshot.grid.tiles.find((t) => t.x === view!.aimBreakCell!.x && t.y === view!.aimBreakCell!.y);
        const breakZ = visualLevel(breakTile ?? ({ pit: false, z: 0 } as Tile));
        const bp = centerOf(view.aimBreakCell.x, view.aimBreakCell.y, breakZ);
        // Сплошная часть до точки разрыва.
        g.moveTo(a.cx, a.cy).lineTo(bp.cx, bp.cy).stroke({ width: 2, color, alpha: 0.85 });
        // Пунктирная часть от разрыва до цели.
        const dx = b.cx - bp.cx;
        const dy = b.cy - bp.cy;
        const len = Math.hypot(dx, dy);
        const dashLen = 6;
        const gapLen = 5;
        const steps = Math.floor(len / (dashLen + gapLen));
        const ux = dx / (len || 1);
        const uy = dy / (len || 1);
        let pos = 0;
        for (let i = 0; i < steps; i += 1) {
          const x0 = bp.cx + ux * pos;
          const y0 = bp.cy + uy * pos;
          pos += dashLen;
          const x1 = bp.cx + ux * Math.min(pos, len);
          const y1 = bp.cy + uy * Math.min(pos, len);
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

    drawFxList(g, now);
  };

  const paint = (): void => {
    if (staticDirty) {
      staticDirty = false;
      paintStatic();
    }
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
      world.x = ox + (Math.random() * 2 - 1) * amp;
      world.y = oy + (Math.random() * 2 - 1) * amp;
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

  const playOne = async (event: GameEvent): Promise<void> => {
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
      staticDirty = true;
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
