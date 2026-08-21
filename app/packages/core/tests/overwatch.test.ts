import { describe, expect, it } from "vitest";
import { createQuickMatch } from "../src/match.js";
import { createTacticsKernel } from "../src/kernel.js";
import { defaultTrainingWeapons } from "../src/defaults.js";
import { PLAYER_OWNER, ENEMY_OWNER } from "../src/debug-map.js";

describe("overwatch (§14)", () => {
  it("sets the overwatch flag and zeroes AP", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 10 });
    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 10,
    });
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0);
    if (!player) return;
    const result = kernel.apply({ type: "OVERWATCH", actorId: player.id });
    expect(result.ok).toBe(true);
    const after = kernel.getSnapshot().entities.find((e) => e.id === player.id);
    expect(after?.overwatch).toBe(true);
    expect(after?.ap).toBe(0);
  });

  it("rejects overwatch when AP is 0", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 20 });
    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 20,
    });
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0);
    if (!player) return;
    // Потратить все ОД.
    kernel.apply({ type: "OVERWATCH", actorId: player.id });
    // Повторный дозор невозможен — ОД уже 0.
    const result = kernel.apply({ type: "OVERWATCH", actorId: player.id });
    expect(result.ok).toBe(false);
  });

  it("clears overwatch at the start of the owner's next turn", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 30 });
    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 30,
    });
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0);
    if (!player) return;
    kernel.apply({ type: "OVERWATCH", actorId: player.id });
    // Завершить ход игрока.
    kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    // Завершить ход врага.
    kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
    // В начале нового хода игрока дозор должен быть снят.
    const after = kernel.getSnapshot().entities.find((e) => e.id === player.id);
    expect(after?.overwatch).toBe(false);
    expect(after?.ap).toBe(after?.maxAp);
  });
});

describe("defensive stance", () => {
  it("sets the defending flag", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 40 });
    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 40,
    });
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0);
    if (!player) return;
    const result = kernel.apply({ type: "DEFEND", actorId: player.id });
    expect(result.ok).toBe(true);
    const after = kernel.getSnapshot().entities.find((e) => e.id === player.id);
    expect(after?.defending).toBe(true);
    expect(after?.ap).toBe(0);
  });

  it("reduces hit chance against a defending target", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 50 });
    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 50,
    });
    // Найти пару стрелок-упырь на дистанции.
    const strelets = match.entities.find((e) => e.owner === PLAYER_OWNER && e.configId === "strelets");
    const enemy = match.entities.find((e) => e.owner === ENEMY_OWNER && e.coverType === 0);
    if (!strelets || !enemy) return;
    const previewNormal = kernel.getHitPreview(strelets.id, enemy.id);
    // Встать в защиту.
    enemy.defending = true;
    const previewDefend = kernel.getHitPreview(strelets.id, enemy.id);
    if (previewNormal.available && previewDefend.available) {
      expect((previewDefend.chance ?? 0)).toBeLessThan(previewNormal.chance ?? 0);
    }
  });

  it("clears defending at the start of the owner's next turn", () => {
    const match = createQuickMatch({ enemyCount: 3, seed: 60 });
    const kernel = createTacticsKernel({
      initial: match,
      weapons: defaultTrainingWeapons(),
      seed: 60,
    });
    const player = match.entities.find((e) => e.owner === PLAYER_OWNER && e.coverType === 0);
    if (!player) return;
    kernel.apply({ type: "DEFEND", actorId: player.id });
    kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
    const after = kernel.getSnapshot().entities.find((e) => e.id === player.id);
    expect(after?.defending).toBe(false);
    expect(after?.ap).toBe(after?.maxAp);
  });
});
