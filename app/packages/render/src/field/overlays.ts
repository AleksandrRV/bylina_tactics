/**
 * Динамические подсветки поля: движение, маршрут, прицеливание, зона умения,
 * эвакуация, домашние края, яблоко, обучение, фланг.
 * Перенесено из field-renderer.ts без изменений.
 */

import { Graphics } from "pixi.js";
import { effectiveCoverTier, tileAt, type EntityState, type Tile } from "@bylina/core";
import { CELL_SIZE, PAD, RISE } from "./constants.js";
import { visualLevel, faceOf, centerOf } from "./geometry.js";
import {
  AIM_IMPOSSIBLE,
  EXTRACT_GLOW,
  EXTRACT_SPARK,
  HOME_AMBER,
  HOME_BLUE,
  MOVE_DASH_TINT,
  MOVE_STEP_TINT,
  ROUTE_MARK,
} from "../palette.js";
import { drawShieldIcon } from "./cover.js";
import type { FieldView } from "./types.js";

/**
 * Подсветка защищённых граней для сущности: проверяет соседние укрытия
 * и рисует цветную полоску на общей грани.
 */
export function drawProtectionHighlights(g: Graphics, entity: EntityState, v: FieldView, alpha: number): void {
  const edges: { dx: number; dy: number; edge: 0 | 1 | 2 | 3 }[] = [
    { dx: 0, dy: -1, edge: 0 }, // north
    { dx: 1, dy: 0, edge: 1 },  // east
    { dx: 0, dy: 1, edge: 2 },  // south
    { dx: -1, dy: 0, edge: 3 }, // west
  ];
  for (const { dx, dy, edge } of edges) {
    const nx = entity.x + dx;
    const ny = entity.y + dy;
    let bestTier: 0 | 1 | 2 = 0;

    for (const cover of v.snapshot.entities) {
      if (!cover || cover.dead || cover.coverType === 0) continue;
      if (cover.x !== nx || cover.y !== ny) continue;
      if (Math.abs(cover.z - entity.z) > 1) continue;
      if (cover.edge !== undefined) {
        const oppositeEdge = (edge + 2) % 4;
        if (cover.edge !== oppositeEdge) continue;
      }
      const eTier = effectiveCoverTier(cover.coverType, false, entity.z, entity.z, cover.z);
      if (eTier > bestTier) bestTier = eTier as 0 | 1 | 2;
    }

    for (const cover of v.snapshot.entities) {
      if (!cover || cover.dead || cover.coverType === 0 || cover.edge === undefined) continue;
      if (cover.x !== entity.x || cover.y !== entity.y) continue;
      if (cover.edge !== edge) continue;
      const eTier = effectiveCoverTier(cover.coverType, false, entity.z, entity.z, cover.z);
      if (eTier > bestTier) bestTier = eTier as 0 | 1 | 2;
    }

    const neighborTile = tileAt(v.snapshot.grid, nx, ny);
    if (neighborTile && neighborTile.blockLOS) {
      const eTier = effectiveCoverTier(0, true, entity.z, entity.z, neighborTile.z);
      if (eTier > bestTier) bestTier = eTier as 0 | 1 | 2;
    }

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
}

/**
 * Маркеры пересечения луча прицеливания с укрытиями.
 */
export function drawAimIntersections(
  g: Graphics,
  v: FieldView,
  aimOrigin: { cx: number; cy: number },
  aimedPixel: { cx: number; cy: number },
): void {
  const a = aimOrigin;
  const b = aimedPixel;
  const abx = b.cx - a.cx;
  const aby = b.cy - a.cy;
  const abLen = Math.hypot(abx, aby);
  if (abLen < 1) return;

  for (const cover of v.snapshot.entities) {
    if (!cover || cover.dead || cover.coverType === 0) continue;
    const cc = centerOf(cover.x, cover.y, cover.z);
    const t = ((cc.cx - a.cx) * abx + (cc.cy - a.cy) * aby) / (abLen * abLen);
    if (t < 0.05 || t > 0.95) continue;
    const projX = a.cx + abx * t;
    const projY = a.cy + aby * t;
    const dist = Math.hypot(cc.cx - projX, cc.cy - projY);
    if (dist > CELL_SIZE * 0.8) continue;

    const color = cover.coverType === 2 ? 0xd84a3a : 0xe0b34a;
    const markerSize = 7;
    g.moveTo(projX, projY - markerSize)
      .lineTo(projX + markerSize, projY)
      .lineTo(projX, projY + markerSize)
      .lineTo(projX - markerSize, projY)
      .closePath()
      .fill({ color, alpha: 0.8 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
  }
}

export interface OverlayCtx {
  view: FieldView;
  motionNow: number;
  aimOrigin: { cx: number; cy: number } | null;
  aimedPixel: { cx: number; cy: number } | null;
  entityPixel: (e: EntityState) => { cx: number; cy: number };
}

/** Нарисовать все оверлеи в динамическом слое. */
export function paintOverlays(g: Graphics, ctx: OverlayCtx): void {
  const { view, motionNow, entityPixel } = ctx;

  // Областной прицел (0.20.x, этап 2.6).
  if (view.areaPreview) {
    const { areaCells, warnFriendly } = view.areaPreview;
    const caster = view.snapshot.entities.find((candidate) => candidate.id === view.selectedId);
    const pulse = 0.5 + Math.sin(motionNow * 0.004) * 0.5;
    for (const cell of areaCells) {
      const tile = tileAt(view.snapshot.grid, cell.x, cell.y);
      if (!tile) continue;
      if (view.visibleCells && !view.visibleCells.has(`${cell.x},${cell.y}`)) continue;
      const { fx, fy } = faceOf(tile.x, tile.y, visualLevel(tile));
      const areaColor = 0xe07a2a;
      g.rect(fx + 2, fy + 2, CELL_SIZE - 4, CELL_SIZE - 4).fill({ color: areaColor, alpha: 0.12 + pulse * 0.06 });
      g.rect(fx + 3, fy + 3, CELL_SIZE - 6, CELL_SIZE - 6).stroke({ width: 2.2, color: areaColor, alpha: 0.72 + pulse * 0.18 });
      g.rect(fx + 7, fy + 7, CELL_SIZE - 14, CELL_SIZE - 14).stroke({ width: 0.9, color: 0xffd18a, alpha: 0.3 + pulse * 0.18 });
      const ally = caster && view.snapshot.entities.find(
        (candidate) =>
          !candidate.dead && candidate.coverType === 0 && candidate.id !== caster.id &&
          candidate.owner === caster.owner && candidate.x === cell.x && candidate.y === cell.y,
      );
      if (warnFriendly && ally) {
        g.rect(fx + 4, fy + 4, CELL_SIZE - 8, CELL_SIZE - 8)
          .fill({ color: AIM_IMPOSSIBLE, alpha: 0.1 + pulse * 0.06 })
          .stroke({ width: 2.8, color: AIM_IMPOSSIBLE, alpha: 0.86 + pulse * 0.12 });
        g.moveTo(fx + 8, fy + 8).lineTo(fx + CELL_SIZE - 8, fy + CELL_SIZE - 8).stroke({ width: 2.2, color: AIM_IMPOSSIBLE, alpha: 0.9 });
        g.moveTo(fx + CELL_SIZE - 8, fy + 8).lineTo(fx + 8, fy + CELL_SIZE - 8).stroke({ width: 2.2, color: AIM_IMPOSSIBLE, alpha: 0.9 });
        g.circle(fx + CELL_SIZE / 2, fy + CELL_SIZE / 2, 8).stroke({ width: 1.2, color: 0xffb3a8, alpha: 0.65 + pulse * 0.2 });
      }
    }
  }

  // Достижимость и маршрут.
  for (const cell of view.reachable) {
    const tile = tileAt(view.snapshot.grid, cell.x, cell.y);
    if (!tile) continue;
    const { fx, fy } = faceOf(tile.x, tile.y, visualLevel(tile));
    const tint = cell.apCost === 1 ? MOVE_STEP_TINT : MOVE_DASH_TINT;
    g.rect(fx + 1, fy + 1, CELL_SIZE - 2, CELL_SIZE - 2).fill({ color: tint, alpha: 0.32 });
    g.rect(fx + 2.5, fy + 2.5, CELL_SIZE - 5, CELL_SIZE - 5).stroke({ width: 1.8, color: tint, alpha: 0.9 });
  }
  for (const cell of view.path) {
    const tile = tileAt(view.snapshot.grid, cell.x, cell.y);
    if (!tile) continue;
    const { fx, fy } = faceOf(tile.x, tile.y, visualLevel(tile));
    g.rect(fx + 4, fy + 4, CELL_SIZE - 8, CELL_SIZE - 8).stroke({ width: 2, color: ROUTE_MARK });
    g.circle(fx + CELL_SIZE / 2, fy + CELL_SIZE / 2, 2.4).fill(ROUTE_MARK);
  }

  // Зона эвакуации.
  const extractPulse = 0.5 + Math.sin(motionNow * 0.0022) * 0.25;
  for (const tile of view.snapshot.grid.tiles) {
    if (!tile.extract) continue;
    const z = visualLevel(tile);
    const { fx, fy } = faceOf(tile.x, tile.y, z);
    g.rect(fx + 2, fy + 2, CELL_SIZE - 4, CELL_SIZE - 4).fill({ color: EXTRACT_GLOW, alpha: 0.08 + extractPulse * 0.07 });
    g.rect(fx + 2, fy + 2, CELL_SIZE - 4, CELL_SIZE - 4).stroke({ width: 1.4, color: EXTRACT_GLOW, alpha: 0.3 + extractPulse * 0.35 });
    g.poly([fx + CELL_SIZE / 2, fy + 5, fx + CELL_SIZE / 2 + 4, fy + 11, fx + CELL_SIZE / 2 - 4, fy + 11]).fill({
      color: EXTRACT_SPARK, alpha: 0.5 + extractPulse * 0.3,
    });
    const postH = 15;
    const archTop = fy - 13;
    g.roundRect(fx + 4, fy - postH + 8, 3, postH, 1.5).fill({ color: EXTRACT_GLOW, alpha: 0.5 + extractPulse * 0.3 });
    g.roundRect(fx + CELL_SIZE - 7, fy - postH + 8, 3, postH, 1.5).fill({ color: EXTRACT_GLOW, alpha: 0.5 + extractPulse * 0.3 });
    g.moveTo(fx + 5.5, archTop + 12)
      .quadraticCurveTo(fx + CELL_SIZE / 2, archTop - 5, fx + CELL_SIZE - 5.5, archTop + 12)
      .stroke({ width: 2.2, color: EXTRACT_SPARK, alpha: 0.45 + extractPulse * 0.35 });
  }

  // Домашние края.
  for (const tile of view.snapshot.grid.tiles) {
    if (tile.homeOwner === undefined) continue;
    const z = visualLevel(tile);
    const { fx, fy } = faceOf(tile.x, tile.y, z);
    const color = tile.homeOwner === 1 ? HOME_AMBER : HOME_BLUE;
    const pulse = 0.5 + Math.sin(motionNow * 0.0028 + tile.homeOwner) * 0.25;
    g.rect(fx + 2, fy + 2, CELL_SIZE - 4, CELL_SIZE - 4).stroke({ width: 1.6, color, alpha: 0.25 + pulse * 0.3 });
    g.rect(fx + 5, fy + 5, CELL_SIZE - 10, CELL_SIZE - 10).stroke({ width: 0.8, color, alpha: 0.12 + pulse * 0.18 });
  }

  // Молодильное яблоко.
  const apple = view.snapshot.apple;
  if (apple) {
    const tile = view.snapshot.grid.tiles.find(
      (candidate) => candidate.x === apple.pos.x && candidate.y === apple.pos.y,
    );
    if (tile) {
      const z = visualLevel(tile);
      const { fx, fy } = faceOf(tile.x, tile.y, z);
      const cx = fx + CELL_SIZE / 2;
      const cy = fy + CELL_SIZE / 2 + 4;
      const pulse = 0.5 + Math.sin(motionNow * 0.003) * 0.25;
      g.circle(cx, cy, 10 + pulse * 3).fill({ color: 0xe06a4a, alpha: 0.18 + pulse * 0.1 });
      g.ellipse(cx, cy + 7, 5, 2).fill({ color: 0x000000, alpha: 0.35 });
      g.circle(cx, cy, 5.5 + pulse * 0.5).fill(0xd94a3a).stroke({ width: 1, color: 0x8a2a1e });
      g.circle(cx - 1.6, cy - 1.8, 1.6).fill({ color: 0xffe8c9, alpha: 0.85 });
      g.moveTo(cx, cy - 5.5).lineTo(cx + 0.6, cy - 8).stroke({ width: 1, color: 0x6b4f2a });
      g.ellipse(cx + 3.4, cy - 8, 2.6, 1.4).fill(0x7fb84d).stroke({ width: 0.6, color: 0x4a7a2e });
    }
  }

  // Линия прицеливания.
  if (ctx.aimOrigin && ctx.aimedPixel) {
    const a = ctx.aimOrigin;
    const b = ctx.aimedPixel;
    const color = view.aimOk ? 0xe8b64c : 0xc45c5c;
    let breakRatio = 1;
    if (view.aimBreakCell) {
      const breakTile = view.snapshot.grid.tiles.find(
        (t) => t.x === view.aimBreakCell!.x && t.y === view.aimBreakCell!.y,
      );
      const breakZ = visualLevel(breakTile ?? ({ pit: false, z: 0 } as Tile));
      const bc = centerOf(view.aimBreakCell.x, view.aimBreakCell.y, breakZ);
      const abx = b.cx - a.cx;
      const aby = b.cy - a.cy;
      const abLen2 = abx * abx + aby * aby;
      if (abLen2 > 1) {
        const t = Math.max(0, Math.min(1, ((bc.cx - a.cx) * abx + (bc.cy - a.cy) * aby) / abLen2));
        breakRatio = t;
      }
    }
    g.moveTo(a.cx, a.cy).lineTo(b.cx, b.cy).stroke({ width: 7, color: 0x0a0d0a, alpha: 0.72 });
    if (breakRatio < 1) {
      const bx = a.cx + (b.cx - a.cx) * breakRatio;
      const by = a.cy + (b.cy - a.cy) * breakRatio;
      g.moveTo(a.cx, a.cy).lineTo(bx, by).stroke({ width: 3, color, alpha: 0.95 });
      const dx = b.cx - bx;
      const dy = b.cy - by;
      const len = Math.hypot(dx, dy);
      const dashLen = 10;
      const gapLen = 4;
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
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 2.5, color, alpha: 0.68 });
        pos += gapLen;
        if (pos >= len) break;
      }
    } else {
      g.moveTo(a.cx, a.cy).lineTo(b.cx, b.cy).stroke({ width: 3, color, alpha: 0.95 });
    }
    if (view.heightMod !== 0) {
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      const dir = view.heightMod === 1 ? -1 : 1;
      g.poly([mx, my + dir * 11, mx - 6, my + dir * 2, mx + 6, my + dir * 2]).fill(color);
    }
    g.circle(b.cx, b.cy, 4.2).fill({ color, alpha: 0.92 });
    g.circle(b.cx, b.cy, 7.5).stroke({ width: 1.2, color, alpha: 0.55 });
  }
}

