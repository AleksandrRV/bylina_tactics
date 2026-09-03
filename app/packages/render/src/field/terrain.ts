/**
 * Рисование рельефа: отдельные тайлы, окантовка за кромкой карты,
 * отладочный слой.
 * Перенесено из field-renderer.ts без изменений.
 */

import { Graphics, Text, Container } from "pixi.js";
import type { Tile } from "@bylina/core";
import { CELL_SIZE, RISE, PAD } from "./constants.js";
import { visualLevel, neighborLevel, faceOf, centerOf } from "./geometry.js";
import { shade, mix, hashCell } from "./math.js";
import { biomeLookOf } from "../palette.js";
import { FRINGE_CELLS, fringeDecor } from "../fringe.js";
import type { FieldView } from "./types.js";

/** Нарисовать один тайл рельефа. */
export function drawTile(tile: Tile, view: FieldView | null): Graphics {
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
    const look = biomeLookOf(view?.biome);
    const riser = look.riser[z] ?? 0x23291a;
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
  const look = biomeLookOf(view?.biome);
  const jitter = (hashCell(tile.x, tile.y, 1) - 0.5) * 8;
  // Этап 3.2: два-три оттенка базовой плитки на ярус — выбор детерминированным
  // хешем координат, поле не «пестрит», но и не выглядит монолитным.
  const shadeVariant = [-11, 0, 11][Math.floor(hashCell(tile.x, tile.y, 2) * 3)] ?? 0;
  const base = tile.pit
    ? shade(look.face[0] ?? 0x141a12, -14)
    : tile.blockLOS
      ? 0x3c332a
      : shade(look.face[z] ?? look.face[1], shadeVariant);
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
    // Этап 3.2: осыпь на границе ярусов — камешки вдоль кромки обрыва
    // смягчают резкий переход.
    const pebbles = 2 + Math.floor(hashCell(tile.x, tile.y, 81) * 3);
    for (let i = 0; i < pebbles; i += 1) {
      const px = 4 + hashCell(tile.x, tile.y, 83 + i * 2) * (C - 8);
      const py = C - 2 - hashCell(tile.x, tile.y, 84 + i * 2) * 3;
      const pr = 1 + hashCell(tile.x, tile.y, 85 + i) * 1.6;
      g.circle(px, py, pr).fill(shade(look.riser[z] ?? look.riser[1], 34));
      g.circle(px, py, pr).fill({ color: 0x000000, alpha: 0.18 });
    }
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

  // Растительность и редкий декор (этапы 3.2/3.3): кустики из двух-трёх
  // замкнутых фигур вместо штрихов-травинок — читаются на расстоянии;
  // редкий декор (~3% клеток) свой у каждого биома.
  if (!tile.pit && !tile.blockLOS) {
    const bushes = 1 + Math.floor(hashCell(tile.x, tile.y, 29) * 2);
    for (let i = 0; i < bushes; i += 1) {
      const bx = 7 + hashCell(tile.x, tile.y, 31 + i * 2) * (C - 14);
      const by = 7 + hashCell(tile.x, tile.y, 32 + i * 2) * (C - 14);
      const tint = shade(fill, z === 2 ? -20 : 24);
      // Кустик: три перекрывающихся замкнутых фигуры.
      g.ellipse(bx, by, 3.4, 2.2).fill(tint);
      g.circle(bx - 2.2, by - 1.2, 1.9).fill(shade(tint, 12));
      g.circle(bx + 2.1, by - 0.8, 1.6).fill(shade(tint, -10));
    }
    // Редкий декор биома: вероятность ~3% на клетку.
    if (hashCell(tile.x, tile.y, 61) > 0.97) {
      const dx = 8 + hashCell(tile.x, tile.y, 67) * (C - 16);
      const dy = 8 + hashCell(tile.x, tile.y, 71) * (C - 16);
      const decor = look.decor;
      if (decor === "flowers") {
        // Луг: светлые цветочки (прежде здесь был частый одиночный листок).
        g.circle(dx, dy, 1.3).fill(0xd8ce9a);
        g.circle(dx + 2.4, dy + 1, 1).fill(0xc9b26a);
        g.circle(dx - 2, dy + 1.4, 0.9).fill(0xe8dcb0);
      } else if (decor === "reeds") {
        // Болото: кочка с камышинами-конусами.
        g.ellipse(dx, dy, 3.4, 1.8).fill(shade(fill, -22));
        g.poly([dx - 2, dy, dx - 1.2, dy - 7, dx - 0.4, dy]).fill(0x5d7350);
        g.poly([dx + 0.6, dy, dx + 1.6, dy - 8.5, dx + 2.6, dy]).fill(0x6d8560);
      } else if (decor === "mushrooms") {
        // Чаща: пара грибов со шляпками.
        g.rect(dx - 0.7, dy - 1, 1.4, 2.4).fill(0xd8d2c2);
        g.poly([dx - 2.6, dy - 1, dx + 2.6, dy - 1, dx, dy - 4]).fill(0xa05a3a);
        g.rect(dx + 2.6, dy + 0.4, 1.2, 2).fill(0xd8d2c2);
        g.poly([dx + 1.2, dy + 0.4, dx + 5.2, dy + 0.4, dx + 3.2, dy - 2.4]).fill(0x8a4a30);
      } else {
        // Выжженная земля: кости и черепок.
        g.roundRect(dx - 3, dy, 6, 1.2, 0.6).fill(0xcfc8b4);
        g.circle(dx - 3, dy + 0.6, 1).fill(0xcfc8b4);
        g.circle(dx + 3, dy + 0.6, 1).fill(0xbdb49c);
        g.circle(dx + 2.4, dy - 2, 1.6).fill(0xd8d2c2);
        g.circle(dx + 1.9, dy - 2.3, 0.45).fill(0x2a2a26);
        g.circle(dx + 2.9, dy - 2.3, 0.45).fill(0x2a2a26);
      }
    }
  }

  g.position.set(PAD + tile.x * CELL_SIZE, fy);
  // Pits are holes in the ground — draw them below non-pit tiles at same Y.
  const zIdx = tile.pit ? tile.y * 100 - 5 : tile.y * 100 + z * 10;
  g.zIndex = zIdx;
  return g;
}

