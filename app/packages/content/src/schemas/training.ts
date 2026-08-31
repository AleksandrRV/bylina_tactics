/** Обучение: вражеские сценарии, подсказки, миссии (0.20.56). */

import { z } from "zod";
import { id } from "./common.js";
import { mapGenConfigSchema } from "./world.js";

export const trainingEnemyActionSchema = z
  .object({
    unitId: id.optional(),
    kind: z.enum(["attack", "skill", "approach", "defend", "overwatch", "resurrect", "endTurn"]),
    targetUnitId: id.optional(),
    weaponId: id.optional(),
    skillId: id.optional(),
    corpseUnitId: id.optional(),
    onlyIf: z.enum(["targetAlive", "targetNotPoisoned", "targetWounded", "corpseExists"]).optional(),
  })
  .strict();

export const trainingEnemyScriptSchema = z
  .object({
    priority: z.array(trainingEnemyActionSchema),
    actions: z.array(trainingEnemyActionSchema),
  })
  .strict();

export const trainingHintSchema = z
  .object({
    step: z.number().int().min(1),
    textKey: z.string().min(1),
    highlight: z.enum(["cell", "entity", "panel", "button", "zone"]),
    cell: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
    targetUnitId: id.optional(),
    panelKey: z.string().optional(),
    until: z.enum(["move", "dash", "attack", "skill", "defend", "overwatch", "end_turn", "approach", "noop"]),
    // Строгий сценарий (0.20.13): шаг предписывает ровно одно действие
    // конкретного бойца; иное действие интерфейс не исполняет.
    actorUnitId: id.optional(),
    weaponId: id.optional(),
    skillId: id.optional(),
    repeatUntil: z.enum(["targetDead", "victory"]).optional(),
  })
  .strict();

export const trainingMissionSchema = z
  .object({
    id: z.enum(["movement", "combat", "skills"]),
    titleKey: z.string().min(1),
    descriptionKey: z.string().min(1),
    map: mapGenConfigSchema,
    playerSlots: z.array(id).min(1).max(5),
    enemies: z.array(z.object({ unitId: id, count: z.number().int().min(1) }).strict()).min(0),
    hints: z.array(trainingHintSchema).min(1),
    /** Сценарий Нави (0.20.13): строго предопределённые ходы противника. */
    enemyScript: trainingEnemyScriptSchema.optional(),
    /** Реактивные подсказки (0.20.1): ключи локализации плашек на отравление,
     *  воскрешение и призыв в миссии «Умения и состояния». */
    notes: z
      .object({
        poison: z.string().min(1),
        resurrect: z.string().min(1),
        summon: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    // Поле step задаёт порядок шагов (content-schema §8): шаги обязаны
    // образовывать последовательность 1..N ровно по одному разу — интерфейс
    // выполняет подсказки по step, а не по порядку массива.
    const steps = value.hints.map((hint) => hint.step).sort((a, b) => a - b);
    const expected = Array.from({ length: value.hints.length }, (_, index) => index + 1);
    if (steps.join(",") !== expected.join(",")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hints"],
        message: `hint steps must form a unique sequence 1..${value.hints.length}`,
      });
    }
  });

/** Режим обучения (0.19.0): ровно три миссии. */

export const trainingConfigSchema = z
  .object({
    missions: z.array(trainingMissionSchema).length(3),
  })
  .strict();

/* ============================================================
   Пролог кампании (Этап 1, 0.20.31; норматив — doc/campaign.md)
   ============================================================ */

/**
 * Авторская раскладка (Этап 2): ASCII-строки рядов.
 * Символы: `.` пусто, `t` декорация, `P` яма, `W` стена, `c` полуукрытие,
 * `E` эвакуация, буквы — маркеры юнитов (`M`/`F`/`S`/`A`/`V`/`U`/`K`/`H`).
 */

export type TrainingHintConfig = z.infer<typeof trainingHintSchema>;
export type TrainingMissionConfig = z.infer<typeof trainingMissionSchema>;
export type TrainingConfig = z.infer<typeof trainingConfigSchema>;