/** Подсветка обучающего затемнения и маркера цели. */
export function paintTrainingOverlay(
  g: Graphics,
  view: FieldView,
  motionNow: number,
): void {
  if (!view.trainingFocus && !view.trainingHighlight) return;
  const highlight = view.trainingHighlight ?? null;
  const tile = highlight
    ? view.snapshot.grid.tiles.find((candidate) => candidate.x === highlight.x && candidate.y === highlight.y)
    : undefined;
  const z = tile ? visualLevel(tile) : 0;
  const cellRect = tile ? faceOf(tile.x, tile.y, z) : null;

  const dimColor = 0x060a08;
  const mapW = view.snapshot.grid.width;
  const mapH = view.snapshot.grid.height;
  const outer = {
    x0: 2,
    y0: 2,
    x1: PAD * 2 + mapW * CELL_SIZE - 2,
    y1: PAD * 2 + RISE * 2 + mapH * CELL_SIZE - 2,
  };
  const frameRects = (
    outside: { x0: number; y0: number; x1: number; y1: number },
    inside: { x0: number; y0: number; x1: number; y1: number },
    alpha: number,
  ): void => {
    if (inside.x0 >= inside.x1 || inside.y0 >= inside.y1) {
      g.rect(outside.x0, outside.y0, outside.x1 - outside.x0, outside.y1 - outside.y0).fill({ color: dimColor, alpha });
      return;
    }
    g.rect(outside.x0, outside.y0, outside.x1 - outside.x0, inside.y0 - outside.y0).fill({ color: dimColor, alpha });
    g.rect(outside.x0, inside.y1, outside.x1 - outside.x0, outside.y1 - inside.y1).fill({ color: dimColor, alpha });
    g.rect(outside.x0, inside.y0, inside.x0 - outside.x0, inside.y1 - inside.y0).fill({ color: dimColor, alpha });
    g.rect(inside.x1, inside.y0, outside.x1 - inside.x1, inside.y1 - inside.y0).fill({ color: dimColor, alpha });
  };

  if (view.trainingFocus) {
    const pulseDim = 0.5 + Math.sin(motionNow * 0.0021) * 0.04;
    const dimScale = 0.34;
    if (cellRect) {
      const clamp = (r: { x0: number; y0: number; x1: number; y1: number }) => ({
        x0: Math.max(r.x0, outer.x0), y0: Math.max(r.y0, outer.y0),
        x1: Math.min(r.x1, outer.x1), y1: Math.min(r.y1, outer.y1),
      });
      const m2 = 16; const m1 = 8;
      const hole2 = clamp({ x0: cellRect.fx - m2, y0: cellRect.fy - m2, x1: cellRect.fx + CELL_SIZE + m2, y1: cellRect.fy + CELL_SIZE + m2 });
      const hole1 = clamp({ x0: cellRect.fx - m1, y0: cellRect.fy - m1, x1: cellRect.fx + CELL_SIZE + m1, y1: cellRect.fy + CELL_SIZE + m1 });
      const hole = clamp({ x0: cellRect.fx - 2, y0: cellRect.fy - 2, x1: cellRect.fx + CELL_SIZE + 2, y1: cellRect.fy + CELL_SIZE + 2 });
      frameRects(outer, hole2, (0.5 * pulseDim + 0.14) * dimScale);
      frameRects(hole2, hole1, (0.28 * pulseDim + 0.06) * dimScale);
      frameRects(hole1, hole, 0.12 * pulseDim * dimScale);
    } else {
      frameRects(outer, { x0: outer.x1, y0: outer.y1, x1: outer.x0, y1: outer.y0 }, (0.38 * pulseDim + 0.06) * dimScale);
    }
  }

  // Яркий маркер цели указания.
  if (highlight && cellRect && tile) {
    const pulse = 0.5 + Math.sin(motionNow * 0.005) * 0.5;
    const fx = cellRect.fx;
    const fy = cellRect.fy;
    const C = CELL_SIZE;
    g.rect(fx + 2, fy + 2, C - 4, C - 4).fill({ color: 0x86e8ff, alpha: 0.08 + pulse * 0.1 });
    g.rect(fx + 1.5, fy + 1.5, C - 3, C - 3).stroke({ width: 3, color: 0x9df0ff, alpha: 0.8 + pulse * 0.2 });
    g.rect(fx - 2, fy - 2, C + 4, C + 4).stroke({ width: 2, color: 0x86e8ff, alpha: 0.28 + pulse * 0.32 });
    g.rect(fx - 5, fy - 5, C + 10, C + 10).stroke({ width: 1, color: 0x86e8ff, alpha: 0.1 + pulse * 0.2 });
    const inset = 7 + Math.round(pulse * 3);
    const arm = 9;
    const cw = 2.6;
    const corner = (cx: number, cy: number, dx: number, dy: number): void => {
      g.moveTo(cx + dx * arm, cy).lineTo(cx, cy).lineTo(cx, cy + dy * arm).stroke({ width: cw, color: 0xf4feff, alpha: 0.85 });
    };
    corner(fx + inset, fy + inset, 1, 1);
    corner(fx + C - inset, fy + inset, -1, 1);
    corner(fx + inset, fy + C - inset, 1, -1);
    corner(fx + C - inset, fy + C - inset, -1, -1);
    const bob = Math.sin(motionNow * 0.006) * 3;
    const bx = fx + C / 2;
    const by = fy - 12 - bob;
    g.poly([bx, by + 8, bx - 6, by - 2, bx + 6, by - 2]).fill({ color: 0xf4feff, alpha: 0.65 + pulse * 0.35 });
    g.poly([bx, by + 8, bx - 6, by - 2, bx + 6, by - 2]).stroke({ width: 1.2, color: 0x9df0ff, alpha: 0.9 });
    if (highlight.kind === "entity") {
      const { cx, cy } = centerOf(tile.x, tile.y, z);
      g.circle(cx, cy - 2, 21 + pulse * 3).stroke({ width: 3, color: 0x9df0ff, alpha: 0.75 + pulse * 0.25 });
      g.circle(cx, cy - 2, 26 + pulse * 4).stroke({ width: 1.4, color: 0x86e8ff, alpha: 0.25 + pulse * 0.3 });
    }
  }
}

