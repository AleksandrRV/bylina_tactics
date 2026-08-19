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
