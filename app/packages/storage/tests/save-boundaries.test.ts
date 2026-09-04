/**
 * День 10 (0.21.9, P1-4 часть 2): граница хранения.
 *
 * - миграция 1 → 2: запись без `formatVersion` поднимается и читается;
 * - неизвестный будущий формат отклоняется (а не читается как мусор);
 * - переполнение хранилища (QuotaExceededError) не роняет игру и сообщается;
 * - валидация `SaveData.match` (Major-5): испорченный снимок партии
 *   отклоняется чисто на загрузке, а не падает внутри ядра.
 */
import { describe, expect, it, vi } from "vitest";
import { createTacticsKernel, createQuickMatch, type MatchState } from "@bylina/core";
import { createSaveStorage, isMatchSnapshot, isSaveData, migrateSave, type SaveData } from "../src/index.js";

/** In-memory backend без локального хранилища. */
function memoryBackend(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    _map: map,
  };
}

/** Корректная кампания/сессия как основа записи. */
function baseSave(): SaveData {
  return {
    formatVersion: 2,
    version: "0.21.9",
    savedAt: 42,
    campaign: {
      chapter: "open",
      darkness: 4,
      darknessMax: 20,
      phase: "active",
      resources: { gold: 1, herbs: 0, artifacts: 0 },
      inventory: [],
      shipPosition: { x: 0, y: 0 },
      missions: [],
      fighters: [],
      deadGenerals: [],
      activeMissionId: null,
      lastResult: null,
    },
    session: {
      screen: "campaign",
      battleKind: "campaign",
      activeMissionId: null,
      deployment: [],
      matchSeed: 7,
      outcome: null,
      difficulty: null,
    },
  };
}

/** Настоящий снимок партии из ядра: заведомо валиден для isMatchSnapshot. */
function realMatch(seed = 7): MatchState {
  const kernel = createTacticsKernel({ initial: createQuickMatch({ enemyCount: 2, seed }), seed });
  return kernel.getSnapshot();
}

describe("миграция формата сохранений", () => {
  it("поднимает запись v1 (без formatVersion) до текущего формата", () => {
    const v1 = baseSave() as unknown as Record<string, unknown>;
    delete v1.formatVersion;
    const migrated = migrateSave(v1);
    expect(migrated).not.toBeNull();
    expect(migrated?.formatVersion).toBe(2);
    expect(isSaveData(migrated)).toBe(true);
  });

  it("мигрированная запись v1 проходит полную валидацию записи", () => {
    const v1 = baseSave() as unknown as Record<string, unknown>;
    delete v1.formatVersion;
    // После миграции структура та же, поэтому isSaveData принимает её как v2.
    expect(isSaveData(migrateSave(v1))).toBe(true);
  });

  it("отклоняет неизвестный будущий формат", () => {
    const future = { ...baseSave(), formatVersion: 99 };
    expect(migrateSave(future)).toBeNull();
    expect(isSaveData(future)).toBe(false);
  });

  it("отклоняет формат 0 и отрицательные номера", () => {
    expect(migrateSave({ ...baseSave(), formatVersion: 0 })).toBeNull();
    expect(migrateSave({ ...baseSave(), formatVersion: -1 })).toBeNull();
  });
});

describe("валидация SaveData.match (Major-5)", () => {
  it("принимает настоящий снимок партии из ядра", () => {
    const save = { ...baseSave(), match: realMatch() };
    expect(isMatchSnapshot(save.match)).toBe(true);
    expect(isSaveData(save)).toBe(true);
  });

  it("принимает запись без match (кампания вне боя)", () => {
    expect(isMatchSnapshot(undefined)).toBe(false);
    expect(isSaveData(baseSave())).toBe(true);
  });

  it("отклоняет match без сетки", () => {
    const bad = { ...realMatch() } as Partial<MatchState>;
    delete bad.grid;
    expect(isMatchSnapshot(bad)).toBe(false);
    expect(isSaveData({ ...baseSave(), match: bad })).toBe(false);
  });

  it("отклоняет match с не-массивом клеток", () => {
    const bad = { ...realMatch(), grid: { width: 6, height: 6, tiles: "nope" } } as unknown as MatchState;
    expect(isMatchSnapshot(bad)).toBe(false);
    expect(isSaveData({ ...baseSave(), match: bad })).toBe(false);
  });

  it("отклоняет match с клеткой без координат", () => {
    const good = realMatch();
    const tiles = [...good.grid.tiles];
    tiles[0] = { pit: false, blockLOS: false } as MatchState["grid"]["tiles"][number];
    const bad = { ...good, grid: { ...good.grid, tiles } };
    expect(isMatchSnapshot(bad)).toBe(false);
    expect(isSaveData({ ...baseSave(), match: bad })).toBe(false);
  });

  it("отклоняет match с сущностью без числовых полей", () => {
    const good = realMatch();
    const bad = {
      ...good,
      entities: [{ id: "x", configId: 1, owner: "me" }],
    } as unknown as MatchState;
    expect(isMatchSnapshot(bad)).toBe(false);
    expect(isSaveData({ ...baseSave(), match: bad })).toBe(false);
  });

  it("отклоняет match с не-массивом сущностей", () => {
    const bad = { ...realMatch(), entities: { 0: realMatch().entities[0] } } as unknown as MatchState;
    expect(isMatchSnapshot(bad)).toBe(false);
    expect(isSaveData({ ...baseSave(), match: bad })).toBe(false);
  });

  it("отклоняет match с битой строкой состояния ГПСЧ", () => {
    const bad = { ...realMatch(), rngState: "not-a-number" } as MatchState;
    expect(isMatchSnapshot(bad)).toBe(false);
    expect(isSaveData({ ...baseSave(), match: bad })).toBe(false);
  });

  it("загрузка испорченного match возвращает null, а не бросает", () => {
    const corrupted = { ...baseSave(), match: { turnNumber: 1, activeOwner: 1 } };
    const backend = memoryBackend({ "bylina.save.bad": JSON.stringify(corrupted) });
    const storage = createSaveStorage("bylina.save.bad", backend);
    // Чистый отказ: load() не падает и не отдаёт мусор ядру.
    expect(() => storage.load()).not.toThrow();
    expect(storage.load()).toBeNull();
  });

  it("загрузка валидного match возвращает запись целиком", () => {
    const save = { ...baseSave(), match: realMatch() };
    const backend = memoryBackend({ "bylina.save.ok": JSON.stringify(save) });
    const storage = createSaveStorage("bylina.save.ok", backend);
    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.match?.entities.length).toBe(save.match.entities.length);
  });
});

