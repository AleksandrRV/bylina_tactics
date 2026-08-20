import {
  type CellPos,
  type EntityState,
  type GameEvent,
  type MatchState,
  type ReachableCell,
  type Tile,
} from "@bylina/core";
import { Application, Container, Graphics, Rectangle, type FederatedPointerEvent } from "pixi.js";

export const RENDER_STATUS = "pixi" as const;
export const CELL_SIZE = 52;
const RISE = 8;
const PAD = 20;

const Z_FILL = [0x1c2c22, 0x3a5a44, 0x6a8f6c] as const;
const Z_RISER = [0x121c16, 0x24382c, 0x3d5640] as const;

export interface FieldView {
  snapshot: MatchState;
  selectedId: number | null;
  aimId: number | null;
  reachable: ReachableCell[];
  path: CellPos[];
  aimOk: boolean;
  heightMod: -1 | 0 | 1;
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

function tileAt(tiles: readonly Tile[], x: number, y: number): Tile | undefined {
  return tiles.find((tile) => tile.x === x && tile.y === y);
}

function levelOf(tile: Tile | undefined): number | null {
  if (!tile) return null;
  return tile.pit ? 0 : tile.z;
}

function tokenColor(entity: EntityState): number {
  if (entity.coverType > 0) return 0x8b6a3a;
  if (entity.owner === 2) return 0x8bc34a;
  if (entity.configId === "bogatyr") return 0xc45c3a;
  if (entity.configId === "znaharka") return 0x5bb3a0;
  if (entity.configId === "leshy") return 0x6d9a3a;
  if (entity.configId === "kikimora") return 0x9ccc65;
  return 0xe0b34a;
}

function hexPoints(cx: number, cy: number, r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return pts;
}

export function createFieldRenderer(): FieldRenderer {
  const app = new Application();
  const world = new Container();
  const ground = new Container();
  const overlay = new Graphics();
  world.addChild(ground, overlay);
  world.eventMode = "static";
  world.hitArea = new Rectangle(-4000, -4000, 12000, 12000);

  let host: HTMLElement | null = null;
  let destroyed = false;
  let mounted = false;
  let view: FieldView | null = null;
  let onActivate: ((x: number, y: number) => void) | null = null;
  let onHover: ((x: number, y: number) => void) | null = null;
  let userMoved = false;
  const display = new Map<number, { x: number; y: number }>();
  const flashes = new Map<number, number>();
  let playing = false;
  let holdDisplay = false;
  const jobs: Array<{ events: GameEvent[]; done: () => void }> = [];

  let drag = false;
  let dragged = false;
  let lastX = 0;
  let lastY = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  const cellFromLocal = (lx: number, ly: number): { x: number; y: number } | null => {
    if (!view) return null;
    const x = Math.floor((lx - PAD) / CELL_SIZE);
    const y = Math.floor((ly - PAD) / CELL_SIZE);
    if (x < 0 || y < 0 || x >= view.snapshot.grid.width || y >= view.snapshot.grid.height) return null;
    return { x, y };
  };

  const fit = (): void => {
    if (!view || userMoved || !mounted) return;
    const cols = view.snapshot.grid.width;
    const rows = view.snapshot.grid.height;
    const bw = cols * CELL_SIZE + PAD * 2;
    const bh = rows * CELL_SIZE + PAD * 2 + RISE * 2;
    const w = app.renderer.width;
    const h = app.renderer.height;
    if (w <= 0 || h <= 0) return;
    const scale = Math.min(w / bw, h / bh, 1.25);
    world.scale.set(scale);
    world.x = (w - bw * scale) / 2;
    world.y = (h - bh * scale) / 2;
  };

  const drawToken = (g: Graphics, entity: EntityState, px: number, py: number): void => {
    const cx = px + CELL_SIZE / 2;
    const cy = py + CELL_SIZE / 2;
    const selected = view?.selectedId === entity.id;
    const aimed = view?.aimId === entity.id;
    const flash = flashes.get(entity.id) ?? 0;
    if (entity.coverType > 0) {
      g.rect(px + 10, py + 22, 32, 18).fill(0x8b6a3a);
      g.poly([px + 8, py + 24, px + 26, py + 10, px + 44, py + 24]).fill(0x6b4f2a);
      return;
    }
    if (entity.owner === 2) {
      g.poly(hexPoints(cx, cy, 15)).fill(tokenColor(entity));
      g.poly(hexPoints(cx, cy, 15)).stroke({ width: 2, color: aimed ? 0xd7ff8a : 0x1b3a14 });
    } else {
      g.circle(cx, cy, 14).fill(tokenColor(entity));
      g.circle(cx, cy, 14).stroke({ width: selected ? 3 : 2, color: selected ? 0xf3ecdc : 0x3a2a10 });
    }
    if (flash > 0) {
      g.circle(cx, cy, 18).stroke({ width: 3, color: 0xf3ecdc, alpha: flash });
    }
    if (entity.dead) return;
    const ratio = Math.max(0, entity.hp / Math.max(1, entity.maxHp));
    g.rect(px + 8, py + 4, CELL_SIZE - 16, 3).fill({ color: 0x000000, alpha: 0.45 });
    g.rect(px + 8, py + 4, (CELL_SIZE - 16) * ratio, 3).fill(0xc62828);
  };

  const paint = (): void => {
    if (!view || destroyed || !mounted) return;
    const { snapshot, reachable, path, selectedId, aimId, aimOk, heightMod } = view;
    ground.removeChildren();
    overlay.clear();

    const reach = new Map(reachable.map((cell) => [`${cell.x},${cell.y}`, cell]));
    const onPath = new Set(path.map((cell) => `${cell.x},${cell.y}`));

    for (const tile of snapshot.grid.tiles) {
      const visualZ = tile.pit ? 0 : tile.z;
      const south = tileAt(snapshot.grid.tiles, tile.x, tile.y + 1);
      const southLevel = levelOf(south);
      const dropSouth = southLevel === null ? visualZ : Math.max(0, visualZ - southLevel);
      const g = new Graphics();
      const px = PAD + tile.x * CELL_SIZE;
      const py = PAD + tile.y * CELL_SIZE;
      const fill = tile.pit ? 0x141310 : tile.blockLOS ? 0x5a4c3e : (Z_FILL[visualZ] ?? Z_FILL[1]);
      g.rect(0, 0, CELL_SIZE, CELL_SIZE).fill(fill);
      g.rect(0, 0, CELL_SIZE, CELL_SIZE).stroke({ width: 1, color: 0x000000, alpha: 0.28 });
      if (dropSouth > 0) {
        g.rect(0, CELL_SIZE, CELL_SIZE, dropSouth * RISE).fill(Z_RISER[visualZ] ?? 0x24382c);
      }
      if (tile.pit) {
        g.circle(CELL_SIZE / 2, CELL_SIZE / 2, 16).fill(0x070806);
        g.circle(CELL_SIZE / 2, CELL_SIZE / 2, 16).stroke({ width: 2, color: 0x2a241c });
      }
      if (tile.blockLOS) {
        g.rect(6, 6, 40, 40).fill(0x7a6a56);
        g.rect(6, 6, 40, 40).stroke({ width: 1, color: 0xcbb89a });
      }
      const key = `${tile.x},${tile.y}`;
      const reachCell = reach.get(key);
      if (reachCell) {
        const tint = reachCell.apCost === 1 ? 0x388cdc : 0xe0b34a;
        g.rect(1, 1, CELL_SIZE - 2, CELL_SIZE - 2).fill({ color: tint, alpha: 0.38 });
        g.rect(2, 2, CELL_SIZE - 4, CELL_SIZE - 4).stroke({ width: 2, color: tint });
      }
      if (onPath.has(key)) {
        g.rect(3, 3, CELL_SIZE - 6, CELL_SIZE - 6).stroke({ width: 2, color: 0xffffff });
      }
      g.position.set(px, py);
      g.zIndex = tile.y * 10 + visualZ * 100;
      g.eventMode = "none";
      ground.addChild(g);
    }
    ground.sortableChildren = true;

    const selected = snapshot.entities.find((entity) => entity.id === selectedId);
    const aimed = snapshot.entities.find((entity) => entity.id === aimId);
    if (selected && aimed) {
      const a = display.get(selected.id) ?? { x: selected.x, y: selected.y };
      const b = display.get(aimed.id) ?? { x: aimed.x, y: aimed.y };
      const ax = PAD + (a.x + 0.5) * CELL_SIZE;
      const ay = PAD + (a.y + 0.5) * CELL_SIZE;
      const bx = PAD + (b.x + 0.5) * CELL_SIZE;
      const by = PAD + (b.y + 0.5) * CELL_SIZE;
      overlay.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 2, color: aimOk ? 0xe0b34a : 0xc45c5c });
      if (heightMod !== 0) {
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const dir = heightMod === 1 ? -1 : 1;
        overlay.poly([mx, my + dir * 10, mx - 6, my, mx + 6, my]).fill(aimOk ? 0xe0b34a : 0xc45c5c);
      }
    }

