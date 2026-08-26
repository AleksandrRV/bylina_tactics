import { describe, expect, it } from "vitest";
import {
  TRAINING_COMFORT,
  centerCameraOn,
  needsTrainingFocus,
  trainingGlideOffset,
  zoomAroundPoint,
  worldToScreen,
  type CameraPlane,
} from "../src/camera.js";

/**
 * Подводка камеры к цели обучающего указания (0.20.14): границы экрана и
 * «зона комфорта» вычисляются программно, поэтому одни правила работают на
 * десктопе и на мобильных устройствах в обеих ориентациях. Поле обучения —
 * 10×8 клеток; мировые границы как в fit() рендерера.
 */

const MAP = { width: 572, height: 516 };

const plane = (scale: number, x: number, y: number): CameraPlane => ({ scale, offset: { x, y } });

describe("camera anchors (stage 1)", () => {
  it("keeps the world point under the cursor during zoom", () => {
    const before = plane(1, 40, -20);
    const cursor = { x: 260, y: 180 };
    const after = zoomAroundPoint(cursor, before, 1.5);
    expect(after.scale).toBe(1.5);
    expect(worldToScreen({ x: (cursor.x - before.offset.x) / before.scale, y: (cursor.y - before.offset.y) / before.scale }, after)).toEqual(cursor);
  });

  it("clamps zoom to the existing range", () => {
    expect(zoomAroundPoint({ x: 0, y: 0 }, plane(1, 0, 0), 0.01).scale).toBe(0.55);
    expect(zoomAroundPoint({ x: 0, y: 0 }, plane(1, 0, 0), 100).scale).toBe(1.8);
  });

  it("centers a fighter without exposing space beyond the map", () => {
    const centered = centerCameraOn({ x: 300, y: 260 }, plane(1.2, -100, -20), { width: 390, height: 844 }, MAP);
    expect(worldToScreen({ x: 300, y: 260 }, centered).x).toBeCloseTo(195, 5);
    expect(centered.offset.x).toBeLessThanOrEqual(0);
  });
});

describe("needsTrainingFocus (0.20.14)", () => {
  it("comfort zone is a proper band widened for HUD at top and bottom", () => {
    expect(TRAINING_COMFORT.x0).toBeLessThan(TRAINING_COMFORT.x1);
    expect(TRAINING_COMFORT.y0).toBeLessThan(TRAINING_COMFORT.y1);
    // Плашка наставника сверху и панель действий снизу: вертикальные полосы
    // «некомфорта» шире горизонтальных.
    expect(TRAINING_COMFORT.y0).toBeGreaterThan(0.25);
    expect(TRAINING_COMFORT.y1).toBeLessThan(0.7);
  });

  it("desktop with the fitted centered map: mid-map target needs no glide", () => {
    // Десктоп 1280×800: fit() даёт масштаб 1.25 и центрирование.
    const camera = plane(1.25, (1280 - MAP.width * 1.25) / 2, (800 - MAP.height * 1.25) / 2);
    const screen = { width: 1280, height: 800 };
    expect(needsTrainingFocus({ x: 300, y: 260 }, camera, screen)).toBe(false);
  });

  it("portrait phone zoomed in: target near the left edge needs a glide", () => {
    // 390×844, игрок приблизил поле — карта шире экрана.
    const camera = plane(1.2, -300, 0);
    const screen = { width: 390, height: 844 };
    const at = worldToScreen({ x: 60, y: 200 }, camera);
    expect(at.x).toBeLessThan(0); // цель вообще за экраном
    expect(needsTrainingFocus({ x: 60, y: 200 }, camera, screen)).toBe(true);
  });

  it("landscape phone: target under the mentor card band needs a glide", () => {
    // 740×360: верхняя треть экрана занята плашкой наставника.
    const camera = plane(0.9, 0, -80);
    const screen = { width: 740, height: 360 };
    expect(needsTrainingFocus({ x: 300, y: 80 }, camera, screen)).toBe(true);
    // Та же цель в середине видимой зоны подводки не требует.
    expect(needsTrainingFocus({ x: 300, y: 250 }, camera, screen)).toBe(false);
  });

  it("degenerate screen or scale never requests a glide", () => {
    expect(needsTrainingFocus({ x: 0, y: 0 }, plane(1, 0, 0), { width: 0, height: 0 })).toBe(false);
    expect(needsTrainingFocus({ x: 0, y: 0 }, plane(0, 0, 0), { width: 400, height: 400 })).toBe(false);
  });
});

