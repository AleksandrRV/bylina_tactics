import { describe, expect, it } from "vitest";
import { createGestureTracker } from "../src/field/gestures.js";

/**
 * Жесты поля (§5 ui-design «Сенсорный экран»). Регрессия: мышь шлёт
 * pointermove до нажатия, и если наведение учитывать как палец, то первое
 * же нажатие видится вторым — вместо нажатия и сдвига работает щипок.
 */

const at = (x: number, y: number) => ({ x, y });

describe("gesture tracker", () => {
  it("treats a press-release in place as a tap", () => {
    const g = createGestureTracker();
    g.down(1, at(100, 100));
    expect(g.up(1, at(100, 100))).toEqual({ type: "tap", point: at(100, 100) });
  });

  it("does not let mouse hover occupy a finger slot", () => {
    const g = createGestureTracker();
    // Мышь водит по холсту до нажатия: это наведение, не жест.
    expect(g.move(1, at(10, 10)).type).toBe("hover");
    expect(g.move(1, at(40, 40)).type).toBe("hover");
    expect(g.activeCount(), "наведение не считается нажатым указателем").toBe(0);

    g.down(1, at(40, 40));
    expect(g.activeCount()).toBe(1);
    // Именно это ломалось: одиночное движение давало zoom вместо pan.
    expect(g.move(1, at(80, 40))).toEqual({ type: "pan", dx: 40, dy: 0, point: at(80, 40) });
    expect(g.up(1, at(80, 40)).type, "сдвиг не превращается в нажатие").toBe("none");
  });

  it("pans with one pointer and never zooms", () => {
    const g = createGestureTracker();
    g.down(7, at(0, 0));
    const a = g.move(7, at(30, 0));
    const b = g.move(7, at(30, 25));
    expect(a.type).toBe("pan");
    expect(b).toEqual({ type: "pan", dx: 0, dy: 25, point: at(30, 25) });
  });

  it("zooms only with two pressed pointers", () => {
    const g = createGestureTracker();
    g.down(1, at(0, 0));
    g.down(2, at(100, 0));
    const action = g.move(2, at(200, 0));
    expect(action.type).toBe("zoom");
    if (action.type !== "zoom") throw new Error("expected zoom");
    expect(action.factor).toBeCloseTo(2, 5);
    expect(action.center).toEqual(at(50, 0));
  });

  it("recovers after a cancelled touch instead of staying pinched", () => {
    const g = createGestureTracker();
    g.down(1, at(10, 10));
    g.cancel(1);
    expect(g.activeCount()).toBe(0);
    g.down(2, at(50, 50));
    expect(g.move(2, at(90, 50)).type).toBe("pan");
    expect(g.up(2, at(90, 50)).type).toBe("none");
  });

  it("forgets pointers when input is cleared (lock, unmount)", () => {
    const g = createGestureTracker();
    g.down(1, at(10, 10));
    g.clear();
    expect(g.activeCount()).toBe(0);
    g.down(1, at(10, 10));
    expect(g.up(1, at(10, 10))).toEqual({ type: "tap", point: at(10, 10) });
  });

  it("keeps panning with the finger that outlives a pinch, without a stray tap", () => {
    const g = createGestureTracker();
    g.down(1, at(0, 0));
    g.down(2, at(100, 0));
    g.move(2, at(200, 0));
    expect(g.up(2, at(200, 0)).type, "отпускание пальца щипка не нажатие").toBe("none");
    // Оставшийся палец ведёт обзор от своей точки, а не от начала щипка.
    expect(g.move(1, at(20, 0))).toEqual({ type: "pan", dx: 20, dy: 0, point: at(20, 0) });
    expect(g.up(1, at(20, 0)).type).toBe("none");
    // Дальше жесты снова обычные.
    g.down(3, at(5, 5));
    expect(g.up(3, at(5, 5)).type).toBe("tap");
  });

  it("ignores a tap when the pointer drifted beyond the slop", () => {
    const g = createGestureTracker();
    g.down(1, at(0, 0));
    g.move(1, at(9, 9));
    expect(g.up(1, at(9, 9)).type).toBe("none");
  });
});
