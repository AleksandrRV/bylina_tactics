import { pickCutscene, type CutsceneConfig, type CutsceneEvent, type GameEvent } from "@bylina/core";
import type { CinematicPlan } from "@bylina/render";

/**
 * Режиссура камеры пролога (0.20.37, doc/campaign.md §13.4).
 *
 * Переводит описание сцены из данных миссии в план проигрывателя пакета
 * отрисовки. Здесь только преобразование: никаких правил боя и никакого
 * обращения к PixiJS — поэтому модуль покрывается юнит-тестами.
 */

/** Маркеры авторской раскладки: символ → список клеток. */
export type LayoutMarkers = Record<string, { x: number; y: number }[]>;

/**
 * План сцены для проигрывателя. Маркеры раскладки (`S` — палка, `F` — точка
 * выхода крысы) разрешаются в конкретные клетки: средство отображения о
 * раскладке миссии ничего не знает.
 */
export function buildCinematicPlan(config: CutsceneConfig, markers: LayoutMarkers | null): CinematicPlan {
  return {
    id: config.id,
    lockInput: config.lockInput ?? true,
    skippable: config.skippable ?? true,
    steps: config.steps.map((step) => {
      const raw = step.target;
      let target: CinematicPlan["steps"][number]["target"];
      if (raw?.configId) {
        target = { configId: raw.configId };
      } else if (raw?.marker) {
        const cell = markers?.[raw.marker]?.[0];
        target = cell ? { cell } : undefined;
      } else if (raw?.cell) {
        target = { cell: raw.cell };
      }
      return {
        kind: step.kind,
        target,
        durationMs: step.durationMs,
        holdMs: step.holdMs,
        fade: step.fade,
        runInMs: step.runInMs,
      };
    }),
  };
}

/** Записи бестиария, появившиеся на поле в этом пакете событий. */
export function spawnedConfigIds(events: readonly GameEvent[]): string[] {
  const ids: string[] = [];
  for (const event of events) {
    if (event.type === "ENTITY_SPAWNED") ids.push(event.entity.configId);
  }
  return ids;
}

/**
 * Разложить события появления на две части: те, чьё появление ставит сцену
 * (`onSpawn`), и остальные — их проигрывает обычный порядок событий.
 */
export function splitSpawnEvents(
  events: readonly GameEvent[],
  cutscenes: readonly CutsceneConfig[] | undefined,
): { staged: { configId: string; event: CutsceneEvent }[]; generic: GameEvent[] } {
  const staged: { configId: string; event: CutsceneEvent }[] = [];
  const generic: GameEvent[] = [];
  for (const event of events) {
    if (event.type === "ENTITY_SPAWNED") {
      const configId = event.entity.configId;
      const config = pickCutscene(cutscenes, { type: "spawn", configId });
      if (config) {
        staged.push({ configId, event: { type: "spawn", configId } });
        continue;
      }
    }
    generic.push(event);
  }
  return { staged, generic };
}
