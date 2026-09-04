import { describe, expect, it, vi } from "vitest";
import {
  createReplayStorage,
  createSaveStorage,
  deserializeFog,
  isSaveData,
  migrateSave,
  serializeFog,
  type SaveData,
} from "../src/index.js";
import type { CampaignState } from "@bylina/campaign";
import type { FogState, MatchState } from "@bylina/core";

function memoryBackend() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function sampleSave(): SaveData {
  return {
    formatVersion: 2,
    version: "0.13.0",
    savedAt: 123,
    campaign: {
      chapter: "open",
      darkness: 4,
      darknessMax: 20,
      phase: "active",
      resources: { gold: 10, herbs: 2, artifacts: 1 },
      inventory: [],
      shipPosition: { x: 13, y: 64 },
      missions: [{ id: "clearing_1", status: "done" }],
      fighters: [
        {
          id: 1,
          name: "Ратибор",
          unitId: "bogatyr",
          level: 3,
          hp: 10,
          maxHp: 12,
          wounded: false,
          alive: true,
          equippedItemId: null,
          xp: 0,
          talents: ["iron_hide"],
          pendingTalentLevels: [],
        },
      ],
      deadGenerals: [],
      activeMissionId: null,
      lastResult: null,
    },
    session: {
      screen: "campaign",
      battleKind: "campaign",
      activeMissionId: null,
      deployment: [],
      matchSeed: 42,
      outcome: null,
      difficulty: null,
      trainingDone: ["movement"],
      campaignHintsDone: ["darkness", "scan"],
    },
  };
}

describe("createSaveStorage", () => {
  it("round-trips a save through the backend", () => {
    const backend = memoryBackend();
    const storage = createSaveStorage("bylina.test.v1", backend);
    const save = sampleSave();
    expect(storage.save(save)).toBe(true);
    const loaded = storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.campaign.fighters[0]?.name).toBe("Ратибор");
    // Таланты бойца (0.21.30) переживают сохранение как есть.
    expect(loaded?.campaign.fighters[0]?.talents).toEqual(["iron_hide"]);
    expect(loaded?.session.screen).toBe("campaign");
    expect(loaded?.session.trainingDone).toEqual(["movement"]);
    expect(loaded?.session.campaignHintsDone).toEqual(["darkness", "scan"]);
  });

  it("returns null when the record is missing or broken", () => {
    const backend = memoryBackend();
    const storage = createSaveStorage("bylina.test.v1", backend);
    expect(storage.load()).toBeNull();
    backend.setItem("bylina.test.v1", "{ not json");
    expect(storage.load()).toBeNull();
    backend.setItem("bylina.test.v1", JSON.stringify({ version: "0.13.0" }));
    expect(storage.load()).toBeNull();
  });

  it("clears the record", () => {
    const backend = memoryBackend();
    const storage = createSaveStorage("bylina.test.v1", backend);
    storage.save(sampleSave());
    storage.clear();
    expect(storage.load()).toBeNull();
  });

  it("round-trips fog sets through serialization", () => {
    const fog: FogState = {
      1: { explored: new Set(["0,0", "1,1"]), visible: new Set(["0,0"]) },
      2: { explored: new Set(["9,9"]), visible: new Set<string>() },
    };
    const serialized = serializeFog(fog);
    const restored = deserializeFog(serialized);
    expect(restored?.[1]?.explored.has("1,1")).toBe(true);
    expect(restored?.[2]?.visible.size).toBe(0);
    expect(restored?.[1]?.visible.has("0,0")).toBe(true);
  });
});

describe("isSaveData", () => {
  it("accepts a well-formed save and rejects garbage", () => {
    expect(isSaveData(sampleSave())).toBe(true);
    expect(isSaveData(null)).toBe(false);
    expect(isSaveData({ version: "0.13.0" })).toBe(false);
  });
});

