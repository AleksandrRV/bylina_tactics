import { describe, expect, it } from "vitest";
import {
  CAMERA_CELLS_IN_VIEW,
  CINEMATIC_OVERSCROLL,
  TRAINING_COMFORT,
  ZOOM_MAX,
  ZOOM_MIN,
  cinematicGlideOffset,
  clampCameraOffset,
  fitScale,
  needsTrainingFocus,
  trainingGlideOffset,
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

describe("cinematicGlideOffset (0.20.40)", () => {
  /**
   * Кадр сцены: цель обязана встать точно в центр кадра, даже если она у
   * самой кромки карты. Прежде сцена пользовалась подводкой обучения:
   * та держит цель чуть выше середины (под плашку наставника) и не выходит
   * за кромку поля, поэтому объект у края карты оставался у края экрана.
   */
  const screen = { width: 1280, height: 800 };
  // Крупный план: карта шире и выше экрана — обе оси можно вести.
  const camera = plane(2.5, 0, 0);

  it("puts the target exactly in the center of the frame", () => {
    const point = { x: 300, y: 260 };
    const target = cinematicGlideOffset(point, camera, screen, MAP);
    const at = worldToScreen(point, { scale: camera.scale, offset: target });
    expect(at.x).toBeCloseTo(screen.width / 2, 5);
    expect(at.y).toBeCloseTo(screen.height / 2, 5);
    // Подводка обучения держит цель выше середины — у сцены плашки нет.
    const training = trainingGlideOffset(point, camera, screen, MAP);
    expect(worldToScreen(point, { scale: camera.scale, offset: training }).y).toBeLessThan(screen.height / 2);
  });

  it("centers a target at the very edge of the map, leaving the field bounds", () => {
    // Палка М1 стоит в последней колонке: без выхода за кромку поля
    // привести её в центр невозможно — окно камеры шире расстояния
    // от клетки до края карты.
    const point = { x: 20, y: 260 };
    const target = cinematicGlideOffset(point, camera, screen, MAP);
    expect(worldToScreen(point, { scale: camera.scale, offset: target }).x).toBeCloseTo(screen.width / 2, 5);
    // Подводка обучения здесь «не доезжает»: камера упирается в границу поля.
    const training = trainingGlideOffset(point, camera, screen, MAP);
    expect(worldToScreen(point, { scale: camera.scale, offset: training }).x).toBeLessThan(screen.width / 2);
  });

  it("keeps the overscroll within the allowed share of the screen", () => {
    // Цель далеко за полем (точка вбегания крысы за кромкой карты):
    // допустимый выход за кромку ограничен половиной экрана.
    const point = { x: -400, y: 260 };
    const target = cinematicGlideOffset(point, camera, screen, MAP);
    expect(target.x).toBeCloseTo(screen.width * CINEMATIC_OVERSCROLL, 5);
    // Явный допуск сужает выход за кромку (доля ширины холста).
    const tight = cinematicGlideOffset(point, camera, screen, MAP, 0.05);
    expect(tight.x).toBeCloseTo(screen.width * 0.05, 5);
  });

  it("centers the target on the axis where the map fits the screen", () => {
    // Карта ниже экрана: ось центрируется, но цель всё равно в центре кадра,
    // а не по центру поля.
    const small = plane(1, 0, 0);
    const point = { x: 100, y: MAP.height - 10 };
    const target = cinematicGlideOffset(point, small, screen, MAP);
    const at = worldToScreen(point, { scale: small.scale, offset: target });
    expect(at.y).toBeCloseTo(screen.height / 2, 5);
  });
});

describe("clampCameraOffset (0.20.41)", () => {
  /**
   * Возврат кадра игроку: сцена ставит камеру на цель, а не на поле целиком,
   * поэтому последним движением камера прижимается к полю обычным правилом
   * боя — иначе край карты уезжает за кадр.
   */
  const screen = { width: 1280, height: 800 };

  it("centers the field when it fits the screen", () => {
    // Игровой масштаб: поле целиком влезает в окно — камера выровнена по центру.
    const camera = plane(1.25, 600, -200);
    const target = clampCameraOffset({ x: camera.offset.x, y: camera.offset.y }, camera, screen, MAP);
    expect(target.x).toBeCloseTo((screen.width - MAP.width * 1.25) / 2, 5);
    expect(target.y).toBeCloseTo((screen.height - MAP.height * 1.25) / 2, 5);
  });

  it("keeps the camera inside a field larger than the screen", () => {
    // Карта шире экрана: окно камеры обязано лежать в пределах поля.
    const camera = plane(2.5, -900, -600);
    const target = clampCameraOffset({ x: camera.offset.x, y: camera.offset.y }, camera, screen, MAP);
    expect(target.x).toBeCloseTo(screen.width - MAP.width * 2.5, 5);
    expect(target.y).toBeCloseTo(screen.height - MAP.height * 2.5, 5);
    // И в противоположную сторону: за кромку не выходит ни в одну.
    const other = clampCameraOffset({ x: 500, y: 400 }, plane(2.5, 0, 0), screen, MAP);
    expect(other.x).toBeCloseTo(0, 5);
    expect(other.y).toBeCloseTo(0, 5);
  });

  it("does not widen the cinematic frame, only returns it to the field", () => {
    // Кадр сцены смещён за кромку (цель у края поля) — прижим возвращает его.
    const camera = plane(2.5, 0, 0);
    const point = { x: 20, y: 260 };
    const shot = cinematicGlideOffset(point, camera, screen, MAP);
    const back = clampCameraOffset(shot, camera, screen, MAP);
    expect(back.x, "камера вернулась в пределы поля").not.toBeCloseTo(shot.x, 3);
    expect(back.x).toBeCloseTo(0, 5);
  });
});

describe("fitScale (0.20.43)", () => {
  /**
   * Базовый кадр: по меньшей оси экрана помещается
   * {@link CAMERA_CELLS_IN_VIEW} клеток. Прежде поле подгонялось целиком
   * («min(w/bw, h/bh, 1.25)»): на телефоне двадцать клеток влезали в экран
   * мельчайшими фишками, а крупное поле на десктопе не влезало вовсе.
   */
  const CELL = 52;
  const inView = (scale: number, screen: { width: number; height: number }): number =>
    Math.min(screen.width, screen.height) / scale / CELL;

  it("fits 11 cells along the shorter axis in landscape", () => {
    const screen = { width: 1440, height: 900 };
    expect(inView(fitScale(screen, CELL), screen)).toBeCloseTo(CAMERA_CELLS_IN_VIEW, 4);
  });

  it("fits 11 cells along the shorter axis in portrait", () => {
    // Вертикальный телефон: считаем по ширине, а не по высоте.
    const screen = { width: 390, height: 844 };
    expect(inView(fitScale(screen, CELL), screen)).toBeCloseTo(CAMERA_CELLS_IN_VIEW, 4);
    expect(fitScale(screen, CELL)).toBeCloseTo(390 / (CAMERA_CELLS_IN_VIEW * CELL), 6);
  });

  it("keeps the scale inside the zoom range", () => {
    // Огромный экран: базовый кадр не должен уходить за верхний предел
    // ручного зума — иначе игрок не смог бы приблизить поле вовсе.
    expect(fitScale({ width: 4096, height: 2160 }, CELL)).toBe(ZOOM_MAX);
    // Крошечное окно — за нижний.
    expect(fitScale({ width: 120, height: 90 }, CELL)).toBe(ZOOM_MIN);
  });

  it("degenerate screen keeps the unit scale", () => {
    expect(fitScale({ width: 0, height: 0 }, CELL)).toBe(1);
    expect(fitScale({ width: 800, height: 600 }, 0)).toBe(1);
  });

  it("gives a large field a readable base frame instead of the whole map", () => {
    // Поле 20×6 (М1) на десктопе: базовая клетка крупнее прежней, поэтому
    // двадцать колонок уже не влезают целиком — игрок пролистывает поле.
    const screen = { width: 1440, height: 900 };
    const scale = fitScale(screen, CELL);
    expect(scale).toBeGreaterThan(1.25);
    expect((20 * CELL + 52) * scale).toBeGreaterThan(screen.width);
  });
});
