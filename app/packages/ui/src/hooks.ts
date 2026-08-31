import { useEffect, useRef, useState } from "react";
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