describe("createReplayStorage (0.17.0)", () => {
  it("saves, lists, and deletes replays", () => {
    const backend = memoryBackend();
    const replays = createReplayStorage("bylina.replays.test", backend);
    replays.saveReplay({ createdAt: 1, title: "Бой 1" });
    replays.saveReplay({ createdAt: 2, title: "Бой 2" });
    expect(replays.listReplays().map((entry) => (entry as { title: string }).title)).toEqual(["Бой 2", "Бой 1"]);
    expect(replays.deleteReplay(2)).toBe(true);
    expect(replays.listReplays().map((entry) => (entry as { title: string }).title)).toEqual(["Бой 1"]);
  });

  it("reports failed writes (0.21.2): clearReplays and deleteReplay return false", () => {
    const quotaError = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    let haveData = false;
    const backend = {
      // После первой успешной записи следующие операции записи падают.
      getItem: () => (haveData ? "[]" : null),
      setItem: () => {
        haveData = true;
        throw quotaError;
      },
      removeItem: () => undefined,
    };
    const onQuotaExceeded = vi.fn();
    const replays = createReplayStorage("bylina.replays.quota", backend, { onQuotaExceeded });
    // Запись повтора при переполнении возвращает false и сообщает подписчику.
    expect(replays.saveReplay({ createdAt: 1 })).toBe(false);
    expect(onQuotaExceeded).toHaveBeenCalledWith(quotaError);
    // Удаление и очистка тоже возвращают false, а не молча проглатывают сбой.
    expect(replays.deleteReplay(1)).toBe(false);
    expect(replays.clearReplays()).toBe(false);
  });
});

describe("asynchronous save serialization", () => {
  it("converts fog sets and returns JSON without changing the save shape", async () => {
    const { createSaveSerializer } = await import("../src/index.js");
    const serializer = createSaveSerializer();
    const serialized = await serializer.serialize({
      ...sampleSave(),
      fog: { 1: { explored: new Set(["1,1"]), visible: new Set(["1,1"]) } },
    });
    serializer.dispose();
    const parsed = JSON.parse(serialized) as SaveData;
    expect(parsed.fog?.[1]?.explored).toEqual(["1,1"]);
  });
});

describe("storage quota handling", () => {
  it("does not throw and reports an exhausted localStorage backend", () => {
    const quotaError = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const backend = {
      getItem: () => null,
      setItem: () => {
        throw quotaError;
      },
      removeItem: () => undefined,
    };
    const onQuotaExceeded = vi.fn();
    const storage = createSaveStorage("bylina.quota", backend, { onQuotaExceeded });
    expect(storage.save(sampleSave())).toBe(false);
    expect(onQuotaExceeded).toHaveBeenCalledWith(quotaError);
  });
});

describe("save format migrations", () => {
  it("upgrades a legacy v1 save without a formatVersion", () => {
    const legacy = sampleSave() as unknown as Record<string, unknown>;
    delete legacy.formatVersion;
    expect(migrateSave(legacy)?.formatVersion).toBe(2);
  });
  it("rejects unknown future save formats", () => {
    expect(migrateSave({ ...sampleSave(), formatVersion: 99 })).toBeNull();
  });
  it("strips invalid prologueProgress without dropping the rest of the save", () => {
    const migrated = migrateSave({ ...sampleSave(), prologueProgress: { introSeen: "yes" } });
    expect(migrated).not.toBeNull();
    expect(migrated?.prologueProgress).toBeUndefined();
    expect(migrated?.campaign.fighters[0]?.name).toBe("Ратибор");
  });
  it("round-trips valid prologueProgress", () => {
    const save = {
      ...sampleSave(),
      prologueProgress: {
        run: {
          objectiveKey: "prologue.objective.gather",
          outcome: "ongoing",
          pickupDone: true,
          script: { index: 0 },
        },
        firedCutscenes: ["m1_intro"],
        introSeen: true,
      },
    } as SaveData;
    expect(isSaveData(save)).toBe(true);
    const backend = memoryBackend();
    const storage = createSaveStorage("bylina.prologue.progress", backend);
    expect(storage.save(save)).toBe(true);
    expect(storage.load()?.prologueProgress?.introSeen).toBe(true);
    expect(storage.load()?.prologueProgress?.firedCutscenes).toEqual(["m1_intro"]);
  });
});
