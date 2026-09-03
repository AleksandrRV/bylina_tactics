/**
 * Проигрывание боевых событий: COMBAT_RESOLVED, SKILL_RESOLVED, ENTITY_MOVED,
 * ENTITY_DIED, STATUS_CHANGED, STAT_CHANGED, COVER_DESTROYED, ENTITY_SPAWNED,
 * ENTITY_REMOVED, ENTITY_DISPLACED, TURN_CHANGED.
 * Перенесено из field-renderer.ts без изменений.
 */

import type { EntityState, GameEvent } from "@bylina/core";
import { tileAt } from "@bylina/core";
import { CELL_SIZE, BOLT_MS_PER_CELL } from "./constants.js";
import { visualLevel, centerOf } from "./geometry.js";
import { easeOut } from "./math.js";
import type { DisplayState, Fx } from "./types.js";

export interface EventPlayerCtx {
  display: Map<number, DisplayState>;
  dying: Map<number, number>;
  flashes: Map<number, number>;
  lunges: Map<number, { dx: number; dy: number }>;
  bumps: Map<number, { dx: number; dy: number }>;
  fxs: Fx[];
  missLabel: string;
  view: import("./types.js").FieldView | null;
  // Колбэки
  entityById: (id: number) => EntityState | undefined;
  entityPixel: (e: EntityState) => { cx: number; cy: number };
  displayPixel: (id: number) => { cx: number; cy: number } | null;
  focusOn: (cx: number, cy: number) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  tween: (ms: number, step: (t: number) => void) => Promise<void>;
  shake: (strength: number) => Promise<void>;
  pushFloat: (x: number, y: number, value: string, color: number, big: boolean) => void;
}

export async function playCombat(
  event: Extract<GameEvent, { type: "COMBAT_RESOLVED" }>,
  ctx: EventPlayerCtx,
): Promise<void> {
  const {
    entityById,
    entityPixel,
    focusOn,
    wait,
    tween,
    shake,
    pushFloat,
    fxs,
    lunges,
    bumps,
    flashes,
    display,
    missLabel,
  } = ctx;
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
  await wait(120);
  if (event.actionType === "MELEE") {
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
    const shakeStrength = miss
      ? 0.8
      : Math.min(7, 1 + event.damageDealt * 0.65 + (crit ? 1.5 : 0) + (event.actionType === "MELEE" ? 1 : 0));
    if (miss) {
      fxs.push({ kind: "flash", x: to.cx, y: to.cy, start: performance.now(), crit: false, miss: true, angle });
      bumps.set(event.targetId, { dx: Math.cos(angle + Math.PI / 2) * 6, dy: Math.sin(angle + Math.PI / 2) * 6 });
      window.setTimeout(() => bumps.delete(event.targetId), 180);
      pushFloat(to.cx, to.cy, missLabel, 0xd8d2c2, false);
      void shake(shakeStrength);
      return;
    }
    fxs.push({ kind: "flash", x: to.cx, y: to.cy, start: performance.now(), crit, miss: false, angle });
    flashes.set(event.targetId, 1);
    window.setTimeout(() => flashes.delete(event.targetId), 260);
    bumps.set(event.targetId, { dx: Math.cos(angle) * (crit ? 10 : 7), dy: Math.sin(angle) * (crit ? 10 : 7) });
    window.setTimeout(() => bumps.delete(event.targetId), 200);
    const shown = display.get(event.targetId);
    if (shown) shown.hp = Math.max(0, shown.hp - event.damageDealt);
    pushFloat(to.cx, to.cy, `−${event.damageDealt}`, crit ? 0xe8b64c : 0xf3ecdc, crit);
    void shake(shakeStrength);
  }
}

