import { describe, expect, it } from "vitest";
import { createPvpMatch, createTacticsKernel, type PvpMatchOptions } from "@bylina/core";
import {
  REPLAY_FORMAT_VERSION,
  RULES_VERSION,
  createReplayRecorder,
  isReplayJournal,
  replayCompatibility,
} from "../src/index.js";
import manifest from "../../../package.json";

const OPTIONS: PvpMatchOptions = {
  units: [
    {
      id: "bogatyr",
      maxHealth: 12,
      maxAP: 2,
      mobility: 5,
      aim: 100,
      defense: 0,
      will: 40,
      vision: 12,
      weapons: ["sword"],
      skills: [],
    },
  ],
  map: {
    width: 14,
    height: 10,
    pitChance: 0.02,
    coverDensity: 0.03,
    wallDensity: 0.01,
    edgeCoverChance: 0.4,
    halfCoverChance: 0.5,
    heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
  },
  side1: ["bogatyr"],
  side2: ["bogatyr"],
  objective: "elimination",
  seed: 99,
};

describe("replay journal (0.21.4)", () => {
  it("stamps the format/rules versions and the app version for diagnostics", () => {
    const recorder = createReplayRecorder(OPTIONS, "QA");
    const journal = recorder.finish(null, "QA");
    expect(journal.formatVersion).toBe(REPLAY_FORMAT_VERSION);
    expect(journal.rulesVersion).toBe(RULES_VERSION);
    // appVersion — только диагностика: текущий номер манифеста.
    expect(journal.appVersion).toBe(manifest.version);
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
  });

  it("rejects journals of the previous string-version format", () => {
    // Журналы, записанные прежним форматом (поле version: string, без
    // formatVersion/rulesVersion), не распознаются — не воспроизводятся молча.
    expect(isReplayJournal({ version: "0.20.68" })).toBe(false);
    expect(isReplayJournal({ version: "0.20.68", createdAt: 1, commands: [], winner: null, title: "t" })).toBe(false);
    expect(isReplayJournal({ formatVersion: 1 })).toBe(false);
    expect(isReplayJournal(null)).toBe(false);
    expect(isReplayJournal({})).toBe(false);
  });

  it("classifies compatibility by format and rules version", () => {
    const recorder = createReplayRecorder(OPTIONS, "ok");
    const current = recorder.finish(null, "ok");
    expect(replayCompatibility(current)).toBe("ok");

    // Тот же формат, но другие правила: воспроизводимо с предупреждением.
    expect(replayCompatibility({ ...current, rulesVersion: RULES_VERSION + 99 })).toBe("otherRules");

    // Неподдерживаемый (будущий/старый) формат: воспроизводить нельзя.
    expect(replayCompatibility({ ...current, formatVersion: REPLAY_FORMAT_VERSION + 99 })).toBe("unsupported");
    expect(replayCompatibility({ ...current, formatVersion: 0 })).toBe("unsupported");
  });

  it("reproduces the same battle from the journal", () => {
    const recorder = createReplayRecorder(OPTIONS, "repro");
    const kernel = createTacticsKernel({
      initial: createPvpMatch(OPTIONS),
      weapons: {},
      skills: {},
      seed: OPTIONS.seed,
    });
    // Ход 1 (игрок): завершение хода.
    recorder.record({ type: "END_TURN", playerId: "1" });
    kernel.apply({ type: "END_TURN", playerId: "1" });
    expect(kernel.getSnapshot().activeOwner).toBe(2);
    // Воспроизведение журнала с нуля даёт ту же смену хода.
    const replayKernel = createTacticsKernel({
      initial: createPvpMatch(OPTIONS),
      weapons: {},
      skills: {},
      seed: OPTIONS.seed,
    });
    for (const command of recorder.getJournal()!.commands) {
      replayKernel.apply(command);
    }
    expect(replayKernel.getSnapshot().activeOwner).toBe(2);
    expect(replayKernel.getSnapshot().turnNumber).toBe(kernel.getSnapshot().turnNumber);
  });
});
