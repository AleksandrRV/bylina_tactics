import { describe, expect, it } from "vitest";
import { M1_ART, RECRUIT_ART } from "../src/token-art.js";
import type { EntityState } from "@bylina/core";

/**
 * Иллюстрации фишек М1 (0.20.37). Проверяется не картинка, а её контракт:
 * функция существует, не падает, рисует в габаритах фишки и различает
 * состояния экипировки. Ниже — минимальная запись Graphics, которая только
 * протоколирует вызовы: PixiJS в тесте не нужен.
 */

interface RecordedPoint {
  x: number;
  y: number;
}

function recordingGraphics(): { g: unknown; points: RecordedPoint[] } {
  const points: RecordedPoint[] = [];
  const note = (x?: number, y?: number): void => {
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x, y });
    }
  };
  const chain = {
    fill: () => chain,
    stroke: () => chain,
    clear: () => chain,
    circle: (x: number, y: number) => (note(x, y), chain),
    ellipse: (x: number, y: number) => (note(x, y), chain),
    rect: (x: number, y: number, w: number, h: number) => (note(x, y), note(x + w, y + h), chain),
    roundRect: (x: number, y: number, w: number, h: number) => (note(x, y), note(x + w, y + h), chain),
    poly: (pts: number[]) => {
      for (let i = 0; i + 1 < pts.length; i += 2) note(pts[i], pts[i + 1]);
      return chain;
    },
    moveTo: (x: number, y: number) => (note(x, y), chain),
    lineTo: (x: number, y: number) => (note(x, y), chain),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => (note(cx, cy), note(x, y), chain),
  };
  return { g: chain as unknown, points };
}

function entity(configId: string, weaponIds?: string[]): EntityState {
  return {
    id: 1,
    configId,
    owner: configId === "forest_rat" ? 2 : 1,
    x: 1,
    y: 3,
    z: 1,
    dir: 1,
    ap: 2,
    maxAp: 2,
    mobility: 5,
    hp: 8,
    maxHp: 8,
    aim: 60,
    defense: 0,
    weaponId: weaponIds?.[0] ?? "",
    weaponIds,
    obstacle: false,
    vision: 10,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
  } as EntityState;
}

function draw(configId: string, target: EntityState, motionNow = 0) {
  const art = M1_ART[configId] ?? RECRUIT_ART[configId];
  expect(art, `нет иллюстрации для ${configId}`).toBeTruthy();
  const { g, points } = recordingGraphics();
  art!({ g: g as never, cx: 0, cy: 0, entity: target, motionNow });
  return points;
}

describe("M1 token art (0.20.37)", () => {
  it("covers the hero, the rat and the stick", () => {
    expect(Object.keys(M1_ART).sort()).toEqual(["forest_rat", "mikula_peasant", "stick"]);
  });

  it("keeps the hero inside the token footprint", () => {
    const points = draw("mikula_peasant", entity("mikula_peasant"));
    expect(points.length).toBeGreaterThan(8);
    for (const point of points) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(26);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(26);
    }
  });

  it("draws the club only once Mikula has picked it up", () => {
    const bare = draw("mikula_peasant", entity("mikula_peasant"));
    const armed = draw("mikula_peasant", entity("mikula_peasant", ["club"]));
    // Дубина добавляет примитивы: рука-хват, древко, набалдашник, сучья.
    expect(armed.length).toBeGreaterThan(bare.length);
    // И выходит вправо за корпус — оружие должно читаться в силуэте.
    expect(Math.max(...armed.map((point) => point.x))).toBeGreaterThan(Math.max(...bare.map((point) => point.x)));
  });

  it("draws the rat lower and flatter than the standing hero", () => {
    const rat = draw("forest_rat", entity("forest_rat"));
    const hero = draw("mikula_peasant", entity("mikula_peasant"));
    const extent = (points: RecordedPoint[], axis: "x" | "y"): number =>
      Math.max(...points.map((point) => Math.abs(point[axis]))) * 2;
    // Зверь приземистее человека: корпус ниже, зато вытянут в длину —
    // хвост и усы читаются как силуэт твари, а не как мелкая копия бойца.
    expect(extent(rat, "y")).toBeLessThan(extent(hero, "y"));
    for (const point of rat) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(26);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(26);
    }
  });

  it("animates the stick from the shared phase, not from the wall clock", () => {
    const frozen = draw("stick", entity("stick"), 12000);
    const moving = draw("stick", entity("stick"), 12345);
    // Одинаковое количество примитивов, но другие координаты искр: фаза
    // передана снаружи, `performance.now()` внутри art не вызывается.
    expect(moving.length).toBe(frozen.length);
    expect(JSON.stringify(moving)).not.toBe(JSON.stringify(frozen));
    for (const point of moving) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(26);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(26);
    }
  });
});

describe("образ рекрута (0.20.43)", () => {
  it("dresses the recruit and the stranded peasant alike", () => {
    const recruit = draw("recruit", entity("recruit"));
    const fedot = draw("fedot_stranded", entity("fedot_stranded"));
    // Одна иллюстрация на две записи: крестьянин М2 больше не заглушка.
    expect(recruit.length).toBeGreaterThan(8);
    expect(JSON.stringify(fedot)).toBe(JSON.stringify(recruit));
    for (const point of recruit) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(26);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(26);
    }
  });

  it("shows the boar spear in the silhouette", () => {
    const points = draw("recruit", entity("recruit"));
    // Рогатина выходит вправо и вверх за корпус — оружие читается в силуэте
    // даже на малом масштабе, как дубина у вооружённого Микулы.
    expect(Math.max(...points.map((point) => point.x))).toBeGreaterThan(12);
    expect(Math.min(...points.map((point) => point.y))).toBeLessThan(-10);
  });
});
