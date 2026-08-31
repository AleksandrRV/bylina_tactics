import { describe, expect, it } from "vitest";
import {
  migratePrologueFighters,
  PROLOGUE_TO_CANONICAL_UNIT,
  type MigratableFighter,
} from "../src/prologue-migration.js";

function fighter(unitId: string, overrides?: Partial<MigratableFighter>): MigratableFighter {
  return {
    id: 1,
    name: "Тест",
    unitId,
    level: 2,
    hp: 10,
    maxHp: 12,
    wounded: false,
    alive: true,
    equippedItemId: null,
    ...overrides,
  };
}

describe("migratePrologueFighters (0.20.35)", () => {
  it("replaces prologue unit ids with canonical classes", () => {
    const migrated = migratePrologueFighters([
      fighter("mikula_peasant"),
      fighter("fedot_stranded", { id: 2 }),
      fighter("vasilisa", { id: 3 }),
    ]);
    expect(migrated.map((item) => item.unitId)).toEqual(["bogatyr", "strelets", "znaharka"]);
  });

  it("keeps level, hp and wound", () => {
    const migrated = migratePrologueFighters([fighter("mikula_peasant", { level: 3, hp: 8, wounded: true })]);
    expect(migrated[0]).toMatchObject({ unitId: "bogatyr", level: 3, hp: 8, wounded: true });
  });

  it("leaves canonical ids unchanged", () => {
    const migrated = migratePrologueFighters([
      fighter("bogatyr"),
      fighter("strelets", { id: 2 }),
      fighter("znaharka", { id: 3 }),
    ]);
    expect(migrated.map((item) => item.unitId)).toEqual(["bogatyr", "strelets", "znaharka"]);
  });

  it("leaves unknown ids unchanged", () => {
    expect(migratePrologueFighters([fighter("unknown_unit")])[0]!.unitId).toBe("unknown_unit");
  });

  it("exports the full mapping", () => {
    expect(PROLOGUE_TO_CANONICAL_UNIT).toEqual({
      mikula_peasant: "bogatyr",
      fedot_stranded: "strelets",
      vasilisa: "znaharka",
    });
  });
});
