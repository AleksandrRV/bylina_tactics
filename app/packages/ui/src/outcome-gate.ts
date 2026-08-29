/**
 * Пауза перед итогом боя (0.20.39).
 *
 * Исход партии наступает в момент применения команды, но игроку нужен кадр,
 * чтобы увидеть последние числа урона, гибель противника и понять, что бой
 * закончился: всплывающее число живёт доли секунды, а карточка итога
 * перекрывала поле ещё до того, как доигрывала анимация удара.
 *
 * Правило: итог показывается после того, как проигрывание событий боя
 * закончено, и ещё через {@link OUTCOME_SETTLE_MS}. Пока события играют,
 * отсчёт не идёт (`playbackStart`/`playbackEnd`); если исход зафиксирован
 * вне проигрывания — отсчёт начинается сразу.
 *
 * Модуль чистый: расписание и отмена приходят извне, поэтому правило
 * покрывается тестами без таймеров браузера.
 */

/** Пауза после последней анимации: игрок успевает осознать исход. */
export const OUTCOME_SETTLE_MS = 1000;

export interface OutcomeGateOptions {
  /** Пауза после проигрывания событий (мс). */
  delayMs?: number;
  /**
   * Уведомление о паузе (0.20.40): `true` — исход зафиксирован, но ещё не
   * показан (кнопки управления скрыты, ввод закрыт); `false` — итог на
   * экране или отменён. Вызывается только при смене состояния.
   */
  onPendingChange?: (pending: boolean) => void;
  /** Поставить отложенный вызов; возвращает описатель для отмены. */
  schedule?: (fn: () => void, ms: number) => number;
  /** Отменить отложенный вызов. */
  cancel?: (handle: number) => void;
}

export interface OutcomeGate {
  /**
   * Зафиксировать исход: `show` исполнится после проигрывания событий
   * и паузы. Повторные вызовы ничего не меняют — исход боя один.
   */
  report(show: () => void): void;
  /** Начало проигрывания событий: отсчёт паузы откладывается. */
  playbackStart(): void;
  /** Конец проигрывания событий: отсюда идёт отсчёт паузы. */
  playbackEnd(): void;
  /** Отменить отложенный показ (выход из боя, размонтирование экрана). */
  reset(): void;
}

export function createOutcomeGate(options: OutcomeGateOptions = {}): OutcomeGate {
  const delayMs = options.delayMs ?? OUTCOME_SETTLE_MS;
  const schedule = options.schedule ?? ((fn: () => void, ms: number): number => window.setTimeout(fn, ms));
  const cancel = options.cancel ?? ((handle: number): void => window.clearTimeout(handle));
  const notify = options.onPendingChange ?? ((): void => undefined);
  /** Отложенный показ итога. */
  let pending: (() => void) | null = null;
  /** Исход зафиксирован, но ещё не показан. */
  let waiting = false;
  /** Сколько проигрываний идёт сейчас (вложенные вызовы допустимы). */
  let playing = 0;
  let timer: number | null = null;

  const setWaiting = (next: boolean): void => {
    if (waiting === next) return;
    waiting = next;
    notify(next);
  };

  const arm = (): void => {
    if (timer !== null || playing > 0 || pending === null) return;
    const show = pending;
    pending = null;
    timer = schedule(() => {
      timer = null;
      setWaiting(false);
      show();
    }, delayMs);
  };

  return {
    report(show) {
      if (pending === null) pending = show;
      setWaiting(true);
      arm();
    },
    playbackStart() {
      playing += 1;
    },
    playbackEnd() {
      playing = Math.max(0, playing - 1);
      arm();
    },
    reset() {
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
      pending = null;
      playing = 0;
      setWaiting(false);
    },
  };
}
