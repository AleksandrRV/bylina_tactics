/**
 * field-renderer.ts — точка входа и композиционный корень рендерера поля.
 *
 * Публичный API не изменился. Этот файл импортирует и связывает подсистемы из ./field/*.
 */

import {
  tileAt,
  type CellPos,
  type EntityState,
  type GameEvent,
} from "@bylina/core";
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import { FRINGE_CELLS } from "./fringe.js";
import {
  cinematicGlideOffset,
  clampCameraOffset,
  fitScale,
  ZOOM_MAX,
  ZOOM_MIN,
  needsTrainingFocus,
  trainingGlideOffset,
  TRAINING_COMFORT,
  worldToScreen,
  type Point,
} from "./camera.js";
import { FADE_COLOR } from "./palette.js";

// ── Подсистемы ────────────────────────────────────────────────────────────────
export { RENDER_STATUS, CELL_SIZE, CINEMATIC_ZOOM, CINEMATIC_ZOOM_MS, CINEMATIC_SCALE_MAX, CINEMATIC_ACCENT, RUN_IN_CELLS } from "./field/constants.js";
export type { FieldView, FieldRenderer, CinematicTarget, CinematicStep, CinematicPlan } from "./field/types.js";

import { RENDER_STATUS, CELL_SIZE, RISE, PAD, FLOAT_MS, FLOAT_RISE, MAX_FLOAT_TEXTS, CINEMATIC_ZOOM, CINEMATIC_ZOOM_MS, CINEMATIC_SCALE_MAX, CINEMATIC_ACCENT, RUN_IN_CELLS } from "./field/constants.js";
import { easeOut, easeInOut, shakeNoise } from "./field/math.js";
import { visualLevel, centerOf, faceOf, cellFromLocalCoords } from "./field/geometry.js";
import { paintStatic, paintDebug } from "./field/terrain.js";
import { drawFallen } from "./field/cover.js";
import { drawToken, type DrawTokenCtx } from "./field/entities.js";
import { drawFxList } from "./field/effects.js";
import { paintFog, type FogState } from "./field/fog.js";
import { paintVignette, paintDarkness, paintCinematicAccent, paintEdgeArrow } from "./field/atmosphere.js";
import { drawProtectionHighlights, drawAimIntersections, paintOverlays, paintTrainingOverlay, paintFlankIndicator, type OverlayCtx } from "./field/overlays.js";
import { playOne } from "./field/event-player.js";
import type { EventPlayerCtx } from "./field/event-player.js";
import type { FieldView, FieldRenderer, CinematicTarget, CinematicStep, CinematicPlan, DisplayState, Fx, FloatText } from "./field/types.js";

// ── createFieldRenderer ───────────────────────────────────────────────────────

