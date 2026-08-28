/**
 * Менеджер одноразовых подсказок пролога (doc/campaign.md §13.3).
 * Настройка showHints гасит ненавязчивый слой, но не снимает принуждение.
 */

export interface HintRecord {
  key: string;
  panelKey?: string;
  textKey: string;
  once: boolean;
  /** Принуждение сцены (стойка М2): не гасится showHints. */
  forced?: boolean;
}

export interface HintsManagerState {
  shown: string[];
  queue: string[];
  forcedKey: string | null;
}

export function createHintsManagerState(): HintsManagerState {
  return { shown: [], queue: [], forcedKey: null };
}

export function enqueueHint(
  state: HintsManagerState,
  hint: HintRecord,
  options: { showHints: boolean },
): HintsManagerState {
  if (hint.once && state.shown.includes(hint.key)) return state;
  if (!hint.forced && !options.showHints) return state;
  if (state.queue.includes(hint.key) || state.forcedKey === hint.key) return state;
  if (hint.forced) {
    return { ...state, forcedKey: hint.key, queue: state.queue.filter((key) => key !== hint.key) };
  }
  return { ...state, queue: [...state.queue, hint.key] };
}

export function currentHint(state: HintsManagerState, catalog: readonly HintRecord[]): HintRecord | null {
  const key = state.forcedKey ?? state.queue[0];
  if (!key) return null;
  return catalog.find((hint) => hint.key === key) ?? null;
}

export function dismissHint(state: HintsManagerState, key: string): HintsManagerState {
  const shown = state.shown.includes(key) ? state.shown : [...state.shown, key];
  return {
    shown,
    queue: state.queue.filter((item) => item !== key),
    forcedKey: state.forcedKey === key ? null : state.forcedKey,
  };
}

export function allowedPanel(state: HintsManagerState, catalog: readonly HintRecord[]): string | null {
  const hint = currentHint(state, catalog);
  if (hint?.forced) return hint.panelKey ?? null;
  return null;
}
