import type { CampaignState } from "@bylina/campaign";
import { isPrologueProgress, type FogState, type MatchState, type PrologueProgress } from "@bylina/core";

/**
 * Хранилище прогресса (module-storage, architecture §3.4).
 *
 * Выпуск 0.13.0: запись и чтение кампании и активной партии кампании.
 * Носитель — локальное хранилище обозревателя (браузерный localStorage либо
 * эквивалентный адаптер в среде проверки). Снимок MatchState сериализуется
 * целиком; туман войны — множествами строк по владельцам.
 */

interface SessionSaveState {
  screen: string;
  battleKind: "quick" | "campaign" | "pvp" | "pvpNet" | "replay" | "training" | "prologue" | null;
  /**
   * Сюжетная миссия пролога, в которой игрок вышел из боя (0.20.51).
   * Пролог — не точка карты кампании, поэтому её идентификатор живёт
   * отдельно от `activeMissionId`; без него выход из сюжетного боя
   * выбрасывал игрока из начатой былины.
   */
  prologueMissionId?: string | null;
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

interface FogSave {
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
  /**
   * Прогресс сюжетной сцены пролога (сценарий, сыгранные катсцены,
   * видел ли игрок вступление). Поле необязательное и аддитивное:
   * записи без него читаются как прежде, битое значение отбрасывается.
   */
  prologueProgress?: PrologueProgress;
}

interface SaveStorage {
  save(data: SaveData): boolean;
  /** Writes JSON produced by SaveSerializer without repeating JSON.stringify on the UI thread. */
  saveSerialized(serialized: string): boolean;
  load(): SaveData | null;
  clear(): void;
}

interface SaveStorageOptions {
  /** Called when browser storage is full; autosave remains non-fatal. */
  onQuotaExceeded?: (error: unknown) => void;
}

interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Браузерный localStorage как StorageBackend. Вынесен в одно место: одинаковое
 * замыкание использовалось и в хранилище сохранений, и в хранилище повторов.
 * В среде без обозревателя (SSR, тесты без адаптера) чтение даёт null, а
 * запись молча не выполняется — вызывающий трактует это как «не сохранено».
 */
export function createLocalStorageBackend(): StorageBackend {
  return {
    getItem: (key) => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
    setItem: (key, value) => {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    },
    removeItem: (key) => {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    },
  };
}

/** Safari uses code 22, Firefox may use 1014; modern engines use the name. */
function isQuotaExceededError(error: unknown): boolean {
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

/**
 * Проверка снимка партии внутри сохранения (0.21.9, Major-5). Прежде
 * `match` не валидировался вовсе: испорченная/частично записанная запись
 * отдавалась ядру как `initial` и роняла его глубоко внутри (обращение к
 * полю сущности, парсинг состояния ГПСЧ). Граница хранения обязана
 * принять только структурно целый снимок; мусор отклоняется чисто, и
 * автосохранение не оставляет игру с битыми данными.
 *
 * Проверка намеренно структурная, а не схема Zod: `MatchState` определён в
 * ядре, а зеркалить всю форму в Zod значило бы дублировать контракт и
 * рассинхронизироваться при его изменении. Zod уже стережёт границу
 * контента (`@bylina/content`), где схема — это и формат внешних файлов;
 * здесь же форма — внутренний тип ядра, и достаточно проверить форму
 * вложенных структур, к которым обращается ядро при загрузке.
 */
export function isMatchSnapshot(value: unknown): value is MatchState {
  if (typeof value !== "object" || value === null) return false;
  const match = value as Partial<MatchState>;
  if (typeof match.turnNumber !== "number" || typeof match.activeOwner !== "number") return false;
  // Сетка: размеры и массив клеток с координатами. Значение приходит извне,
  // поэтому типы структурных полей проверяем фактическими проверками ниже.
  const grid = match.grid as { width?: unknown; height?: unknown; tiles?: unknown } | undefined;
  if (
    typeof grid !== "object" ||
    grid === null ||
    typeof grid.width !== "number" ||
    typeof grid.height !== "number" ||
    !Array.isArray(grid.tiles)
  ) {
    return false;
  }
  const tiles = grid.tiles as unknown[];
  const tileOk = tiles.every((raw) => {
    if (typeof raw !== "object" || raw === null) return false;
    const tile = raw as Record<string, unknown>;
    return (
      typeof tile.x === "number" &&
      typeof tile.y === "number" &&
      typeof tile.z === "number" &&
      typeof tile.pit === "boolean" &&
      typeof tile.blockLOS === "boolean"
    );
  });
  if (!tileOk) return false;
  // Сущности: числовые поля, к которым ядро обращается без проверки.
  if (!Array.isArray(match.entities)) return false;
  const entities = match.entities as unknown[];
  const entitiesOk = entities.every((raw) => {
    if (typeof raw !== "object" || raw === null) return false;
    const entity = raw as Record<string, unknown>;
    return (
      typeof entity.id === "number" &&
      typeof entity.configId === "string" &&
      typeof entity.owner === "number" &&
      typeof entity.x === "number" &&
      typeof entity.y === "number" &&
      typeof entity.z === "number" &&
      typeof entity.hp === "number" &&
      typeof entity.ap === "number" &&
      typeof entity.weaponId === "string"
    );
  });
  if (!entitiesOk) return false;
  // Состояние ГПСЧ ядро парсит как число — битая строка уронила бы загрузку.
  if (match.rngState !== undefined) {
    if (typeof match.rngState !== "string" || !/^\d+$/.test(match.rngState)) return false;
  }
  if (match.rngSeed !== undefined && typeof match.rngSeed !== "string") return false;
  return true;
}

/** Минимальная проверка структуры записи: без неё сохранение не загружается. */
export function isSaveData(value: unknown): value is SaveData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SaveData>;
  if (
    typeof candidate.formatVersion !== "number" ||
    candidate.formatVersion !== SAVE_FORMAT_VERSION ||
    typeof candidate.version !== "string" ||
    typeof candidate.savedAt !== "number" ||
    typeof candidate.campaign !== "object" ||
    candidate.campaign === null ||
    !Array.isArray(candidate.campaign.fighters) ||
    !Array.isArray(candidate.campaign.missions) ||
    typeof candidate.session !== "object" ||
    candidate.session === null ||
    !Array.isArray(candidate.session.deployment)
  ) {
    return false;
  }
  // Снимок партии, если он есть, обязан быть структурно целым (Major-5):
  // иначе ядро получает мусор как initial и падает внутри.
  if (candidate.match !== undefined && !isMatchSnapshot(candidate.match)) return false;
  // Прогресс пролога — необязателен; битое значение отклоняет запись,
  // migrateSave снимает его раньше, чтобы не ронять всю былину.
  if (candidate.prologueProgress !== undefined && !isPrologueProgress(candidate.prologueProgress)) return false;
  return true;
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
  // Битое поле прогресса пролога не должно ронять всю запись: снимаем его.
  if (
    typeof migrated === "object" &&
    migrated !== null &&
    "prologueProgress" in migrated &&
    migrated.prologueProgress !== undefined &&
    !isPrologueProgress(migrated.prologueProgress)
  ) {
    const { prologueProgress: _dropped, ...rest } = migrated as SaveData & { prologueProgress?: unknown };
    void _dropped;
    return isSaveData(rest) ? rest : null;
  }
  return isSaveData(migrated) ? migrated : null;
}

/** Ключ списка повторов партий (0.17.0). */
const DEFAULT_REPLAYS_KEY = "bylina.replays.v1";

export interface ReplayStorage {
  listReplays(): unknown[];
  saveReplay(journal: unknown): boolean;
  /** Удаляет повтор; false, если запись не удалась (переполнение/недоступность). */
  deleteReplay(createdAt: number): boolean;
  /** Очищает все повторы; false, если запись не удалась. */
  clearReplays(): boolean;
}

/** Хранилище повторов: массив журналов в том же backend (0.17.0). */
export function createReplayStorage(
  key: string = DEFAULT_REPLAYS_KEY,
  backend?: StorageBackend,
  options: SaveStorageOptions = {},
): ReplayStorage {
  const storage = backend ?? createLocalStorageBackend();
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
    } catch (error) {
      // Переполнение при записи повторов так же не должно ломать ход
      // (0.21.2): подписчик сообщает об этом интерфейсу, как и для сохранений.
      if (isQuotaExceededError(error)) options.onQuotaExceeded?.(error);
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
    deleteReplay: (createdAt) =>
      write(read().filter((entry) => (entry as { createdAt?: number }).createdAt !== createdAt)),
    clearReplays: () => write([]),
  };
}

