import { describe, expect, it } from "vitest";
import {
  PLAYER_OWNER,
  TRAINING_BOGATYR_ID,
  TRAINING_STRELETS_ID,
  TRAINING_UPYR_A_ID,
  TRAINING_UPYR_B_ID,
  TRAINING_UPYR_C_ID,
  TRAINING_ZNAHARKA_ID,
  createTacticsKernel,
  createTrainingMatch,
  defaultTrainingWeapons,
} from "../src/index.js";

describe("createTrainingMatch", () => {
  it("places three player roles and three immobile upyrs", () => {
    const match = createTrainingMatch();
    const byId = new Map(match.entities.map((entity) => [entity.id, entity]));
    expect(byId.get(TRAINING_BOGATYR_ID)?.configId).toBe("bogatyr");
    expect(byId.get(TRAINING_STRELETS_ID)?.configId).toBe("strelets");
    expect(byId.get(TRAINING_ZNAHARKA_ID)?.configId).toBe("znaharka");
    for (const id of [TRAINING_UPYR_A_ID, TRAINING_UPYR_B_ID, TRAINING_UPYR_C_ID]) {
      const dummy = byId.get(id);
      expect(dummy?.configId).toBe("upyr");
      expect(dummy?.maxAp).toBe(0);
      expect(dummy?.ap).toBe(0);
      expect(dummy?.owner).toBe(2);
    }
    expect(match.activeOwner).toBe(PLAYER_OWNER);
  });
});

describe("training kernel", () => {
  it("keeps the turn on the player side because dummies have no AP", () => {
    const kernel = createTacticsKernel({
      initial: createTrainingMatch(),
      weapons: defaultTrainingWeapons(),
      seed: 0x40a1,
    });
    const before = kernel.getSnapshot();
    const result = kernel.apply({ type: "END_TURN", playerId: String(before.activeOwner) });
    expect(result.ok).toBe(true);
    const after = kernel.getSnapshot();
    expect(after.activeOwner).toBe(PLAYER_OWNER);
    expect(after.turnNumber).toBe(before.turnNumber + 1);
    const bogatyr = after.entities.find((entity) => entity.id === TRAINING_BOGATYR_ID);
    expect(bogatyr?.ap).toBe(bogatyr?.maxAp);
  });

  it("rejects dummy movement and allows a shot at a dummy", () => {
    const kernel = createTacticsKernel({
      initial: createTrainingMatch(),
      weapons: defaultTrainingWeapons(),
      seed: 0x40a1,
    });
    const blocked = kernel.apply({
      type: "MOVE",
      actorId: TRAINING_UPYR_A_ID,
      to: { x: 7, y: 2, z: 2 },
    });
    expect(blocked.ok).toBe(false);

    const preview = kernel.getHitPreview(TRAINING_STRELETS_ID, TRAINING_UPYR_A_ID);
    expect(preview.available).toBe(true);
    const shot = kernel.apply({ type: "ATTACK", actorId: TRAINING_STRELETS_ID, targetId: TRAINING_UPYR_A_ID });
    expect(shot.ok).toBe(true);
  });

  it("lets the bogatyr walk toward a dummy", () => {
    const kernel = createTacticsKernel({
      initial: createTrainingMatch(),
      weapons: defaultTrainingWeapons(),
    });
    const reachable = kernel.getReachable(TRAINING_BOGATYR_ID);
    expect(reachable.length).toBeGreaterThan(0);
    const step = reachable.find((cell) => cell.apCost === 1);
    expect(step).toBeDefined();
    if (!step) return;
    const moved = kernel.apply({ type: "MOVE", actorId: TRAINING_BOGATYR_ID, to: step });
    expect(moved.ok).toBe(true);
  });
});
