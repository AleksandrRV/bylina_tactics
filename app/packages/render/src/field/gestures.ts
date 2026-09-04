/**
 * gestures.ts — распознавание жестов поля боя (§5 ui-design «Сенсорный экран»).
 *
 * Состояние указателей вынесено из field-renderer.ts в чистый автомат:
 * его можно проверить тестами без WebGL и PixiJS.
 *
 * Правила:
 *   - жест считают только те указатели, которые действительно нажаты
 *     (замечены в `down`). Наведение мыши указателем не считается: иначе
 *     оно занимает слот, и первое же касание выглядит как второй палец;
 *   - один нажатый указатель — сдвиг обзора, при отпускании без сдвига — нажатие;
 *   - два нажатых указателя — масштаб относительно центра щипка;
 *   - `cancel`/`clear` снимают указатель: без этого прерванное касание
 *     навсегда остаётся «прижатым пальцем».
 */

export interface GesturePoint {
  x: number;
  y: number;
}

export type GestureAction =
  /** Ничего делать не нужно. */
  | { type: "none" }
  /** Сдвиг обзора на dx/dy; наведение сообщается той же точкой. */
  | { type: "pan"; dx: number; dy: number; point: GesturePoint }
  /** Масштаб относительно центра щипка. */
  | { type: "zoom"; center: GesturePoint; factor: number }
  /** Наведение без нажатия (мышь). */
  | { type: "hover"; point: GesturePoint }
  /** Короткое нажатие: указатель отпущен там же, где нажат. */
  | { type: "tap"; point: GesturePoint };

/** Порог, за которым нажатие считается сдвигом обзора, а не нажатием (px). */
export const DRAG_SLOP = 2;

export interface GestureTracker {
  down(pointerId: number, point: GesturePoint): GestureAction;
  move(pointerId: number, point: GesturePoint): GestureAction;
  up(pointerId: number, point: GesturePoint): GestureAction;
  cancel(pointerId: number): void;
  /** Снять все указатели: уход фокуса, размонтирование, блокировка ввода. */
  clear(): void;
  /** Число нажатых указателей — для тестов и отладки. */
  activeCount(): number;
}

export function createGestureTracker(): GestureTracker {
  /** Только нажатые указатели: наведение сюда не попадает. */
  const pressed = new Map<number, GesturePoint>();
  /** Указатель, который ведёт сдвиг обзора. */
  let panId: number | null = null;
  let panned = false;
  let last: GesturePoint = { x: 0, y: 0 };
  let pinch = 0;
  let pinchCenter: GesturePoint | null = null;

  const resetPinch = (): void => {
    pinch = 0;
    pinchCenter = null;
  };

  const beginPinch = (): void => {
    const [a, b] = [...pressed.values()];
    if (!a || !b) return;
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
    pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Щипок отменяет незавершённый сдвиг: палец, начавший тянуть карту,
    // стал половиной жеста масштаба.
    panId = null;
    panned = false;
  };

  return {
    down(pointerId, point) {
      pressed.set(pointerId, { x: point.x, y: point.y });
      if (pressed.size >= 2) {
        beginPinch();
        return { type: "none" };
      }
      panId = pointerId;
      panned = false;
      last = { x: point.x, y: point.y };
      return { type: "none" };
    },

    move(pointerId, point) {
      // Указатель, который не нажимали, жестом не управляет: для мыши это
      // обычное наведение, и оно не должно занимать слот пальца.
      if (!pressed.has(pointerId)) return { type: "hover", point };
      pressed.set(pointerId, { x: point.x, y: point.y });

      if (pressed.size >= 2) {
        if (pinch <= 0 || !pinchCenter) return { type: "none" };
        const [a, b] = [...pressed.values()];
        if (!a || !b) return { type: "none" };
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist <= 0) return { type: "none" };
        const factor = dist / pinch;
        pinch = dist;
        return { type: "zoom", center: pinchCenter, factor };
      }

      if (panId !== pointerId) return { type: "none" };
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) panned = true;
      last = { x: point.x, y: point.y };
      return { type: "pan", dx, dy, point };
    },

    up(pointerId, point) {
      const wasPressed = pressed.delete(pointerId);
      if (pressed.size < 2) resetPinch();
      // Второй палец отпущен — оставшийся продолжает вести обзор с его
      // текущей точки, а не с точки, где начинался щипок.
      if (pressed.size === 1) {
        const [remainingId] = [...pressed.keys()];
        const remaining = remainingId === undefined ? undefined : pressed.get(remainingId);
        if (remainingId !== undefined && remaining) {
          panId = remainingId;
          panned = true; // жест уже был масштабом: отпускание не считается нажатием
          last = { x: remaining.x, y: remaining.y };
        }
        return { type: "none" };
      }
      if (!wasPressed || panId !== pointerId) return { type: "none" };
      const moved = panned;
      panId = null;
      panned = false;
      return moved ? { type: "none" } : { type: "tap", point };
    },

    cancel(pointerId) {
      pressed.delete(pointerId);
      if (pressed.size < 2) resetPinch();
      if (panId === pointerId) {
        panId = null;
        panned = false;
      }
    },

    clear() {
      pressed.clear();
      resetPinch();
      panId = null;
      panned = false;
    },

    activeCount() {
      return pressed.size;
    },
  };
}