export function createFieldRenderer(): FieldRenderer {
  const app = new Application();
  const world = new Container();
  const terrain = new Container();
  const fogBaseLayer = new Graphics();
  const fogDriftLayer = new Graphics();
  const fxLayer = new Graphics();
  const glowLayer = new Graphics();
  glowLayer.blendMode = "add";
  const labelsLayer = new Container();
  const debugLayer = new Container();
  const fringeLayer = new Graphics();
  const accentLayer = new Graphics();
  world.addChild(fringeLayer, terrain, fogBaseLayer, fogDriftLayer, fxLayer, accentLayer, glowLayer, labelsLayer, debugLayer);
  const atmosphere = new Container();
  const fadeLayer = new Graphics();
  fadeLayer.zIndex = 10000;
  const darknessG = new Graphics();
  const vignetteG = new Container();
  const edgeArrowG = new Graphics();
  atmosphere.addChild(darknessG, vignetteG, edgeArrowG);
  world.eventMode = "static";
  world.hitArea = new Rectangle(-4000, -4000, 12000, 12000);

  // ── Состояние ───────────────────────────────────────────────────────────────
  let destroyed = false;
  let mounted = false;
  let view: FieldView | null = null;
  let reducedMotion = false;
  let speedScale = 1;
  let missLabel = "Промах";
  let onActivate: ((x: number, y: number) => void) | null = null;
  let onHover: ((x: number, y: number) => void) | null = null;
  let userMoved = false;
  let homeFramed = false;
  let animFrame = 0;
  let inputLocked = false;

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

  let trainingHighlightKey: string | null = null;
  let pendingTrainingFocus: Point | null = null;
  let trainingGlide = false;

  let drag = false;
  let dragged = false;
  let lastX = 0;
  let lastY = 0;
  let lastTapKey: string | null = null;
  let lastTapTime = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  let pinchCenter: Point | null = null;

  // Кинематика
  let cinematicSkip = false;
  let cinematicPlaying = false;
  let hiddenIds = new Set<number>();
  let cinematicAccent: Point | null = null;

  // Туман
  const fogState: FogState = { fogSignature: "", lastFogDriftAt: -1, prevVisibleKeys: null };

  // Всплывающие числа
  const floatTexts: FloatText[] = [];

  // ── Геометрия ───────────────────────────────────────────────────────────────

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

  const cellFromLocal = (lx: number, ly: number): { x: number; y: number } | null => {
    if (!view) return null;
    const { tiles, width, height } = view.snapshot.grid;
    return cellFromLocalCoords(lx, ly, tiles, width, height);
  };

  const mapPlane = (): { width: number; height: number } => {
    const cols = view?.snapshot.grid.width ?? 0;
    const rows = view?.snapshot.grid.height ?? 0;
    return { width: cols * CELL_SIZE + PAD * 2, height: rows * CELL_SIZE + PAD * 2 + RISE * 4 };
  };

  /** Мировая точка центра клетки-цели обучающего указания. */
  const trainingHighlightPoint = (highlight: NonNullable<FieldView["trainingHighlight"]>): Point | null => {
    if (!view) return null;
    const tile = view.snapshot.grid.tiles.find(
      (candidate) => candidate.x === highlight.x && candidate.y === highlight.y,
    );
    if (!tile) return null;
    const { cx, cy } = centerOf(tile.x, tile.y, visualLevel(tile));
    return { x: cx, y: cy };
  };

  /** Начало луча прицеливания: обычно центр бойца, при рывке — клетка подхода. */
  const aimOriginOf = (v: FieldView, fallback: EntityState): { cx: number; cy: number } => {
    if (v.aimFrom) {
      const tile = tileAt(v.snapshot.grid, v.aimFrom.x, v.aimFrom.y);
      return centerOf(v.aimFrom.x, v.aimFrom.y, visualLevel(tile ?? ({ pit: false, z: v.aimFrom.z } as any)));
    }
    return entityPixel(fallback);
  };

  // ── Камера ──────────────────────────────────────────────────────────────────

  const homePoint = (): Point | null => {
    const owner = view?.homeOwner;
    if (owner === undefined || !view) return null;
    let sumX = 0, sumY = 0, count = 0;
    for (const entity of view.snapshot.entities) {
      if (entity.dead || entity.owner !== owner || entity.coverType !== 0) continue;
      const tile = view.snapshot.grid.tiles.find((c) => c.x === entity.x && c.y === entity.y);
      const { cx, cy } = centerOf(entity.x, entity.y, tile ? visualLevel(tile) : entity.z);
      sumX += cx; sumY += cy; count += 1;
    }
    return count > 0 ? { x: sumX / count, y: sumY / count } : null;
  };

  const fit = (): void => {
    if (!view || userMoved || !mounted) return;
    const w = app.renderer.width;
    const h = app.renderer.height;
    if (w <= 0 || h <= 0) return;
    const scale = fitScale({ width: w, height: h }, CELL_SIZE);
    world.scale.set(scale);
    if (homeFramed) return;
    const home = homePoint();
    if (!home) return;
    const offset = clampCameraOffset(
      { x: w / 2 - home.x * scale, y: h / 2 - home.y * scale },
      { scale, offset: { x: 0, y: 0 } },
      { width: w, height: h },
      mapPlane(),
    );
    world.x = offset.x;
    world.y = offset.y;
    homeFramed = true;
  };

  // ── Анимационные примитивы ──────────────────────────────────────────────────

  const wait = (ms: number): Promise<void> => {
    if (reducedMotion || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => { window.setTimeout(resolve, ms / speedScale); });
  };

  const tween = (ms: number, step: (t: number) => void): Promise<void> =>
    new Promise((resolve) => {
      if (reducedMotion || ms <= 0) { step(1); resolve(); return; }
      const started = performance.now();
      const duration = ms / speedScale;
      const frame = (): void => {
        if (destroyed) { resolve(); return; }
        const t = Math.min(1, (performance.now() - started) / duration);
        step(t);
        if (t >= 1) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

  const focusOn = async (cxw: number, cyw: number): Promise<void> => {
    if (!mounted || destroyed) return;
    const scale = world.scale.x;
    const w = app.renderer.width;
    const h = app.renderer.height;
    if (w <= 0 || h <= 0) return;
    const sx = world.x + cxw * scale;
    const sy = world.y + cyw * scale;
    const needX = sx < w * TRAINING_COMFORT.x0 || sx > w * TRAINING_COMFORT.x1;
    const needY = sy < h * TRAINING_COMFORT.y0 || sy > h * TRAINING_COMFORT.y1;
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

  const glideToTrainingTarget = async (point: Point): Promise<void> => {
    if (!mounted || destroyed) return;
    const screen = { width: app.renderer.width, height: app.renderer.height };
    if (screen.width <= 0 || screen.height <= 0) return;
    const plane = { scale: world.scale.x, offset: { x: world.x, y: world.y } };
    const target = trainingGlideOffset(point, plane, screen, mapPlane());
    const fromX = world.x;
    const fromY = world.y;
    if (Math.abs(target.x - fromX) + Math.abs(target.y - fromY) < 1) return;
    userMoved = true;
    await tween(320, (t) => {
      const e = easeInOut(t);
      world.x = fromX + (target.x - fromX) * e;
      world.y = fromY + (target.y - fromY) * e;
    });
  };

  const driveTrainingFocus = (): void => {
    if (destroyed || trainingGlide || playing || !mounted) return;
    const point = pendingTrainingFocus;
    if (!point) return;
    pendingTrainingFocus = null;
    const screen = { width: app.renderer.width, height: app.renderer.height };
    const plane = { scale: world.scale.x, offset: { x: world.x, y: world.y } };
    if (!needsTrainingFocus(point, plane, screen)) return;
    trainingGlide = true;
    void glideToTrainingTarget(point).finally(() => { trainingGlide = false; });
  };

  const armTrainingFocus = (next: FieldView): void => {
    const highlight = next.trainingFocus ? next.trainingHighlight : null;
    const key = highlight ? `${highlight.kind}:${highlight.x},${highlight.y}` : null;
    if (key === trainingHighlightKey) return;
    trainingHighlightKey = key;
    const point = highlight ? trainingHighlightPoint(highlight) : null;
    pendingTrainingFocus = point;
  };

  const shake = async (strength: number): Promise<void> => {
    if (reducedMotion) return;
    const ox = world.x;
    const oy = world.y;
    await tween(150, (t) => {
      const amp = (1 - t) * strength;
      world.x = ox + (shakeNoise() * 2 - 1) * amp;
      world.y = oy + (shakeNoise() * 2 - 1) * amp;
    });
    world.x = ox;
    world.y = oy;
  };

  const entityById = (id: number): EntityState | undefined => view?.snapshot.entities.find((e) => e.id === id);

  // ── Кинематика ──────────────────────────────────────────────────────────────

  const waitCinematic = (ms: number): Promise<void> => {
    if (cinematicSkip || reducedMotion || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => { window.setTimeout(resolve, ms / speedScale); });
  };

  const tweenCinematic = (ms: number, step: (t: number) => void): Promise<void> =>
    new Promise((resolve) => {
      if (cinematicSkip || reducedMotion || ms <= 0) { step(1); resolve(); return; }
      const started = performance.now();
      const duration = ms / speedScale;
      const frame = (): void => {
        if (destroyed || cinematicSkip) { step(1); resolve(); return; }
        const t = Math.min(1, (performance.now() - started) / duration);
        step(t);
        if (t >= 1) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

  const settleCamera = async (): Promise<void> => {
    if (!mounted || destroyed) return;
    const w = app.renderer.width;
    const h = app.renderer.height;
    if (w <= 0 || h <= 0) return;
    const scale = fitScale({ width: w, height: h }, CELL_SIZE);
    const home = homePoint();
    if (!home) return;
    const target = clampCameraOffset(
      { x: w / 2 - home.x * scale, y: h / 2 - home.y * scale },
      { scale, offset: { x: 0, y: 0 } },
      { width: w, height: h },
      mapPlane(),
    );
    const fromX = world.x;
    const fromY = world.y;
    await tweenCinematic(360, (t) => {
      const e = easeInOut(t);
      world.x = fromX + (target.x - fromX) * e;
      world.y = fromY + (target.y - fromY) * e;
    });
  };

  const centerOnNow = (point: Point): void => {
    if (!mounted || destroyed) return;
    const w = app.renderer.width;
    const h = app.renderer.height;
    if (w <= 0 || h <= 0) return;
    const plane = { scale: world.scale.x, offset: { x: world.x, y: world.y } };
    const screen = { width: w, height: h };
    const target = cinematicGlideOffset(point, plane, screen, mapPlane());
    world.x = target.x;
    world.y = target.y;
    userMoved = true;
  };

  const glideTo = async (point: Point, durationMs: number): Promise<void> => {
    if (!mounted || destroyed) return;
    const w = app.renderer.width;
    const h = app.renderer.height;
    if (w <= 0 || h <= 0) return;
    const plane = { scale: world.scale.x, offset: { x: world.x, y: world.y } };
    const screen = { width: w, height: h };
    const target = cinematicGlideOffset(point, plane, screen, mapPlane());
    const fromX = world.x;
    const fromY = world.y;
    userMoved = true;
    await tweenCinematic(durationMs, (t) => {
      const e = easeInOut(t);
      world.x = fromX + (target.x - fromX) * e;
      world.y = fromY + (target.y - fromY) * e;
    });
  };

  const zoomTo = async (scale: number, durationMs: number, anchor?: Point | null): Promise<void> => {
    if (!mounted || destroyed) return;
    const from = world.scale.x;
    const to = Math.min(CINEMATIC_SCALE_MAX, Math.max(ZOOM_MIN, scale));
    if (to === from) return;
    const plane = mapPlane();
    const ax = anchor?.x ?? plane.width / 2;
    const ay = anchor?.y ?? plane.height / 2;
    const screenX = world.x + ax * from;
    const screenY = world.y + ay * from;
    const apply = (s: number): void => {
      world.scale.set(s);
      world.x = screenX - ax * s;
      world.y = screenY - ay * s;
    };
    await tweenCinematic(durationMs, (t) => apply(from + (to - from) * easeInOut(t)));
    apply(to);
    userMoved = true;
  };

  const runInOffset = (entity: EntityState): { dx: number; dy: number } => {
    const gridWidth = view?.snapshot.grid.width ?? 0;
    const gridHeight = view?.snapshot.grid.height ?? 0;
    const toWest = entity.x;
    const toEast = Math.max(0, gridWidth - 1 - entity.x);
    const toNorth = entity.y;
    const toSouth = Math.max(0, gridHeight - 1 - entity.y);
    const nearest = Math.min(toWest, toEast, toNorth, toSouth);
    const over = RUN_IN_CELLS * CELL_SIZE;
    if (nearest === toEast) return { dx: over, dy: 0 };
    if (nearest === toWest) return { dx: -over, dy: 0 };
    if (nearest === toSouth) return { dx: 0, dy: over };
    return { dx: 0, dy: -over };
  };

  const runInEntity = async (entityId: number, durationMs: number, follow = false): Promise<void> => {
    const entity = entityById(entityId);
    if (!entity) return;
    const tile = view?.snapshot.grid.tiles.find((c) => c.x === entity.x && c.y === entity.y);
    const at = centerOf(entity.x, entity.y, tile ? visualLevel(tile) : entity.z);
    const { dx, dy } = runInOffset(entity);
    lunges.set(entityId, { dx, dy });
    hiddenIds.delete(entityId);
    await tweenCinematic(durationMs, (t) => {
      const e = easeOut(t);
      const shiftX = dx * (1 - e);
      const shiftY = dy * (1 - e);
      lunges.set(entityId, { dx: shiftX, dy: shiftY });
      if (follow) centerOnNow({ x: at.cx + shiftX, y: at.cy + shiftY });
    });
    lunges.delete(entityId);
    if (follow) centerOnNow({ x: at.cx, y: at.cy });
  };

  const fadeScreen = async (mode: "out" | "in", durationMs = 500): Promise<void> => {
    if (!mounted || destroyed) return;
    const start = mode === "out" ? 0 : 1;
    const target = mode === "out" ? 1 : 0;
    const paintFade = (alpha: number): void => {
      fadeLayer.clear();
      if (alpha <= 0.001) return;
      const w = app.renderer.width;
      const h = app.renderer.height;
      if (w <= 0 || h <= 0) return;
      fadeLayer.rect(0, 0, w, h).fill({ color: FADE_COLOR, alpha });
    };
    if (reducedMotion || durationMs <= 0) { paintFade(target); return; }
    paintFade(start);
    await tweenCinematic(durationMs, (t) => paintFade(start + (target - start) * t));
    paintFade(target);
  };

  const cinematicPoint = (target: CinematicTarget | undefined): { point: Point | null; entityId?: number } => {
    if (!target) return { point: null };
    if (target.configId) {
      const entity = view?.snapshot.entities.find((c) => c.configId === target.configId && !c.dead);
      if (!entity) return { point: null };
      const tile = view?.snapshot.grid.tiles.find((c) => c.x === entity.x && c.y === entity.y);
      const at = centerOf(entity.x, entity.y, tile ? visualLevel(tile) : entity.z);
      return { point: { x: at.cx, y: at.cy }, entityId: entity.id };
    }
    if (target.cell) {
      const tile = view?.snapshot.grid.tiles.find((c) => c.x === target.cell!.x && c.y === target.cell!.y);
      const at = centerOf(target.cell.x, target.cell.y, tile ? visualLevel(tile) : 1);
      return { point: { x: at.cx, y: at.cy } };
    }
    return { point: null };
  };

  const anchorPointOf = (step: CinematicStep, point: Point | null, entityId?: number): Point | null => {
    if (!point || !step.follow || step.runInMs === undefined || entityId === undefined) return point;
    const entity = entityById(entityId);
    if (!entity) return point;
    const offset = runInOffset(entity);
    return { x: point.x + offset.dx, y: point.y + offset.dy };
  };

  const firstPointOf = (plan: CinematicPlan): Point | null => {
    for (const step of plan.steps) {
      if (!step || step.kind === "hold" || step.kind === "fade") continue;
      const { point, entityId } = cinematicPoint(step.target);
      if (point) return anchorPointOf(step, point, entityId);
    }
    return null;
  };

  const finalPointOf = (plan: CinematicPlan): Point | null => {
    for (let i = plan.steps.length - 1; i >= 0; i -= 1) {
      const step = plan.steps[i];
      if (!step || step.kind === "hold" || step.kind === "fade") continue;
      const { point } = cinematicPoint(step.target);
      if (point) return point;
    }
    return null;
  };

  const playCinematic = async (plan: CinematicPlan): Promise<boolean> => {
    if (destroyed || !mounted || plan.steps.length === 0) return false;
    cinematicSkip = false;
    cinematicPlaying = true;
    if (plan.lockInput !== false) inputLocked = true;
    const gameScale = plan.baseScale ?? world.scale.x;
    const exit = finalPointOf(plan);
    try {
      const entry = firstPointOf(plan);
      if (entry) await glideTo(entry, 0);
      await zoomTo(gameScale * (plan.zoom ?? CINEMATIC_ZOOM), CINEMATIC_ZOOM_MS, entry);
      for (const step of plan.steps) {
        if (destroyed) break;
        if (cinematicSkip) break;
        const { point, entityId } = cinematicPoint(step.target);
        cinematicAccent = step.accent && point ? point : null;
        if (step.kind === "fade") { await fadeScreen(step.fade ?? "out", step.durationMs ?? 500); continue; }
        if (step.kind === "hold") { await waitCinematic(step.durationMs ?? step.holdMs ?? 400); continue; }
        if (!point) continue;
        const runner = step.runInMs !== undefined && entityId !== undefined ? entityById(entityId) : undefined;
        const follow = runner !== undefined && step.follow === true;
        if (step.kind === "focus") {
          await glideTo(point, step.durationMs ?? 0);
        } else if (follow && runner) {
          const offset = runInOffset(runner);
          await glideTo({ x: point.x + offset.dx, y: point.y + offset.dy }, step.durationMs ?? 320);
        } else {
          await glideTo(point, step.durationMs ?? 600);
        }
        if (step.runInMs !== undefined && runner) {
          const pack = plan.revealIds?.length ? [...plan.revealIds] : [runner.id];
          const lead = pack.indexOf(runner.id);
          await Promise.all(pack.map((id, index) => runInEntity(id, step.runInMs!, index === lead && follow)));
        }
        if (step.holdMs) await waitCinematic(step.holdMs);
        cinematicAccent = null;
      }
      if (cinematicSkip) { if (exit) await glideTo(exit, 0); }
      if (plan.holdZoom !== true) {
        await zoomTo(gameScale, CINEMATIC_ZOOM_MS, exit);
        if (exit) await glideTo(exit, 0);
        await settleCamera();
      }
      return cinematicSkip;
    } finally {
      cinematicPlaying = false;
      cinematicAccent = null;
      if (plan.lockInput !== false) inputLocked = false;
    }
  };

  const skipCinematic = (): void => { if (cinematicPlaying) cinematicSkip = true; };

  const setHiddenEntities = (ids: readonly number[]): void => {
    hiddenIds = new Set(ids);
    paint();
  };

  // ── Проигрывание событий ────────────────────────────────────────────────────

  const pushFloat = (x: number, y: number, value: string, color: number, big: boolean): void => {
    if (destroyed || !mounted) return;
    while (floatTexts.length >= MAX_FLOAT_TEXTS) { const oldest = floatTexts.shift(); oldest?.text.destroy(); }
    const text = new Text({
      text: value,
      style: {
        fontFamily: "Segoe UI, PT Sans, system-ui, sans-serif",
        fontSize: big ? 22 : 16,
        fontWeight: big ? "900" : "800",
        fill: color,
        stroke: { color: 0x090b0a, width: big ? 4.5 : 3 },
        letterSpacing: 0.5,
      },
    });
    text.anchor.set(0.5, 1);
    text.position.set(x, y - 22);
    labelsLayer.addChild(text);
    floatTexts.push({ text, start: performance.now(), startY: y - 22 });
  };

  const paintLabels = (now: number): void => {
    for (let i = floatTexts.length - 1; i >= 0; i -= 1) {
      const item = floatTexts[i];
      if (!item) continue;
      const t = Math.min(1, (now - item.start) / FLOAT_MS);
      if (t >= 1) { item.text.destroy(); floatTexts.splice(i, 1); continue; }
      const ease = 1 - (1 - t) * (1 - t);
      item.text.y = item.startY - ease * FLOAT_RISE;
      item.text.alpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
      const pop = item.text.style.fontSize > 18 ? 1 + 0.3 * (1 - t) : 1;
      item.text.scale.set(pop);
    }
  };

  const displayPixel = (entityId: number): { cx: number; cy: number } | null => {
    const entity = entityById(entityId);
    if (entity) return entityPixel(entity);
    const shown = display.get(entityId);
    return shown ? centerOf(shown.x, shown.y, shown.z) : null;
  };

  /** Собрать контекст для проигрывателя событий. */
  const makeEventCtx = (): EventPlayerCtx => ({
    display, dying, flashes, lunges, bumps, fxs, missLabel,
    view,
    entityById,
    entityPixel,
    displayPixel,
    focusOn,
    wait,
    tween,
    shake,
    pushFloat,
  });

  const drain = async (): Promise<void> => {
    if (playing) return;
    playing = true;
    const frame = (): void => { paint(); if (playing && !destroyed) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    while (jobs.length > 0) {
      const job = jobs.shift();
      if (!job) break;
      for (const event of job.events) { await playOne(event, makeEventCtx()); if (destroyed) break; }
      job.done();
    }
    playing = false;
    holdDisplay = false;
    if (view) {
      for (const entity of view.snapshot.entities) {
        display.set(entity.id, { x: entity.x, y: entity.y, z: entity.z, hp: entity.hp, maxHp: entity.maxHp, dead: entity.dead });
      }
    }
    lunges.clear();
    bumps.clear();
    paint();
  };

  // ── Рисование ───────────────────────────────────────────────────────────────

  const paintFx = (): void => {
    if (!view || destroyed || !mounted) return;
    const g = fxLayer;
    g.clear();
    glowLayer.clear();
    const now = performance.now();
    const motionNow = reducedMotion ? 12000 : now;

    const tokenCtx: DrawTokenCtx = { display, dying, flashes, lunges, bumps, view, reducedMotion, playing };
    const selected = view.snapshot.entities.find((e) => e.id === view!.selectedId);
    const aimed = view.snapshot.entities.find((e) => e.id === view!.aimId);
    const aimOrigin = selected && aimed && !selected.dead && !aimed.dead ? aimOriginOf(view, selected) : null;
    const aimedPixel = aimed && !aimed.dead ? entityPixel(aimed) : null;

    // Оверлеи (достижимость, прицел, область умения, эвакуация, яблоко, линия)
    const overlayCtx: OverlayCtx = { view, motionNow, aimOrigin, aimedPixel, entityPixel };
    paintOverlays(g, overlayCtx);

    // Токены (фишки, укрытия, павшие)
    const drawOrder = [...view.snapshot.entities].sort((a, b) => {
      const pa = entityPixel(a); const pb = entityPixel(b);
      return pa.cy - pb.cy || a.id - b.id;
    });
    for (const entity of drawOrder) {
      if (view.visibleCells && entity.owner !== 1 && entity.coverType === 0) {
        if (!view.visibleCells.has(`${entity.x},${entity.y}`)) continue;
      }
      if (view.visibleCells && entity.coverType > 0) {
        const key = `${entity.x},${entity.y}`;
        if (!view.visibleCells.has(key) && !(view.exploredCells?.has(key) ?? false)) continue;
      }
      if (hiddenIds.has(entity.id)) continue;
      const shown = display.get(entity.id);
      const dead = shown?.dead ?? entity.dead;
      if (dead && entity.coverType === 0 && !dying.has(entity.id)) {
        if (entity.maxAp > 0) { const { cx, cy } = entityPixel(entity); drawFallen(g, cx, cy); }
        continue;
      }
      drawToken(g, entity, motionNow, tokenCtx, entityPixel);
    }

    // Подсветка защищённых граней
    if (view.selectedId !== null) {
      const sel = view.snapshot.entities.find((e) => e.id === view!.selectedId);
      if (sel && !sel.dead && sel.coverType === 0) drawProtectionHighlights(g, sel, view, 1.0);
    }
    if (view.hoverCell) {
      drawProtectionHighlights(g, { x: view.hoverCell.x, y: view.hoverCell.y, z: view.hoverCell.z } as EntityState, view, 0.35);
    }

    // Обучающее затемнение и маркер
    paintTrainingOverlay(g, view, motionNow);

    // Маркеры пересечения луча с укрытиями
    if (view.selectedId !== null && view.aimId !== null && aimOrigin && aimedPixel) {
      drawAimIntersections(g, view, aimOrigin, aimedPixel);
    }

    // Эффекты
    drawFxList(g, glowLayer, fxs, now);

    // Фланговый индикатор
    paintFlankIndicator(g, view, motionNow, entityPixel);
  };

  const paint = (): void => { paintFx(); };

  const doRenderAtmosphere = (): void => {
    const w = app.renderer.width;
    const h = app.renderer.height;
    paintVignette(vignetteG, w, h, reducedMotion);
    paintDarkness(darknessG, view, w, h, mounted, destroyed);
  };

  // ── Ввод ────────────────────────────────────────────────────────────────────

  const zoomAt = (screenX: number, screenY: number, factor: number): void => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, world.scale.x * factor));
    if (next === world.scale.x) return;
    const wx = (screenX - world.x) / world.scale.x;
    const wy = (screenY - world.y) / world.scale.y;
    world.scale.set(next);
    world.x = screenX - wx * next;
    world.y = screenY - wy * next;
    userMoved = true;
  };

  const centerOnEntityCell = (x: number, y: number, durationMs = 260): void => {
    if (!mounted || destroyed) return;
    const tile = view?.snapshot.grid.tiles.find((c) => c.x === x && c.y === y);
    if (!tile) return;
    const { cx, cy } = centerOf(x, y, visualLevel(tile));
    const screen = { width: app.renderer.width, height: app.renderer.height };
    if (screen.width <= 0 || screen.height <= 0) return;
    const plane = { scale: world.scale.x, offset: { x: world.x, y: world.y } };
    const target = trainingGlideOffset({ x: cx, y: cy }, plane, screen, mapPlane());
    const fromX = world.x;
    const fromY = world.y;
    userMoved = true;
    void tween(durationMs, (t) => {
      const e = easeInOut(t);
      world.x = fromX + (target.x - fromX) * e;
      world.y = fromY + (target.y - fromY) * e;
    });
  };

  const onDown = (event: FederatedPointerEvent): void => {
    if (inputLocked) return;
    pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const a = pts[0]; const b = pts[1];
      if (a && b) { pinch = Math.hypot(a.x - b.x, a.y - b.y); pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      drag = false; return;
    }
    drag = true; dragged = false;
    lastX = event.global.x; lastY = event.global.y;
  };

  const onMove = (event: FederatedPointerEvent): void => {
    if (inputLocked) return;
    pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const a = pts[0]; const b = pts[1];
      if (a && b && pinch > 0 && pinchCenter) {
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const factor = dist / pinch;
        zoomAt(pinchCenter.x, pinchCenter.y, factor);
        pinch = dist;
      }
      return;
    }
    if (!drag) return;
    const dx = event.global.x - lastX;
    const dy = event.global.y - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
    world.x += dx; world.y += dy;
    lastX = event.global.x; lastY = event.global.y;
    userMoved = true;

    const local = world.toLocal({ x: event.global.x, y: event.global.y });
    const cell = cellFromLocal(local.x, local.y);
    if (cell && onHover) onHover(cell.x, cell.y);
  };

  const onUp = (event: FederatedPointerEvent): void => {
    if (inputLocked) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) { pinch = 0; pinchCenter = null; }
    if (!drag) return;
    drag = false;
    if (dragged) return;
    const local = world.toLocal({ x: event.global.x, y: event.global.y });
    const cell = cellFromLocal(local.x, local.y);
    if (!cell) return;
    // Двойное касание: центрировать камеру.
    const now = Date.now();
    const tapKey = `${cell.x},${cell.y}`;
    if (tapKey === lastTapKey && now - lastTapTime < 400) {
      centerOnEntityCell(cell.x, cell.y);
      lastTapKey = null; lastTapTime = 0;
    } else {
      lastTapKey = tapKey; lastTapTime = now;
      if (onActivate) onActivate(cell.x, cell.y);
    }
  };

  const onCancel = (event: FederatedPointerEvent): void => {
    if (inputLocked) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) { pinch = 0; pinchCenter = null; }
    drag = false;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (inputLocked) return;
    if (event.deltaX !== 0 && event.deltaY === 0) { world.x -= event.deltaX; userMoved = true; return; }
    const rect = app.canvas.getBoundingClientRect();
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015));
  };

  const onDblClick = (event: MouseEvent): void => {
    if (inputLocked) return;
    const rect = app.canvas.getBoundingClientRect();
    const local = world.toLocal({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    const cell = cellFromLocal(local.x, local.y);
    if (!cell) return;
    const occupant = view?.snapshot.entities.find(
      (c) => !c.dead && c.coverType === 0 && c.x === cell.x && c.y === cell.y,
    );
    if (occupant) centerOnEntityCell(cell.x, cell.y);
  };

  const onContext = (event: Event): void => { event.preventDefault(); };
  const onCanvasResize = (): void => {
    doRenderAtmosphere();
    homeFramed = false;
    if (!view?.trainingFocus || !view.trainingHighlight) return;
    const point = trainingHighlightPoint(view.trainingHighlight);
    if (point) pendingTrainingFocus = point;
  };

  const animLoop = (): void => {
    if (destroyed) return;
    const now = performance.now();
    paintLabels(now);
    // Краевая стрелка обучения
    if (view?.trainingFocus && view.trainingHighlight && mounted && !destroyed) {
      const point = trainingHighlightPoint(view.trainingHighlight);
      if (point) {
        const plane = { scale: world.scale.x, offset: { x: world.x, y: world.y } };
        const screenPt = worldToScreen(point, plane);
        paintEdgeArrow(edgeArrowG, screenPt, app.renderer.width, app.renderer.height, now, reducedMotion, destroyed, mounted);
      } else {
        paintEdgeArrow(edgeArrowG, null, 0, 0, now, reducedMotion, destroyed, mounted);
      }
    } else {
      paintEdgeArrow(edgeArrowG, null, 0, 0, now, reducedMotion, destroyed, mounted);
    }
    paintCinematicAccent(accentLayer, cinematicAccent, now, reducedMotion, destroyed, mounted, CELL_SIZE);
    if (!playing) {
      if (view?.visibleCells) paintFog(fogBaseLayer, fogDriftLayer, fxs, view, fogState, now, reducedMotion, destroyed, mounted);
      paintFx();
    }
    driveTrainingFocus();
    animFrame = requestAnimationFrame(animLoop);
  };

  // ── Публичный API ────────────────────────────────────────────────────────────

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
      try { await app.init({ ...common, preference: "webgl" }); }
      catch { await app.init(common); }
      if (destroyed) { app.destroy(true); return; }
      const canvas = app.canvas;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.touchAction = "none";
      element.appendChild(canvas);
      app.stage.addChild(world);
      app.stage.addChild(atmosphere);
      app.stage.addChild(fadeLayer);
      app.renderer.on("resize", onCanvasResize);
      world.on("pointerdown", onDown);
      world.on("pointermove", onMove);
      world.on("pointerup", onUp);
      world.on("pointerupoutside", onUp);
      world.on("pointercancel", onCancel);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("dblclick", onDblClick);
      canvas.addEventListener("contextmenu", onContext);
      mounted = true;
      fit();
      const seed = paintStatic(terrain, fringeLayer, view, destroyed, mounted);
      if (seed !== null) terrainSeed = seed;
      paintFx();
      doRenderAtmosphere();
      animFrame = requestAnimationFrame(animLoop);
    },
    update(next) {
      view = next;
      if (next.missLabel) missLabel = next.missLabel;
      armTrainingFocus(next);
      for (const entity of next.snapshot.entities) {
        const shown = display.get(entity.id);
        if (!shown || !holdDisplay) {
          display.set(entity.id, { x: entity.x, y: entity.y, z: entity.z, hp: entity.hp, maxHp: entity.maxHp, dead: entity.dead });
        } else {
          shown.maxHp = entity.maxHp;
        }
      }
      if (terrainSeed !== next.matchSeed) {
        const seed = paintStatic(terrain, fringeLayer, view, destroyed, mounted);
        if (seed !== null) terrainSeed = seed;
        homeFramed = false;
      }
      paintDebug(debugLayer, view);
      fit();
      paint();
      paintDarkness(darknessG, view, app.renderer.width, app.renderer.height, mounted, destroyed);
    },
    play(events) {
      return new Promise((done) => {
        holdDisplay = true;
        jobs.push({ events, done });
        void drain();
      });
    },
    pan(dx, dy) { world.x += dx; world.y += dy; userMoved = true; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(animFrame);
      jobs.length = 0;
      if (mounted) {
        app.renderer.off("resize", onCanvasResize);
        world.off("pointerdown", onDown);
        world.off("pointermove", onMove);
        world.off("pointerup", onUp);
        world.off("pointerupoutside", onUp);
        world.off("pointercancel", onCancel);
        try { app.canvas.removeEventListener("wheel", onWheel); app.canvas.removeEventListener("dblclick", onDblClick); app.canvas.removeEventListener("contextmenu", onContext); } catch { /* canvas already gone */ }
      }
      try { fadeLayer.clear(); app.destroy(true); } catch { /* already torn down */ }
      mounted = false;
    },
    playCinematic,
    skipCinematic,
    isCinematicPlaying: () => cinematicPlaying,
    getCameraScale: () => world.scale.x,
    focusCell(cell, durationMs) {
      if (inputLocked || destroyed || !mounted) return;
      centerOnEntityCell(cell.x, cell.y, durationMs ?? 260);
    },
    focusEntity(entityId, durationMs) {
      if (inputLocked || destroyed || !mounted) return;
      const entity = entityById(entityId);
      if (entity) centerOnEntityCell(entity.x, entity.y, durationMs ?? 260);
    },
    fadeScreen,
    setInputLocked(locked) { inputLocked = locked; },
    setHiddenEntities,
    setOnActivate(handler) { onActivate = handler; },
    setOnHover(handler) { onHover = handler; },
    setReducedMotion(flag) {
      reducedMotion = flag;
      fogState.fogSignature = "";
      fogState.lastFogDriftAt = -1;
      paintFog(fogBaseLayer, fogDriftLayer, fxs, view, fogState, performance.now(), reducedMotion, destroyed, mounted);
      doRenderAtmosphere();
    },
    setSpeed(scale) { speedScale = Math.max(1, Math.min(4, scale)); },
    getEntityScreenPosition(entityId) {
      if (!mounted || destroyed || !view) return null;
      const entity = view.snapshot.entities.find((c) => c.id === entityId);
      if (!entity) return null;
      const worldPoint = entityPixel(entity);
      const plane = { scale: world.scale.x, offset: { x: world.x, y: world.y } };
      const screen = worldToScreen({ x: worldPoint.cx, y: worldPoint.cy }, plane);
      const width = app.renderer.width;
      const height = app.renderer.height;
      if (width <= 0 || height <= 0) return null;
      return { x: screen.x / width, y: screen.y / height };
    },
  };
}