/**
 * Окантовка рельефа за кромкой карты (0.20.40). Кадр сцены вправе выйти
 * за поле: чтобы привести объект в центр кадра, камера иногда показывает
 * пространство за кромкой. Пустая подложка холста читалась бы как обрыв
 * мира, поэтому зазор закрыт тёмной землёй биома — той же, что под
 * клетками, только темнее: опушка, из которой выбегает крыса, и край луга,
 * к которому стоит спиной герой.
 */
export function paintFringe(fringeLayer: Graphics, view: FieldView | null, destroyed: boolean, mounted: boolean): void {
  fringeLayer.clear();
  if (!view || destroyed || !mounted) return;
  const cols = view.snapshot.grid.width;
  const rows = view.snapshot.grid.height;
  const grow = CELL_SIZE * FRINGE_CELLS;
  const width = cols * CELL_SIZE + PAD * 2 + grow * 2;
  const height = rows * CELL_SIZE + PAD * 2 + RISE * 4 + grow * 2;
  const look = biomeLookOf(view.biome);
  const ground = look.face[1] ?? look.face[0];
  // Дальний край темнее: взгляд не ищет границу поля.
  fringeLayer.rect(-grow, -grow, width, height).fill({ color: mix(ground, 0x05080a, 0.66) });
  fringeLayer
    .rect(-grow * 0.4, -grow * 0.4, width - grow * 1.2, height - grow * 1.2)
    .fill({ color: mix(ground, 0x05080a, 0.42) });
  // Опушка (0.20.41): лес из которого выбегает противник, а не ровная
  // заливка. Кроны темнее подложки, подсветка крон светлее — на любой
  // из двух полос деталь читается. Порядок детерминирован, рисуется один
  // раз на карту, слоем ниже рельефа: свесы за клетку перекрыты полем.
  const canopy = mix(ground, 0x05080a, 0.8);
  const leaf = mix(ground, 0x05080a, 0.56);
  for (const item of fringeDecor(cols, rows, FRINGE_CELLS)) {
    const { cx, cy } = centerOf(item.cellX, item.cellY, 0);
    const x = cx + item.dx * CELL_SIZE;
    const y = cy + item.dy * CELL_SIZE;
    const r = item.size * CELL_SIZE;
    if (item.kind === "canopy") {
      fringeLayer.ellipse(x, y, r * 0.62, r * 0.5).fill({ color: canopy, alpha: item.alpha });
      fringeLayer
        .ellipse(x - r * 0.14, y - r * 0.18, r * 0.4, r * 0.3)
        .fill({ color: leaf, alpha: item.alpha * 0.7 });
      // Ствол виден только у самой кромки: в глубине лес сливается в тень.
      if (item.alpha > 0.45) {
        fringeLayer
          .rect(x - r * 0.05, y + r * 0.24, r * 0.1, r * 0.52)
          .fill({ color: canopy, alpha: item.alpha * 0.8 });
      }
    } else if (item.kind === "bush") {
      fringeLayer.ellipse(x, y, r * 0.58, r * 0.44).fill({ color: canopy, alpha: item.alpha });
      fringeLayer
        .ellipse(x + r * 0.24, y + r * 0.08, r * 0.34, r * 0.26)
        .fill({ color: leaf, alpha: item.alpha * 0.8 });
    } else {
      // Трава: три штриха — кромка поля не кончается обрывом.
      for (let i = -1; i <= 1; i += 1) {
        fringeLayer
          .moveTo(x + i * r * 0.24, y + r * 0.3)
          .lineTo(x + i * r * 0.34, y - r * 0.36)
          .stroke({ width: 1.6, color: leaf, alpha: item.alpha * 0.9 });
      }
    }
  }
}

/** Перерисовать статичный рельеф (вызывается при смене карты). */
export function paintStatic(
  terrainContainer: Container,
  fringeLayer: Graphics,
  view: FieldView | null,
  destroyed: boolean,
  mounted: boolean,
): number | null {
  if (!view || destroyed || !mounted) return null;
  paintFringe(fringeLayer, view, destroyed, mounted);
  terrainContainer.removeChildren().forEach((child) => child.destroy());
  for (const tile of view.snapshot.grid.tiles) {
    terrainContainer.addChild(drawTile(tile, view));
  }
  terrainContainer.sortableChildren = true;
  return view.matchSeed;
}

/** Отладочный слой: координаты и стоимость хода. */
export function paintDebug(debugLayer: Container, view: FieldView | null): void {
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
}
