/** Пролог: раскладка, сценарий, бестиарий (0.20.56). */

import { z } from "zod";
import { id } from "./common.js";
import { mapGenConfigSchema } from "./world.js";
import { unitConfigSchema, weaponConfigSchema } from "./combat.js";
import { cutsceneConfigSchema } from "./scripting.js";

export const prologueLayoutSchema = z
  .object({
    rows: z.array(z.string()).min(1),
    /**
     * Ярусы рельефа по строкам (0.20.37): по одному символу на клетку ряда.
     * `0`/`1`/`2` — ярус клетки, любой другой символ — ярус по умолчанию.
     * Отдельный массив, а не цифры в `rows`: любой символ строки вне
     * служебного набора `. P W E c C e` становится маркером.
     */
    heights: z.array(z.string()).optional(),
    legend: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Карта миссии пролога: заготовка генератора + необязательный layout.
 * Высота от 6: авторская карта М1 — 20×6 (канон §7.1).
 */

export const prologueMapSchema = mapGenConfigSchema
  .extend({
    height: z.number().int().min(6).max(64),
    layout: prologueLayoutSchema.optional(),
  })
  .strict();

export const prologueHintSchema = z
  .object({
    key: z.string().min(1),
    panelKey: z.string().optional(),
    textKey: z.string().min(1),
    once: z.boolean(),
  })
  .strict();

export const prologueHintsSchema = z
  .object({
    hints: z.array(prologueHintSchema).min(1),
  })
  .strict();

export const prologueScriptActionSchema = z
  .object({
    unitId: id.optional(),
    side: z.enum(["player", "enemy"]).optional(),
    kind: z.enum(["attack", "skill", "approach", "defend", "overwatch", "resurrect", "endTurn", "spawn", "appear"]),
    targetUnitId: id.optional(),
    weaponId: id.optional(),
    skillId: id.optional(),
    corpseUnitId: id.optional(),
    /**
     * Исход действия: `hit` — попадание со случайным уроном, `miss` — промах,
     * `min` — попадание с минимальным уроном оружия (0.20.40). Последнее —
     * для постановочного первого удара: крыса М1 обязана укусить, но не
     * вправе искалечить героя случайным максимумом.
     */
    forceOutcome: z.enum(["hit", "miss", "min", "max"]).optional(),
    at: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
    onlyIf: z.enum(["targetAlive", "targetNotPoisoned", "targetWounded", "corpseExists"]).optional(),
  })
  .strict();

export const prologueScriptSchema = z
  .object({
    priority: z.array(prologueScriptActionSchema).optional(),
    actions: z.array(prologueScriptActionSchema).optional(),
  })
  .strict();

export const prologueObjectiveSchema = z
  .object({
    initialTextKey: z.string().min(1),
    retarget: z
      .array(
        z
          .object({
            onKey: z.string().min(1),
            textKey: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/* ---------- катсцены миссии (0.20.37, doc/campaign.md §13.4) ----------
 *
 * Режиссура камеры описывается данными миссии, а не кодом экрана: один и тот
 * же проигрыватель обслуживает вступление М1, выход крысы, Федота в трясине
 * (М2), новую волну (М3) и посадку корабля (М6). Схема описывает только
 * намерение; интерпретация — за пакетом отрисовки.
 */

export const prologueMissionConfigSchema = z
  .object({
    id,
    titleKey: z.string().min(1),
    introKey: z.string().min(1),
    outroKey: z.string().min(1),
    nextMissionId: id.nullable().optional(),
    playerSlots: z.array(id).min(1),
    fog: z.boolean(),
    map: prologueMapSchema,
    enemies: z.array(z.object({ unitId: id, count: z.number().int().min(1) }).strict()),
    objective: prologueObjectiveSchema.optional(),
    script: prologueScriptSchema.optional(),
    /** Режиссура камеры (0.20.37): воспроизводится экраном боя по триггерам. */
    cutscenes: z.array(cutsceneConfigSchema).optional(),
    hints: z.array(z.string()),
    /**
     * Подсветка кнопки действия (0.20.40): пока жив названный противник,
     * кнопка оружия пульсирует янтарным — сцена не объясняет словами, что
     * делать дальше. `whileAlive` — запись бестиария, `weaponId` — оружие,
     * кнопку которого подсвечиваем.
     */
    actionAccent: z
      .object({
        weaponId: id,
        whileAlive: id.optional(),
      })
      .strict()
      .optional(),
    reinforcements: z.string().optional(),
    onboarding: z.array(z.string()),
  })
  .strict();

export const prologueConfigSchema = z
  .object({
    enabled: z.boolean(),
    roster: z.array(id).min(1),
    prologueFinalMissionId: id,
    missions: z.array(prologueMissionConfigSchema).min(1),
  })
  .strict();

export const prologueBestiarySchema = z
  .object({
    units: z.array(unitConfigSchema),
    weapons: z.array(weaponConfigSchema),
  })
  .strict();

export type PrologueHintConfig = z.infer<typeof prologueHintSchema>;
export type PrologueHintsConfig = z.infer<typeof prologueHintsSchema>;
export type PrologueMissionConfig = z.infer<typeof prologueMissionConfigSchema>;
export type PrologueConfig = z.infer<typeof prologueConfigSchema>;
export type PrologueBestiaryConfig = z.infer<typeof prologueBestiarySchema>;