const DEFAULT_SAVE_KEY = "bylina.save.v1";

export function createSaveStorage(
  key: string = DEFAULT_SAVE_KEY,
  backend?: StorageBackend,
  options: SaveStorageOptions = {},
): SaveStorage {
  const storage = backend ?? createLocalStorageBackend();

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
        if ((parsed as { formatVersion?: unknown }).formatVersion !== SAVE_FORMAT_VERSION)
          write(JSON.stringify(migrated));
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

interface SaveSerializer {
  /** Serializes MatchState and fog off the UI thread where Workers are available. */
  serialize(data: SaveDraft): Promise<string>;
  dispose(): void;
}

type WorkerRequest = { id: number; data: SaveDraft };
type WorkerResponse = { id: number; serialized?: string; error?: string };

/**
 * Creates the asynchronous serializer used by autosave. The synchronous fallback
 * is retained for SSR and test runners which do not provide Web Workers.
 *
 * 0.21.3 (P0-3): рабочий поток может умереть после одной ошибки либо
 * перестать отвечать. Раньше `onerror` отклонял ожидавшие промисы, но не
 * помечал поток мёртвым — каждый следующий `serialize()` клал промис в карту,
 * который уже никогда не разрешался: автосохранение молчало вечно, а карта
 * росла. Теперь после ошибки или тайм-аутa молчания сериализация выполняется
 * синхронно в главном потоке (кадровый провал предпочтительнее тихой потери
 * сохранения), а промис не висит дольше `timeoutMs`.
 */
export function createSaveSerializer(options: { timeoutMs?: number } = {}): SaveSerializer {
  const timeoutMs = options.timeoutMs ?? 4000;
  if (typeof Worker === "undefined") {
    return {
      serialize: async (data) => serializeSaveDraft(data),
      dispose: () => undefined,
    };
  }

  try {
    const worker = new Worker(new URL("./save-worker.ts", import.meta.url), { type: "module" });
    let nextId = 1;
    let workerAlive = true;
    const pending = new Map<
      number,
      { resolve: (value: string) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }
    >();
    /**
     * Откат на синхронную сериализацию в главном потоке. Поток JSON — единицы
     * микросекунд на снимках этой игры, поэтому цена отката — возможный
     * кадровый провал, а не потеря хода.
     */
    const fallback = (data: SaveDraft): string => {
      console.warn("[save] рабочий поток сериализации недоступен — откат на главный поток");
      return serializeSaveDraft(data);
    };
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.serialized !== undefined) request.resolve(data.serialized);
      else request.reject(new Error(data.error ?? "Save worker serialization failed"));
    };
    worker.onerror = () => {
      // Поток потерян немедленно: помечаем мёртвым, чтобы дальнейшие
      // сериализации шли синхронно, а не висели вечно.
      workerAlive = false;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Save worker failed"));
      }
      pending.clear();
    };
    return {
      serialize: (data) => {
        // Мёртвый поток: не кладём промис в карту — сериализуем сразу.
        if (!workerAlive) return Promise.resolve(fallback(data));
        return new Promise<string>((resolve, reject) => {
          const id = nextId++;
          const timer = setTimeout(() => {
            // Молчание потока дольше timeoutMs — он фактически неработоспособен
            // (сериализация снимка занимает микросекунды). Переключаемся на
            // главный поток, чтобы автосохранение не зависело от потока.
            workerAlive = false;
            pending.delete(id);
            resolve(fallback(data));
          }, timeoutMs);
          pending.set(id, {
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (reason) => {
              clearTimeout(timer);
              reject(reason);
            },
            timer,
          });
          worker.postMessage({ id, data } satisfies WorkerRequest);
        });
      },
      dispose: () => {
        worker.terminate();
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error("Save worker disposed"));
        }
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
