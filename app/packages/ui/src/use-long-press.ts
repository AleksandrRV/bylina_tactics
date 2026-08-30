/**
 * Долгое нажатие — общий жест экрана боя (0.20.53).
 *
 * Прежде жест жил внутри кнопки действия: таймер, отмена при сдвиге
 * пальца и подавление обычного клика. Окно информации о бойце требует
 * того же поведения на портретах, поэтому жест вынесен сюда и работает
 * одинаково для слота действия, карточки дружины и портрета противника
 * в полосе верхней панели.
 *
 * Правила неизменны: удержание дольше порога открывает окно и съедает
 * клик (действие или выбор бойца не срабатывает), сдвиг пальца дальше
 * допуска считается прокруткой ленты и жест отменяется, правый клик —
 * тот же жест для мыши.
 */

import { useCallback, useEffect, useRef } from "react";

/** Длительность долгого нажатия: длиннее обычного клика, короче ожидания. */
export const LONG_PRESS_MS = 420;
/** Допустимый сдвиг пальца: больше — нажатие считают прокруткой ленты. */
const MOVE_TOLERANCE_PX = 10;

export interface LongPressOptions {
  /** Открыть окно информации; без обработчика жест не отслеживается. */
  onLongPress?: (() => void) | undefined;
  /** Обычный клик: исполняется, только если удержание не сработало. */
  onClick?: (() => void) | undefined;
  /** Длительность удержания; по умолчанию общая для экрана боя. */
  ms?: number;
}

/** Обработчики указателя: навешиваются на кнопку целиком. */
export interface LongPressHandlers {
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerUp: React.PointerEventHandler<HTMLElement>;
  onPointerLeave: React.PointerEventHandler<HTMLElement>;
  onPointerCancel: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onContextMenu: React.MouseEventHandler<HTMLElement>;
}

export interface LongPress {
  handlers: LongPressHandlers;
  /** Клик с подавлением: после удержания действие не исполняется. */
  onClick: () => void;
}

export function useLongPress(options: LongPressOptions = {}): LongPress {
  const { onLongPress, onClick, ms = LONG_PRESS_MS } = options;
  /** Удержание уже открыло окно: обычный клик после него не срабатывает. */
  const firedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const fire = useCallback((): void => {
    cancel();
    if (!onLongPress) return;
    firedRef.current = true;
    onLongPress();
  }, [cancel, onLongPress]);

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>(
    (event) => {
      firedRef.current = false;
      if (!onLongPress) return;
      originRef.current = { x: event.clientX, y: event.clientY };
      cancel();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        fire();
      }, ms);
    },
    [cancel, fire, ms, onLongPress],
  );

  const onPointerMove = useCallback<React.PointerEventHandler<HTMLElement>>(
    (event) => {
      const origin = originRef.current;
      if (!origin) return;
      if (
        Math.abs(event.clientX - origin.x) > MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - origin.y) > MOVE_TOLERANCE_PX
      ) {
        cancel();
      }
    },
    [cancel],
  );

  const onContextMenu = useCallback<React.MouseEventHandler<HTMLElement>>(
    (event) => {
      event.preventDefault();
      fire();
    },
    [fire],
  );

  const handleClick = useCallback((): void => {
    if (firedRef.current) {
      firedRef.current = false;
      return;
    }
    onClick?.();
  }, [onClick]);

  return {
    handlers: {
      onPointerDown,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onPointerMove,
      onContextMenu,
    },
    onClick: handleClick,
  };
}
