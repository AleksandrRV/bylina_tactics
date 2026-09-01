import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SessionApi } from "@bylina/session";
import { useServices } from "./context.js";

export function useI18nTick(): void {
  const { i18n } = useServices();
  const [, setTick] = useState(0);
  useEffect(() => i18n.subscribe(() => setTick((value) => value + 1)), [i18n]);
}

export function useSessionState() {
  const { session } = useServices();
  const [state, setState] = useState(session.get());
  useEffect(() => session.subscribe(setState), [session]);
  return state;
}

export function useSettingsState() {
  const { settings } = useServices();
  const [state, setState] = useState(settings.get());
  useEffect(() => settings.subscribe(setState), [settings]);
  return state;
}

/**
 * Монотонный номер боевого состояния (0.21.11, P1-1 часть 2). Подписка на
 * изменения боя через `useSyncExternalStore`: представление перерисовывается
 * один раз на зафиксированное изменение (ревизия ядра у локального хоста,
 * синхронизация снимка у сетевого ведомого), а не клонирует снимок на каждый
 * рендер. Возвращаемый номер служит признаком устаревания для `useMemo` —
 * раньше эти места глушили `exhaustive-deps` и пересчитывались по полям
 * снимка.
 */
export function useBattleRevision(session: SessionApi): number {
  return useSyncExternalStore(
    (onChange) => session.subscribeBattle(onChange),
    () => session.getBattleRevision(),
    () => 0,
  );
}

/**
 * Ссылка на последнее значение (0.20.60): обновляется после каждого кадра.
 *
 * Обработчик, который должен срабатывать редко, но читать свежие данные,
 * иначе обречён на выбор из двух зол: зависимости либо тянут переподписку
 * на каждом кадре, либо держат устаревшее замыкание. Ссылка снимает сам
 * выбор — значение читается в момент события, а не в момент подписки.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
