import { describe, expect, it } from "vitest";
import type { EntityState } from "@bylina/core";
import { selectableActions, shortcutForAction } from "../src/action-shortcuts.js";

const bogatyr = {
  weaponId: "sword",
  weaponIds: ["sword", "mace"],
  skillIds: ["circular_sweep", "breach", "shield_bash"],
} as EntityState;

describe("action shortcuts", () => {
  it("places weapons first and skills in the nearest following slots", () => {
    expect(selectableActions(bogatyr)).toEqual([
      { type: "weapon", id: "sword" },
      { type: "weapon", id: "mace" },
      { type: "skill", id: "circular_sweep" },
      { type: "skill", id: "breach" },
      { type: "skill", id: "shield_bash" },
    ]);
    expect(shortcutForAction(bogatyr, "skill", "shield_bash")).toBe("5");
  });
});