describe("валидация SaveData.prologueProgress", () => {
  const progress = {
    run: {
      objectiveKey: "prologue.objective.gather",
      outcome: "ongoing" as const,
      pickupDone: true,
      script: { index: 0 },
    },
    firedCutscenes: ["m1_intro"],
    introSeen: true,
  };

  it("принимает запись с целым прогрессом сюжетной сцены", () => {
    const save = { ...baseSave(), prologueProgress: progress } as SaveData;
    expect(isSaveData(save)).toBe(true);
  });

  it("отклоняет запись с битым прогрессом без миграции", () => {
    expect(isSaveData({ ...baseSave(), prologueProgress: { introSeen: "yes" } })).toBe(false);
  });

  it("migrateSave снимает битый прогресс и оставляет остальную запись", () => {
    const migrated = migrateSave({ ...baseSave(), prologueProgress: { introSeen: true } });
    expect(migrated).not.toBeNull();
    expect(migrated?.prologueProgress).toBeUndefined();
    expect(migrated?.campaign.darkness).toBe(4);
  });

  it("загрузка с битым прогрессом возвращает запись без поля, а не null", () => {
    const corrupted = { ...baseSave(), prologueProgress: { firedCutscenes: "m1_intro" } };
    const backend = memoryBackend({ "bylina.save.prologue.bad": JSON.stringify(corrupted) });
    const storage = createSaveStorage("bylina.save.prologue.bad", backend);
    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.prologueProgress).toBeUndefined();
    expect(loaded?.campaign.fighters).toEqual([]);
  });

  it("загрузка с целым прогрессом возвращает поле целиком", () => {
    const save = { ...baseSave(), prologueProgress: progress } as SaveData;
    const backend = memoryBackend({ "bylina.save.prologue.ok": JSON.stringify(save) });
    const storage = createSaveStorage("bylina.save.prologue.ok", backend);
    const loaded = storage.load();
    expect(loaded?.prologueProgress?.introSeen).toBe(true);
    expect(loaded?.prologueProgress?.firedCutscenes).toEqual(["m1_intro"]);
    expect(loaded?.prologueProgress?.run.pickupDone).toBe(true);
  });
});

describe("переполнение хранилища не прерывает игру", () => {
  it("save() при QuotaExceededError возвращает false и сообщает колбэку", () => {
    const quotaError = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const onQuotaExceeded = vi.fn();
    const backend = {
      getItem: () => null,
      setItem: () => {
        throw quotaError;
      },
      removeItem: () => undefined,
    };
    const storage = createSaveStorage("bylina.quota", backend, { onQuotaExceeded });
    let returned: boolean | undefined;
    expect(() => {
      returned = storage.save(baseSave());
    }).not.toThrow();
    expect(returned).toBe(false);
    expect(onQuotaExceeded).toHaveBeenCalledWith(quotaError);
  });

  it("код 22 (Safari) и 1014 (Firefox) тоже распознаются как переполнение", () => {
    for (const code of [22, 1014]) {
      const onQuotaExceeded = vi.fn();
      const backend = {
        getItem: () => null,
        setItem: () => {
          throw Object.assign(new Error("full"), { code });
        },
        removeItem: () => undefined,
      };
      const storage = createSaveStorage("bylina.quota.code", backend, { onQuotaExceeded });
      expect(storage.save(baseSave())).toBe(false);
      expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    }
  });

  it("прочие ошибки записи не принимаются за переполнение и не зовут колбэк", () => {
    const onQuotaExceeded = vi.fn();
    const backend = {
      getItem: () => null,
      setItem: () => {
        throw new Error("permission denied");
      },
      removeItem: () => undefined,
    };
    const storage = createSaveStorage("bylina.other", backend, { onQuotaExceeded });
    expect(storage.save(baseSave())).toBe(false);
    expect(onQuotaExceeded).not.toHaveBeenCalled();
  });
});