/** Уголки-скобки охвата с фланга (этап 2.7). */
export function paintFlankIndicator(
  g: Graphics,
  view: FieldView,
  motionNow: number,
  entityPixel: (e: EntityState) => { cx: number; cy: number },
): void {
  if (!view.aimFlanked || view.aimId === null) return;
  const aimedEntity = view.snapshot.entities.find((candidate) => candidate.id === view.aimId);
  if (!aimedEntity || aimedEntity.dead || aimedEntity.coverType !== 0) return;
  const { cx, cy } = entityPixel(aimedEntity);
  const pulse = 0.5 + Math.sin(motionNow * 0.008) * 0.5;
  const r = 24 + pulse * 3;
  const arm = 8;
  const bracket = (qx: number, qy: number, sx: number, sy: number): void => {
    g.moveTo(qx - sx * arm, qy).lineTo(qx, qy).lineTo(qx, qy - sy * arm)
      .stroke({ width: 2.6, color: 0xd84a3a, alpha: 0.65 + pulse * 0.35 });
  };
  bracket(cx - r, cy - r, -1, -1);
  bracket(cx + r, cy - r, 1, -1);
  bracket(cx - r, cy + r, -1, 1);
  bracket(cx + r, cy + r, 1, 1);
  const bob = Math.sin(motionNow * 0.009) * 2;
  g.poly([cx, cy - r - 10 + bob, cx - 5, cy - r - 19 + bob, cx + 5, cy - r - 19 + bob]).fill({
    color: 0xd84a3a, alpha: 0.7 + pulse * 0.3,
  });
}
