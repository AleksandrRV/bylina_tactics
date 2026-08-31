import type { EntityState } from "@bylina/core";

export const ACTION_SHORTCUTS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

export type SelectableAction = { type: "weapon" | "skill"; id: string };

/** Оружие всегда занимает первые слоты, классовые умения — следующие. */
export function selectableActions(entity: EntityState): SelectableAction[] {
  const weapons = entity.weaponIds ?? (entity.weaponId ? [entity.weaponId] : []);
  return [
    ...weapons.map((id) => ({ type: "weapon" as const, id })),
    ...(entity.skillIds ?? []).map((id) => ({ type: "skill" as const, id })),
  ];
}

export function shortcutForAction(entity: EntityState, type: SelectableAction["type"], id: string): string | undefined {
  const index = selectableActions(entity).findIndex((action) => action.type === type && action.id === id);
  return index >= 0 ? ACTION_SHORTCUTS[index] : undefined;
}
