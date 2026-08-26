import { useEffect, useState } from "react";
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

/** Системная настройка доступности: едина для DOM и Pixi-слоя боя. */
export function usePrefersReducedMotion(): boolean {
  const read = (): boolean =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  const [reduced, setReduced] = useState(read);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return reduced;
}