describe("trainingGlideOffset (0.20.14)", () => {
  it("brings an off-screen target into view on a portrait phone", () => {
    const camera = plane(1.2, -300, 0);
    const screen = { width: 390, height: 844 };
    const target = trainingGlideOffset({ x: 60, y: 200 }, camera, screen, MAP);
    const at = worldToScreen({ x: 60, y: 200 }, { scale: camera.scale, offset: target });
    // Цель видна на экране (не за краем) и по вертикали — в комфортной зоне.
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.x).toBeLessThanOrEqual(screen.width);
    expect(at.y).toBeGreaterThanOrEqual(screen.height * TRAINING_COMFORT.y0);
    expect(at.y).toBeLessThanOrEqual(screen.height * TRAINING_COMFORT.y1);
  });

  it("centers the axis when the map fits the screen (desktop no-op)", () => {
    const camera = plane(1.25, 282.5, 77.5);
    const screen = { width: 1280, height: 800 };
    const target = trainingGlideOffset({ x: 300, y: 80 }, camera, screen, MAP);
    // Поле влезает по обеим осям — камера остаётся на центрированном fit().
    expect(target.x).toBeCloseTo((screen.width - MAP.width * camera.scale) / 2, 5);
    expect(target.y).toBeCloseTo((screen.height - MAP.height * camera.scale) / 2, 5);
  });

  it("never scrolls past the map bounds (portrait phone, wide zoom)", () => {
    const screen = { width: 390, height: 844 };
    const camera = plane(1.2, -300, 0);
    const target = trainingGlideOffset({ x: 60, y: 200 }, camera, screen, MAP);
    // Ось X: карта шире экрана — окно камеры в пределах поля.
    expect(target.x).toBeLessThanOrEqual(0);
    expect(target.x).toBeGreaterThanOrEqual(screen.width - MAP.width * camera.scale);
    // Ось Y: карта ниже экрана — центрирование.
    expect(target.y).toBeCloseTo((screen.height - MAP.height * camera.scale) / 2, 5);
  });

  it("clamps the vertical axis on a landscape phone with a tall zoom", () => {
    const screen = { width: 740, height: 360 };
    const camera = plane(0.9, 0, -80);
    const target = trainingGlideOffset({ x: 300, y: 80 }, camera, screen, MAP);
    expect(target.y).toBeLessThanOrEqual(0);
    expect(target.y).toBeGreaterThanOrEqual(screen.height - MAP.height * camera.scale);
    const at = worldToScreen({ x: 300, y: 80 }, { scale: camera.scale, offset: target });
    expect(at.y).toBeGreaterThanOrEqual(0);
  });

  it("moves the camera toward the target only, keeping other geometry stable", () => {
    const screen = { width: 390, height: 700 };
    const camera = plane(1.0, -182, 40); // карта шире экрана
    const point = { x: 100, y: 300 }; // цель у левого края видимой области
    expect(needsTrainingFocus(point, camera, screen)).toBe(true);
    const target = trainingGlideOffset(point, camera, screen, MAP);
    const before = worldToScreen(point, camera);
    const after = worldToScreen(point, { scale: camera.scale, offset: target });
    expect(after.x).toBeGreaterThan(before.x); // цель придвинулась к центру
    // Цель приведена в зону комфорта — дальше мешает край карты (камера
    // не показывает пустоту за полем), но цель полностью видна.
    expect(after.x).toBeGreaterThanOrEqual(screen.width * TRAINING_COMFORT.x0);
    expect(after.x).toBeLessThanOrEqual(screen.width * TRAINING_COMFORT.x1);
  });
});
