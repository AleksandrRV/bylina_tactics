export const SETTINGS_STORAGE_KEY = "bylina.settings.v1";

export interface SettingsState {
  language: string;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  fontScale: number;
  highContrast: boolean;
  /** Показывать подсказки и туториалы «первого раза» (0.20.0); по умолчанию включено. */
  showHints: boolean;
}

export const defaultSettings: SettingsState = {
  language: "ru",
  masterVolume: 80,
  musicVolume: 70,
  sfxVolume: 80,
  fontScale: 1,
  highContrast: false,
  showHints: true,
};

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeSettings(
  raw: Partial<SettingsState> | undefined,
  allowedLanguages: readonly string[],
): SettingsState {
  const language =
    raw?.language && allowedLanguages.includes(raw.language)
      ? raw.language
      : allowedLanguages.includes(defaultSettings.language)
        ? defaultSettings.language
        : (allowedLanguages[0] ?? defaultSettings.language);

  return {
    language,
    masterVolume: clamp(Number(raw?.masterVolume ?? defaultSettings.masterVolume), 0, 100),
    musicVolume: clamp(Number(raw?.musicVolume ?? defaultSettings.musicVolume), 0, 100),
    sfxVolume: clamp(Number(raw?.sfxVolume ?? defaultSettings.sfxVolume), 0, 100),
    fontScale: clamp(Number(raw?.fontScale ?? defaultSettings.fontScale), 0.85, 1.4),
    highContrast: Boolean(raw?.highContrast),
    showHints: raw?.showHints !== false,
  };
}

export interface SettingsApi {
  get(): SettingsState;
  set(patch: Partial<SettingsState>): SettingsState;
  subscribe(listener: (state: SettingsState) => void): () => void;
}

export function createSettings(options: {
  storage?: SettingsStorage | null;
  allowedLanguages: readonly string[];
}): SettingsApi {
  let stored: Partial<SettingsState> | undefined;
  if (options.storage) {
    try {
      const raw = options.storage.getItem(SETTINGS_STORAGE_KEY);
      stored = raw ? (JSON.parse(raw) as Partial<SettingsState>) : undefined;
    } catch {
      stored = undefined;
    }
  }

  let state = sanitizeSettings(stored, options.allowedLanguages);
  const listeners = new Set<(state: SettingsState) => void>();

  const persist = (): void => {
    if (!options.storage) return;
    try {
      options.storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* хранилище может быть недоступно */
    }
  };

  persist();

  return {
    get: () => state,
    set: (patch) => {
      state = sanitizeSettings({ ...state, ...patch }, options.allowedLanguages);
      persist();
      for (const listener of listeners) listener(state);
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