    for (const entity of snapshot.entities) {
      const pos = display.get(entity.id) ?? { x: entity.x, y: entity.y };
      const px = PAD + pos.x * CELL_SIZE;
      const py = PAD + pos.y * CELL_SIZE;
      if (entity.dead && entity.coverType === 0) {
        overlay.circle(px + CELL_SIZE / 2, py + CELL_SIZE / 2, 12).fill({ color: 0x4a4a4a, alpha: 0.45 });
        continue;
      }
      if (entity.dead) continue;
      drawToken(overlay, entity, px, py);
      if (entity.id === selectedId) {
        overlay.rect(px + 2, py + 2, CELL_SIZE - 4, CELL_SIZE - 4).stroke({ width: 3, color: 0xe0b34a });
      }
      if (entity.id === aimId) {
        overlay.rect(px + 2, py + 2, CELL_SIZE - 4, CELL_SIZE - 4).stroke({ width: 3, color: 0x8bc34a });
      }
    }
  };

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
        paint();
        if (t >= 1) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

  const playOne = async (event: GameEvent): Promise<void> => {
    if (event.type === "ENTITY_MOVED") {
      const moved = event.path;
      if (moved.length === 0) return;
      const first = moved[0];
      if (first) display.set(event.entityId, { x: first.x, y: first.y });
      for (let i = 1; i < moved.length; i += 1) {
        const from = moved[i - 1];
        const to = moved[i];
        if (!from || !to) continue;
        await tween(70, (t) => {
          display.set(event.entityId, {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
          });
        });
      }
      const last = moved[moved.length - 1];
      if (last) display.set(event.entityId, { x: last.x, y: last.y });
      return;
    }
    if (event.type === "COMBAT_RESOLVED") {
      const originX = world.x;
      const originY = world.y;
      flashes.set(event.targetId, 1);
      await tween(220, (t) => {
        flashes.set(event.targetId, 1 - t);
        const shake = event.result === "MISS" ? 0 : (1 - t) * 4;
        world.x = originX + (Math.random() * 2 - 1) * shake;
        world.y = originY + (Math.random() * 2 - 1) * shake;
      });
      flashes.delete(event.targetId);
      world.x = originX;
      world.y = originY;
      return;
    }
    if (event.type === "ENTITY_DIED") {
      await tween(160, () => undefined);
    }
  };

  const drain = async (): Promise<void> => {
    if (playing) return;
    playing = true;
    while (jobs.length > 0) {
      const job = jobs.shift();
      if (!job) break;
      for (const event of job.events) await playOne(event);
      job.done();
    }
    playing = false;
    holdDisplay = false;
  };

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

  return {
    async mount(element) {
      if (destroyed) return;
      host = element;
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
      paint();
    },
    update(next) {
      view = next;
      for (const entity of next.snapshot.entities) {
        if (!display.has(entity.id) || !holdDisplay) {
          display.set(entity.id, { x: entity.x, y: entity.y });
        }
      }
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
      host = null;
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
