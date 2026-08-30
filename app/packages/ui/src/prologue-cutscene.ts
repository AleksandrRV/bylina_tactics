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
export function buildCinematicPlan(
  config: CutsceneConfig,
  markers: LayoutMarkers | null,
  options: { holdZoom?: boolean; baseScale?: number | null } = {},
): CinematicPlan {
  return {
    id: config.id,
    lockInput: config.lockInput ?? true,
    skippable: config.skippable ?? true,
    // Сцена — только первая половина кадра: приближение держим до конца,
    // чтобы события боя (укус по передаче хода) шли крупным планом (0.20.41).
    holdZoom: options.holdZoom === true,
    // Масштаб возврата второй половины — игровой кадр, а не приближение,
    // которое осталось от первой (0.20.41).
    baseScale: options.baseScale ?? undefined,
    // Приближение сцены: множитель к игровому масштабу (0.20.39).
    zoom: config.zoom,
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
        kind: step.kind === "handOff" ? "hold" : step.kind,
        target,
        durationMs: step.durationMs,
        holdMs: step.holdMs,
        fade: step.fade,
        runInMs: step.runInMs,
        // Трекинг вбегания и акцент цели (0.20.40).
        follow: step.follow,
        accent: step.accent,
      };
    }),
  };
}

/**
 * Разрезать сцену по шагу передачи хода (0.20.40).
 *
 * Шаг `handOff` — не кадр, а граница: шаги до него проигрываются средством
 * отображения, затем ход передаётся сопернику (крыса М1 бьёт Микулу сразу,
 * без кнопки «Конец хода»), его действия разыгрываются обычными событиями
 * боя, и только после этого сцена продолжается оставшимися шагами —
 * камера возвращается к герою. Исполнитель передачи — экран боя: средство
 * отображения о правилах боя не знает, поэтому шаг в план не попадает.
 */
export function splitAtHandOff(config: CutsceneConfig): { before: CutsceneConfig; after: CutsceneConfig | null } {
  const at = config.steps.findIndex((step) => step.kind === "handOff");
  if (at < 0) return { before: config, after: null };
  const after = { ...config, id: `${config.id}_after`, steps: config.steps.slice(at + 1) };
  return { before: { ...config, steps: config.steps.slice(0, at) }, after: after.steps.length > 0 ? after : null };
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
  fired: readonly string[] = [],
): { staged: { configId: string; entityId: number; event: CutsceneEvent }[]; generic: GameEvent[] } {
  const staged: { configId: string; entityId: number; event: CutsceneEvent }[] = [];
  const generic: GameEvent[] = [];
  for (const event of events) {
    if (event.type === "ENTITY_SPAWNED") {
      const configId = event.entity.configId;
      const config = pickCutscene(cutscenes, { type: "spawn", configId }, fired);
      if (config) {
        staged.push({ configId, entityId: event.entity.id, event: { type: "spawn", configId } });
        continue;
      }
    }
    generic.push(event);
  }
  return { staged, generic };
}

/**
 * Идентификаторы сущностей, чьё появление ставит сцена (0.20.39). Они уже
 * созданы ядром, но экран скрывает их до вбегания — список уходит в средство
 * отображения до проигрывания событий хода.
 */
export function stagedEntityIds(
  events: readonly GameEvent[],
  cutscenes: readonly CutsceneConfig[] | undefined,
  fired: readonly string[] = [],
): number[] {
  return splitSpawnEvents(events, cutscenes, fired).staged.map((entry) => entry.entityId);
}
