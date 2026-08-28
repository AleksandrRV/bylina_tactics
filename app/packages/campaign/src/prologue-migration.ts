/**
 * Перенос дружины пролога на канонические записи при `chapter: "prologue" → "open"`
 * (Этап 5, 0.20.35). Уровень, здоровье, ранение и снаряжение сохраняются.
 */

export interface MigratableFighter {
  id: number;
  name: string;
  unitId: string;
  level: number;
  hp: number;
  maxHp: number;
  wounded: boolean;
  alive: boolean;
  equippedItemId: string | null;
}

export const PROLOGUE_TO_CANONICAL_UNIT: Record<string, string> = {
  mikula_peasant: "bogatyr",
  fedot_stranded: "strelets",
  vasilisa: "znaharka",
};

const ALREADY_CANONICAL = new Set(["bogatyr", "strelets", "znaharka", "volkhv", "recruit"]);

export function migratePrologueFighters<T extends MigratableFighter>(fighters: readonly T[]): T[] {
  return fighters.map((fighter) => {
    const canonicalId = PROLOGUE_TO_CANONICAL_UNIT[fighter.unitId];
    if (canonicalId) return { ...fighter, unitId: canonicalId };
    return { ...fighter };
  });
}

export function isCanonicalUnitId(unitId: string): boolean {
  return ALREADY_CANONICAL.has(unitId);
}
