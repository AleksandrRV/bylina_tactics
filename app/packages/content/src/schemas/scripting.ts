/** Сцены и подкрепления: постановочные шаги и волны врагов (0.20.56). */

import { z } from "zod";
import { id } from "./common.js";

const cutsceneTargetSchema = z
  .object({
    cell: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
    configId: id.optional(),
    marker: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (target) =>
      Number(target.cell !== undefined) +
        Number(target.configId !== undefined) +
        Number(target.marker !== undefined) ===
      1,
    "cutscene step target must name exactly one of: cell, configId, marker",
  );

export const cutsceneStepSchema = z
  .object({
    /**
     * `focus` — навести камеру на цель (быстрый кадр), `pan` — плавный
     * переход, `hold` — удержать текущее положение, `fade` — затемнение
     * или проявление экрана, `handOff` — передать ход сопернику прямо
     * внутри сцены (0.20.40): его действия разыгрываются обычными
     * событиями боя, а следующие шаги сцены идут уже после них.
     */
    kind: z.enum(["focus", "pan", "hold", "fade", "handOff"]),
    target: cutsceneTargetSchema.optional(),
    /** Длительность перехода в мс. */
    durationMs: z.number().int().min(0).max(5000).optional(),
    /** Пауза на цели после перехода. */
    holdMs: z.number().int().min(0).max(5000).optional(),
    /** Направление затемнения: `out` — в темноту, `in` — из темноты. */
    fade: z.enum(["out", "in"]).optional(),
    /**
     * Проиграть вбегание сущности из-за предела карты в её клетку.
     * Применяется к шагам с целью-сущностью (крыса М1).
     */
    runInMs: z.number().int().min(0).max(3000).optional(),
    /**
     * Вести камеру за сущностью во время вбегания (0.20.40): кадр встаёт
     * на точку у кромки карты, откуда сущность выбегает, и едет следом.
     */
    follow: z.boolean().optional(),
    /**
     * Подсветить цель шага пульсирующим янтарным кольцом (0.20.40):
     * кадр называет предмет не только приближением, но и светом.
     */
    accent: z.boolean().optional(),
  })
  .strict()
  .refine((step) => step.kind !== "fade" || step.fade !== undefined, "fade step requires direction")
  .refine(
    (step) => step.kind === "hold" || step.kind === "fade" || step.kind === "handOff" || step.target !== undefined,
    "step requires a target",
  );

export const cutsceneTriggerSchema = z
  .object({
    /** `missionStart` — при входе в миссию; `onSpawn` — выход сущности на поле;
     *  `onFlag` — срабатывание флага сценария; `onPickup` — подбор предмета. */
    kind: z.enum(["missionStart", "onSpawn", "onFlag", "onPickup"]),
    configId: id.optional(),
    flag: z.string().min(1).optional(),
    itemId: id.optional(),
  })
  .strict()
  .refine(
    (trigger) =>
      (trigger.kind === "onSpawn" && trigger.configId !== undefined) ||
      (trigger.kind === "onFlag" && trigger.flag !== undefined) ||
      (trigger.kind === "onPickup" && trigger.itemId !== undefined) ||
      trigger.kind === "missionStart",
    "trigger arguments must match its kind",
  );

export const cutsceneConfigSchema = z
  .object({
    id: z.string().min(1),
    trigger: cutsceneTriggerSchema,
    steps: z.array(cutsceneStepSchema).min(1),
    /** Блокировать ввод игрока на время сцены. */
    lockInput: z.boolean().default(true),
    /** Сцену можно пропустить кнопкой или клавишей (campaign.md §1.8). */
    skippable: z.boolean().default(true),
    /**
     * Приближение камеры на время сцены: множитель к игровому масштабу
     * (0.20.39). При подгонке «поле целиком» проезд камеры невозможен,
     * поэтому сцена начинается с приближения; после сцены масштаб
     * возвращается. Значение задаёт автор сцены, разумный предел — 4.
     */
    zoom: z.number().min(1).max(4).optional(),
    /**
     * Играть сцену один раз за бой (0.20.45). Триггер `onSpawn` срабатывает
     * на каждое появление записи бестиария; сцена первого выхода — засады
     * в М2 — не должна повторяться на каждой волне, и после неё играется
     * следующая подходящая сцена из данных миссии.
     */
    once: z.boolean().default(false),
  })
  .strict();

export const reinforcementsConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    mode: z.enum(["threshold", "onKill"]).default("threshold"),
    thresholdEnemyCount: z.number().int().min(0).optional(),
    delayTurns: z.number().int().min(0).default(1),
    pool: z.array(id).min(1),
    countPerWave: z.number().int().min(1).optional(),
    maxConcurrentEnemies: z.number().int().min(1),
    spawnEdge: z.enum(["north", "south", "east", "west"]).optional(),
    spawnCells: z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict()).optional(),
    perKill: z.number().int().min(0).optional(),
    perTurnNoKill: z.number().int().min(0).optional(),
  })
  .strict();

export const reinforcementsFileSchema = z
  .object({
    default: reinforcementsConfigSchema,
    profiles: z.record(z.string(), reinforcementsConfigSchema).optional(),
  })
  .strict();

export type CutsceneConfig = z.infer<typeof cutsceneConfigSchema>;
export type CutsceneStep = z.infer<typeof cutsceneStepSchema>;
export type CutsceneTrigger = z.infer<typeof cutsceneTriggerSchema>;
export type ReinforcementsConfig = z.infer<typeof reinforcementsConfigSchema>;
export type ReinforcementsFileConfig = z.infer<typeof reinforcementsFileSchema>;
