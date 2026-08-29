import { describe, expect, it } from "vitest";
import { OUTCOME_SETTLE_MS, createOutcomeGate } from "../src/outcome-gate.js";

/**
 * Пауза перед итогом боя (0.20.39): карточка итога не перекрывает поле,
 * пока не доиграли последние анимации, и даёт ещё секунду, чтобы игрок
 * успел увидеть числа урона и гибель противника.
 */

/** Исполняемое вручную расписание: никаких настоящих таймеров. */
function harness(delayMs?: number) {
  const fired: string[] = [];
  const pendingLog: boolean[] = [];
  let queue: { fn: () => void; ms: number }[] = [];
  const gate = createOutcomeGate({
    delayMs,
    onPendingChange: (pending) => pendingLog.push(pending),
    schedule: (fn, ms) => {
      queue.push({ fn, ms });
      return queue.length;
    },
    cancel: () => {
      queue = [];
    },
  });
  return {
    gate,
    fired,
    pendingLog,
    /** Выполнить все отложенные вызовы. */
    flush(): void {
      const pending = queue;
      queue = [];
      for (const item of pending) item.fn();
    },
    pendingCount: (): number => queue.length,
    pendingDelay: (): number | undefined => queue[0]?.ms,
  };
}

describe("outcome gate (0.20.39)", () => {
  it("shows the outcome after the default pause when nothing is playing", () => {
    const { gate, fired, flush, pendingDelay } = harness();
    gate.report(() => fired.push("victory"));
    // Сразу после фиксации исхода карточки нет: сначала пауза.
    expect(fired).toEqual([]);
    expect(pendingDelay()).toBe(OUTCOME_SETTLE_MS);
    flush();
    expect(fired).toEqual(["victory"]);
  });

  it("waits for the playback to finish before counting the pause", () => {
    const { gate, fired, flush, pendingCount } = harness(50);
    gate.playbackStart();
    gate.report(() => fired.push("victory"));
    // Идёт проигрывание событий — отсчёт паузы ещё не начат.
    expect(pendingCount()).toBe(0);
    gate.playbackEnd();
    expect(pendingCount()).toBe(1);
    flush();
    expect(fired).toEqual(["victory"]);
  });

  it("keeps waiting while nested playbacks run", () => {
    const { gate, fired, flush, pendingCount } = harness();
    gate.playbackStart();
    gate.playbackStart();
    gate.report(() => fired.push("defeat"));
    gate.playbackEnd();
    expect(pendingCount(), "one playback is still running").toBe(0);
    gate.playbackEnd();
    expect(pendingCount()).toBe(1);
    flush();
    expect(fired).toEqual(["defeat"]);
  });

  it("keeps the first outcome only", () => {
    const { gate, fired, flush } = harness();
    gate.report(() => fired.push("victory"));
    // Повторные сообщения об исходе (ход Нави, конец хода) не удваивают итог.
    gate.report(() => fired.push("victory again"));
    flush();
    expect(fired).toEqual(["victory"]);
  });

  it("drops the pending outcome on reset", () => {
    const { gate, fired, flush, pendingCount } = harness();
    gate.report(() => fired.push("victory"));
    gate.reset();
    expect(pendingCount()).toBe(0);
    flush();
    expect(fired).toEqual([]);
  });

  it("reports the pause so the controls can be hidden and the input locked (0.20.40)", () => {
    const { gate, fired, flush, pendingLog } = harness(50);
    // До исхода паузы нет — кнопки управления видны.
    expect(pendingLog).toEqual([]);
    gate.playbackStart();
    gate.report(() => fired.push("victory"));
    // Исход зафиксирован, но ещё не показан: экран закрывает управление.
    expect(pendingLog).toEqual([true]);
    gate.playbackEnd();
    flush();
    // Итог на экране — пауза кончилась.
    expect(pendingLog).toEqual([true, false]);
    expect(fired).toEqual(["victory"]);
  });

  it("releases the pause on reset even before the outcome is shown", () => {
    const { gate, fired, pendingLog } = harness();
    gate.report(() => fired.push("defeat"));
    expect(pendingLog).toEqual([true]);
    // Выход из боя (размонтирование экрана) не оставляет экран запертым.
    gate.reset();
    expect(pendingLog).toEqual([true, false]);
  });
});
