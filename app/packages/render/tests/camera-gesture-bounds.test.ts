// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/**
 * Границы камеры при ручных жестах (§5.1 ui-design: камера не показывает
 * пустоту за краями карты).
 *
 * Регрессия: сдвиг пальцем и щипок правили `world.x/y` напрямую, минуя
 * `clampCameraOffset`, — пролистывание уводило поле за край экрана, и карта
 * пропадала совсем. Раньше это не проявлялось только потому, что жест
 * сдвига был недостижим: наведение мыши занимало слот пальца, и всякое
 * движение уходило в ветку щипка.
 *
 * PixiJS в jsdom не работает, поэтому здесь минимальная подделка: она
 * считает ровно то, от чего зависит камера, — преобразование контейнера.
 */

const handlers = new Map<string, (event: unknown) => void>();
let lastStage: FakeContainer | null = null;

class FakeContainer {
  children: FakeContainer[] = [];
  x = 0;
  y = 0;
  scale = {
    x: 1,
    y: 1,
    set(value: number) {
      this.x = value;
      this.y = value;
    },
  };
  eventMode = "";
  hitArea: unknown = null;
  zIndex = 0;
  sortableChildren = false;
  visible = true;
  alpha = 1;
  blendMode = "";
  position = { set: () => undefined };
  addChild(...items: FakeContainer[]) {
    this.children.push(...items);
    return items[0];
  }
  removeChildren() {
    const kids = this.children;
    this.children = [];
    return kids;
  }
  destroy() {}
  on(name: string, fn: (event: unknown) => void) {
    handlers.set(name, fn);
  }
  off() {}
  toLocal(point: { x: number; y: number }) {
    return { x: (point.x - this.x) / this.scale.x, y: (point.y - this.y) / this.scale.y };
  }
}

class FakeGraphics extends FakeContainer {
  clear() {
    return this;
  }
  rect() {
    return this;
  }
  circle() {
    return this;
  }
  ellipse() {
    return this;
  }
  poly() {
    return this;
  }
  moveTo() {
    return this;
  }
  lineTo() {
    return this;
  }
  fill() {
    return this;
  }
  stroke() {
    return this;
  }
  roundRect() {
    return this;
  }
}

class FakeText extends FakeContainer {
  text: string;
  anchor = { set: () => undefined };
  constructor(options: { text?: string }) {
    super();
    this.text = options?.text ?? "";
  }
}

const SCREEN = { width: 800, height: 600 };

vi.mock("pixi.js", () => ({
  Application: class {
    stage = (lastStage = new FakeContainer());
    canvas = {
      style: {} as Record<string, string>,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 0, top: 0, ...SCREEN }),
    };
    renderer = { ...SCREEN, on: () => undefined, off: () => undefined };
    async init() {}
    destroy() {}
  },
  Container: FakeContainer,
  Graphics: FakeGraphics,
  Text: FakeText,
  TilingSprite: class extends FakeContainer {},
  Sprite: class extends FakeContainer {},
  Texture: { WHITE: {} },
  Rectangle: class {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  },
}));

const { createFieldRenderer } = await import("../src/field-renderer.js");
const { CELL_SIZE } = await import("../src/field/constants.js");

/** Поле 8×8 с одним бойцом — достаточно, чтобы камера получила базовый кадр. */
function makeView() {
  const tiles = [];
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) tiles.push({ x, y, z: 0, pit: false, blockLOS: false });
  const keys = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
  return {
    matchSeed: 1,
    snapshot: {
      turnNumber: 1,
      activeOwner: 1,
      grid: { width: 8, height: 8, tiles },
      entities: [
        {
          id: 1,
          owner: 1,
          configId: "bogatyr",
          x: 1,
          y: 1,
          z: 0,
          hp: 10,
          maxHp: 10,
          dead: false,
          coverType: 0,
          maxAp: 2,
        },
      ],
    },
    selectedId: 1,
    aimId: null,
    reachable: [],
    path: [],
    homeOwner: 1,
    visibleCells: keys,
    exploredCells: keys,
    missLabel: "Промах",
  };
}

