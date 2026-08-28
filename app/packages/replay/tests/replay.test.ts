import { describe, expect, it } from "vitest";
import { createPvpMatch, createTacticsKernel, type PvpMatchOptions } from "@bylina/core";
import { REPLAY_VERSION, createReplayRecorder, isReplayJournal } from "../src/index.js";

const OPTIONS: PvpMatchOptions = {
  units: [
    { id: "bogatyr", maxHealth: 12, maxAP: 2, mobility: 5, aim: 100, defense: 0, will: 40, vision: 12, weapons: ["sword"], skills: [] },
  ],
  map: { width: 14, height: 10, pitChance: 0.02, coverDensity: 0.03, wallDensity: 0.01, edgeCoverChance: 0.4, halfCoverChance: 0.5, heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 } },
  side1: ["bogatyr"],
  side2: ["bogatyr"],
  objective: "elimination",
  seed: 99,
};

describe("replay journal (0.20.19)", () => {
  it("uses the current replay format version", () => {
    expect(REPLAY_VERSION).toBe("0.20.36");
  });

  it("records commands and serializes to a plain object", () => {
    const recorder = createReplayRecorder(OPTIONS, "QA-бой");
    recorder.record({ type: "END_TURN", playerId: "1" });
    recorder.record({ type: "MOVE", actorId: 2, to: { x: 5, y: 5, z: 1 } });
    const journal = recorder.finish(2, "QA-бой (победа)");
    expect(journal.commands).toHaveLength(2);
    expect(journal.winner).toBe(2);
    const copy = JSON.parse(JSON.stringify(journal));
    expect(isReplayJournal(copy)).toBe(true);
    expect(isReplayJournal({ version: "x" })).toBe(false);
  });

  it("reproduces the same battle from the journal", () => {
    const recorder = createReplayRecorder(OPTIONS, "repro");
    const kernel = createTacticsKernel({ initial: createPvpMatch(OPTIONS), weapons: {}, skills: {}, seed: OPTIONS.seed });
    // Ход 1 (игрок): завершение хода.
    recorder.record({ type: "END_TURN", playerId: "1" });
    kernel.apply({ type: "END_TURN", playerId: "1" });
    expect(kernel.getSnapshot().activeOwner).toBe(2);
    // Воспроизведение журнала с нуля даёт ту же смену хода.
    const replayKernel = createTacticsKernel({ initial: createPvpMatch(OPTIONS), weapons: {}, skills: {}, seed: OPTIONS.seed });
    for (const command of recorder.getJournal()!.commands) {
      replayKernel.apply(command);
    }
    expect(replayKernel.getSnapshot().activeOwner).toBe(2);
    expect(replayKernel.getSnapshot().turnNumber).toBe(kernel.getSnapshot().turnNumber);
  });
});