export async function playSkill(
  event: Extract<GameEvent, { type: "SKILL_RESOLVED" }>,
  ctx: EventPlayerCtx,
): Promise<void> {
  const { displayPixel, focusOn, wait, fxs } = ctx;
  const from = displayPixel(event.sourceId);
  if (!from) return;
  const target = event.targetId !== undefined ? displayPixel(event.targetId) : null;
  const targetPos = event.targetPos;
  const to = targetPos ? centerOf(targetPos.x, targetPos.y, targetPos.z) : (target ?? from);
  await focusOn((from.cx + to.cx) / 2, (from.cy + to.cy) / 2);
  fxs.push({
    kind: "skill",
    x0: from.cx,
    y0: from.cy,
    x1: to.cx,
    y1: to.cy,
    start: performance.now(),
    dur: 560,
    style: event.skillId,
    success: event.success,
  });
  await wait(280);
}

export async function playOne(event: GameEvent, ctx: EventPlayerCtx): Promise<void> {
  const { display, dying, fxs, view, entityById, entityPixel, displayPixel, focusOn, wait, tween, shake, pushFloat } =
    ctx;

  if (event.type === "SKILL_RESOLVED") {
    await playSkill(event, ctx);
    return;
  }
  if (event.type === "STATUS_CHANGED") {
    const at = displayPixel(event.entityId);
    if (at) {
      fxs.push({
        kind: "status",
        x: at.cx,
        y: at.cy,
        start: performance.now(),
        status: event.status,
        applied: event.applied,
      });
      await wait(140);
    }
    return;
  }
  if (event.type === "STAT_CHANGED") {
    const shown = display.get(event.entityId);
    const at = displayPixel(event.entityId);
    if (shown && event.stat === "HP") {
      shown.hp = Math.min(shown.maxHp, Math.max(0, event.newValue));
      if (event.delta > 0 && at) pushFloat(at.cx, at.cy, `+${event.delta}`, 0x74e071, false);
    }
    return;
  }
  if (event.type === "COVER_DESTROYED") {
    const z = visualLevel(
      tileAt(view?.snapshot.grid ?? { width: 0, height: 0, tiles: [] }, event.gridPos.x, event.gridPos.y) ??
        ({ pit: false, z: 0 } as any),
    );
    const { cx, cy } = centerOf(event.gridPos.x, event.gridPos.y, z);
    fxs.push({
      kind: "shards",
      x: cx,
      y: cy - 4,
      start: performance.now(),
      seed: event.gridPos.x * 131 + event.gridPos.y * 7,
      palette: "wood",
    });
    void shake(2.4);
    return;
  }
  if (event.type === "ENTITY_SPAWNED") {
    const at = centerOf(event.entity.x, event.entity.y, event.entity.z);
    fxs.push({
      kind: "skill",
      x0: at.cx,
      y0: at.cy,
      x1: at.cx,
      y1: at.cy,
      start: performance.now(),
      dur: 520,
      style:
        event.cause === "ILLUSION"
          ? "create_illusion"
          : event.cause === "RESURRECTION"
            ? "raise_skeleton"
            : "summon_forest_beast",
      success: true,
    });
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
      shown.x = event.to.x;
      shown.y = event.to.y;
      shown.z = event.to.z;
    }
    return;
  }
  if (event.type === "COMBAT_RESOLVED") {
    await playCombat(event, ctx);
    return;
  }
  if (event.type === "ENTITY_DIED") {
    const shown = display.get(event.entityId);
    if (shown) shown.hp = 0;
    const entity = entityById(event.entityId);
    if (entity) {
      const { cx, cy } = entityPixel(entity);
      const tile = view?.snapshot.grid.tiles.find((c) => c.x === entity.x && c.y === entity.y);
      dying.set(event.entityId, performance.now());
      if (event.causeOfDeath === "FALL_INTO_PIT" || tile?.pit === true) {
        fxs.push({ kind: "pitfall", x: cx, y: cy, start: performance.now() });
      } else {
        fxs.push({
          kind: "shards",
          x: cx,
          y: cy,
          start: performance.now(),
          seed: event.entityId * 17 + 3,
          palette: "dark",
        });
        void shake(1.8);
      }
      await wait(700);
      dying.delete(event.entityId);
    }
    if (shown) shown.dead = true;
    return;
  }
  if (event.type === "TURN_CHANGED") {
    await wait(230);
  }
}