async function mountRenderer() {
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => undefined;
  handlers.clear();
  const renderer = createFieldRenderer();
  await renderer.mount({ appendChild: () => undefined } as unknown as HTMLElement);
  renderer.update(makeView() as never);
  const world = lastStage!.children[0]!;
  return { renderer, world };
}

const event = (pointerId: number, x: number, y: number) => ({ pointerId, global: { x, y } });

/** Виден ли хоть кусочек поля на экране. */
function fieldOnScreen(world: FakeContainer): boolean {
  const span = 8 * CELL_SIZE * world.scale.x;
  return world.x < SCREEN.width && world.y < SCREEN.height && world.x + span > 0 && world.y + span > 0;
}

describe("camera stays on the field during manual gestures", () => {
  it("keeps the map on screen after a long one-finger pan", async () => {
    const { world } = await mountRenderer();
    const down = handlers.get("pointerdown")!;
    const move = handlers.get("pointermove")!;
    const up = handlers.get("pointerup")!;

    expect(fieldOnScreen(world), "перед жестом поле в кадре").toBe(true);

    down(event(1, 100, 100));
    for (let i = 1; i <= 30; i += 1) move(event(1, 100 + i * 60, 100 + i * 40));
    up(event(1, 1900, 1300));

    expect(fieldOnScreen(world), "после длинного сдвига карта не улетела за экран").toBe(true);
  });

  it("keeps the map on screen when panning the other way", async () => {
    const { world } = await mountRenderer();
    const down = handlers.get("pointerdown")!;
    const move = handlers.get("pointermove")!;
    const up = handlers.get("pointerup")!;

    down(event(1, 700, 500));
    for (let i = 1; i <= 30; i += 1) move(event(1, 700 - i * 60, 500 - i * 40));
    up(event(1, -1100, -700));

    expect(fieldOnScreen(world)).toBe(true);
  });

  it("keeps the map on screen after a pinch", async () => {
    const { world } = await mountRenderer();
    const down = handlers.get("pointerdown")!;
    const move = handlers.get("pointermove")!;
    const up = handlers.get("pointerup")!;

    down(event(1, 200, 300));
    down(event(2, 600, 300));
    for (let i = 1; i <= 20; i += 1) move(event(2, 600 + i * 40, 300));
    up(event(2, 1400, 300));
    up(event(1, 200, 300));

    expect(fieldOnScreen(world)).toBe(true);
  });

  it("keeps the map on screen through a long mixed gesture stream", async () => {
    const { world } = await mountRenderer();
    const down = handlers.get("pointerdown")!;
    const move = handlers.get("pointermove")!;
    const up = handlers.get("pointerup")!;
    const cancel = handlers.get("pointercancel")!;

    for (let i = 0; i < 200; i += 1) {
      const x = 100 + ((i * 137) % 900);
      const y = 80 + ((i * 91) % 700);
      const id = (i % 3) + 1;
      switch (i % 6) {
        case 0:
          move(event(id, x, y));
          break;
        case 1:
          down(event(id, x, y));
          break;
        case 2:
          move(event(id, x + 400, y + 300));
          break;
        case 3:
          up(event(id, x + 400, y + 300));
          break;
        case 4:
          down(event(id, x, y));
          down(event(id + 1, x + 120, y));
          move(event(id + 1, x + 320, y));
          break;
        default:
          cancel(event(id, x, y));
          break;
      }
      expect(Number.isFinite(world.x) && Number.isFinite(world.y)).toBe(true);
      expect(world.scale.x, "масштаб остаётся положительным").toBeGreaterThan(0);
    }

    expect(fieldOnScreen(world), "после потока жестов поле по-прежнему видно").toBe(true);
  });

  it("clamps the programmatic pan() as well", async () => {
    const { renderer, world } = await mountRenderer();
    renderer.pan(50_000, 50_000);
    expect(fieldOnScreen(world)).toBe(true);
    renderer.pan(-100_000, -100_000);
    expect(fieldOnScreen(world)).toBe(true);
  });
});
