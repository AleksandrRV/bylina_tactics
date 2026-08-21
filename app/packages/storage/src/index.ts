import type { CampaignState } from "@bylina/campaign";
import type { FogState, MatchState } from "@bylina/core";

/**
 * Хранилище прогресса (module-storage, tech-core §3.4).
 *
 * Выпуск 0.13.0: запись и чтение кампании и активной партии кампании.
 * Носитель — локальное хранилище обозревателя (браузерный localStorage либо
 * эквивалентный адаптер в среде проверки). Снимок MatchState сериализуется
 * целиком; туман войны — множествами строк по владельцам.
 */

export interface SessionSaveState {
  screen: string;
  battleKind: "quick" | "campaign" | null;
  activeMissionId: string | null;
  deployment: number[];
  matchSeed: number;
  outcome: "victory" | "defeat" | null;
  difficulty: string | null;
}

export interface FogSave {
  [owner: number]: { explored: string[]; visible: string[] };
}

export interface SaveData {
  /** Версия приложения, создавшего запись (0.13.0). */
  version: string;
  savedAt: number;
  campaign: CampaignState;
  session: SessionSaveState;
  /** Активная партия кампании (только для экрана сражения). */
  match?: MatchState;
  fog?: FogSave;
}

export interface SaveStorage {
  save(data: SaveData): boolean;
  load(): SaveData | null;
  clear(): void;
}

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Сериализация тумана войны: множества → массивы строк. */
export function serializeFog(fog: FogState): FogSave {
  const result: FogSave = {};
  for (const rawOwner of Object.keys(fog)) {
    const owner = Number(rawOwner);
    const entry = fog[owner];
    if (!entry) continue;
    result[owner] = {
      explored: [...entry.explored],
      visible: [...entry.visible],
    };
  }
  return result;
}

/** Восстановление тумана войны: массивы строк → множества. */
export function deserializeFog(fog: FogSave | undefined): FogState | undefined {
  if (!fog) return undefined;
  const result: FogState = {};
  for (const rawOwner of Object.keys(fog)) {
    const owner = Number(rawOwner);
    const entry = fog[owner];
    if (!entry) continue;
    result[owner] = {
      explored: new Set(entry.explored ?? []),
      visible: new Set(entry.visible ?? []),
    };
  }
  return result;
}

/** Минимальная проверка структуры записи: без неё сохранение не загружается. */
export function isSaveData(value: unknown): value is SaveData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SaveData>;
  return (
    typeof candidate.version === "string" &&
    typeof candidate.savedAt === "number" &&
    typeof candidate.campaign === "object" &&
    candidate.campaign !== null &&
    Array.isArray(candidate.campaign.fighters) &&
    Array.isArray(candidate.campaign.missions) &&
    typeof candidate.session === "object" &&
    candidate.session !== null &&
    Array.isArray(candidate.session.deployment)
  );
}

export const DEFAULT_SAVE_KEY = "bylina.save.v1";

export function createSaveStorage(key: string = DEFAULT_SAVE_KEY, backend?: StorageBackend): SaveStorage {
  const storage = backend ?? {
    getItem: (storageKey) => {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(storageKey);
    },
    setItem: (storageKey, value) => {
      if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, value);
    },
    removeItem: (storageKey) => {
      if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey);
    },
  };

  return {
    save: (data) => {
      try {
        storage.setItem(key, JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
    load: () => {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isSaveData(parsed)) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    clear: () => {
      try {
        storage.removeItem(key);
      } catch {
        /* хранилище недоступно */
      }
    },
  };
}
