import { describe, expect, it } from "vitest";
import { createReplayStorage, createSaveStorage, deserializeFog, isSaveData, serializeFog, type SaveData } from "../src/index.js";
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
    version: "0.13.0",
    savedAt: 123,
    campaign: {
      darkness: 4,
      darknessMax: 20,
      phase: "active",
      resources: { gold: 10, herbs: 2, artifacts: 1 },
      inventory: [],
      shipPosition: { x: 13, y: 64 },
      missions: [{ id: "clearing_1", status: "done" }],
      fighters: [
        { id: 1, name: "Ратибор", unitId: "bogatyr", level: 3, hp: 10, maxHp: 12, wounded: false, alive: true, equippedItemId: null },
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
    replays.deleteReplay(2);
    expect(replays.listReplays().map((entry) => (entry as { title: string }).title)).toEqual(["Бой 1"]);
  });
});
