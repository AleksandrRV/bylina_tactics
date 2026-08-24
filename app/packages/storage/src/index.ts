import type { CampaignState } from "@bylina/campaign";
import type { FogState, MatchState } from "@bylina/core";

/**
 * Хранилище прогресса (module-storage, architecture §3.4).
 *
 * Выпуск 0.13.0: запись и чтение кампании и активной партии кампании.
 * Носитель — локальное хранилище обозревателя (браузерный localStorage либо
 * эквивалентный адаптер в среде проверки). Снимок MatchState сериализуется
 * целиком; туман войны — множествами строк по владельцам.
 */

export interface SessionSaveState {
  screen: string;
  battleKind: "quick" | "campaign" | "pvp" | "pvpNet" | "replay" | "training" | null;
  activeMissionId: string | null;
  deployment: number[];
  matchSeed: number;
  outcome: "victory" | "defeat" | null;
  difficulty: string | null;
  /** Пройденные миссии обучения (0.19.0). */
  trainingDone?: string[];
  /** Показанные туториалы «первого раза» кампании (0.20.0). */
  campaignHintsDone?: string[];
}

export interface FogSave {
  [owner: number]: { explored: string[]; visible: string[] };
}

/** Current on-disk shape of a campaign save; independent from APP_VERSION. */
export const SAVE_FORMAT_VERSION = 2;

export interface SaveData {
  /** Explicit on-disk format, migrated by migrateSave on load. */
  formatVersion: number;
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
  /** Writes JSON produced by SaveSerializer without repeating JSON.stringify on the UI thread. */
  saveSerialized(serialized: string): boolean;
  load(): SaveData | null;
  clear(): void;
}

export interface SaveStorageOptions {
  /** Called when browser storage is full; autosave remains non-fatal. */
  onQuotaExceeded?: (error: unknown) => void;
}

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Safari uses code 22, Firefox may use 1014; modern engines use the name. */
export function isQuotaExceededError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "QuotaExceededError" || candidate.code === 22 || candidate.code === 1014;
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
    typeof candidate.formatVersion === "number" &&
    candidate.formatVersion === SAVE_FORMAT_VERSION &&
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

/**
 * Upgrades persisted data in small explicit steps. Format 1 predates the
 * formatVersion field; it is otherwise structurally identical to format 2.
 * Unknown future formats are rejected rather than silently corrupted.
 */
export function migrateSave(value: unknown): SaveData | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<SaveData> & { formatVersion?: unknown };
  const sourceVersion = candidate.formatVersion === undefined ? 1 : candidate.formatVersion;
  if (sourceVersion !== 1 && sourceVersion !== SAVE_FORMAT_VERSION) return null;
  const migrated = sourceVersion === 1 ? { ...candidate, formatVersion: SAVE_FORMAT_VERSION } : candidate;
  return isSaveData(migrated) ? migrated : null;
}

/** Ключ списка повторов партий (0.17.0). */
export const DEFAULT_REPLAYS_KEY = "bylina.replays.v1";

export interface ReplayStorage {
  listReplays(): unknown[];
  saveReplay(journal: unknown): boolean;
  deleteReplay(createdAt: number): void;
  clearReplays(): void;
}

/** Хранилище повторов: массив журналов в том же backend (0.17.0). */
export function createReplayStorage(key: string = DEFAULT_REPLAYS_KEY, backend?: StorageBackend): ReplayStorage {
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
  const read = (): unknown[] => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (replays: unknown[]): boolean => {
    try {
      storage.setItem(key, JSON.stringify(replays));
      return true;
    } catch {
      return false;
    }
  };
  return {
    listReplays: () => read(),
    saveReplay: (journal) => {
      const replays = read();
      // Не более 20 сохранённых повторов.
      replays.unshift(journal);
      if (replays.length > 20) replays.length = 20;
      return write(replays);
    },
    deleteReplay: (createdAt) => {
      write(read().filter((entry) => (entry as { createdAt?: number }).createdAt !== createdAt));
    },
    clearReplays: () => {
      write([]);
    },
  };
}

export const DEFAULT_SAVE_KEY = "bylina.save.v1";

export function createSaveStorage(key: string = DEFAULT_SAVE_KEY, backend?: StorageBackend, options: SaveStorageOptions = {}): SaveStorage {
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

  const write = (serialized: string): boolean => {
    try {
      storage.setItem(key, serialized);
      return true;
    } catch (error) {
      // Full localStorage must never break a turn or leave the UI in an error state.
      if (isQuotaExceededError(error)) options.onQuotaExceeded?.(error);
      return false;
    }
  };

  return {
    save: (data) => write(JSON.stringify(data)),
    saveSerialized: (serialized) => write(serialized),
    load: () => {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        const migrated = migrateSave(parsed);
        if (!migrated) return null;
        // Persist a successful migration immediately, so it runs once.
        if ((parsed as { formatVersion?: unknown }).formatVersion !== SAVE_FORMAT_VERSION) write(JSON.stringify(migrated));
        return migrated;
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

/** A save before fog sets are converted to JSON-safe arrays. */
export type SaveDraft = Omit<SaveData, "fog"> & { fog?: FogState };

/** Performs the expensive JSON conversion performed by the save worker. */
export function serializeSaveDraft(data: SaveDraft): string {
  const { fog, ...save } = data;
  return JSON.stringify({ ...save, fog: fog ? serializeFog(fog) : undefined });
}

export interface SaveSerializer {
  /** Serializes MatchState and fog off the UI thread where Workers are available. */
  serialize(data: SaveDraft): Promise<string>;
  dispose(): void;
}

type WorkerRequest = { id: number; data: SaveDraft };
type WorkerResponse = { id: number; serialized?: string; error?: string };

/**
 * Creates the asynchronous serializer used by autosave. The synchronous fallback
 * is retained for SSR and test runners which do not provide Web Workers.
 */
export function createSaveSerializer(): SaveSerializer {
  if (typeof Worker === "undefined") {
    return {
      serialize: async (data) => serializeSaveDraft(data),
      dispose: () => undefined,
    };
  }

  try {
    const worker = new Worker(new URL("./save-worker.ts", import.meta.url), { type: "module" });
    let nextId = 1;
    const pending = new Map<number, { resolve: (value: string) => void; reject: (reason: Error) => void }>();
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.serialized !== undefined) request.resolve(data.serialized);
      else request.reject(new Error(data.error ?? "Save worker serialization failed"));
    };
    worker.onerror = () => {
      for (const request of pending.values()) request.reject(new Error("Save worker failed"));
      pending.clear();
    };
    return {
      serialize: (data) => new Promise<string>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, data } satisfies WorkerRequest);
      }),
      dispose: () => {
        worker.terminate();
        for (const request of pending.values()) request.reject(new Error("Save worker disposed"));
        pending.clear();
      },
    };
  } catch {
    return {
      serialize: async (data) => serializeSaveDraft(data),
      dispose: () => undefined,
    };
  }
}
