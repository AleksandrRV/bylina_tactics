/** Режимы «Быстрый матч» и состязание (0.20.56). */

import { z } from "zod";
import { id } from "./common.js";
import { mapGenConfigSchema } from "./world.js";

/** Стандартное снаряжение режима: оружие бойца по идентификатору записи. */
export const loadoutsSchema = z.record(id, z.array(id));

export const quickMatchConfigSchema = z
  .object({
    playerSlots: z.tuple([id, id, id]),
    /** Стандартное снаряжение бойцов режима (0.21.25): оружие из экипировки,
     *  а не из записи класса. */
    loadouts: loadoutsSchema.optional(),
    enemyPool: z.tuple([id, id, id]),
    difficulties: z
      .array(
        z
          .object({
            id: z.enum(["easy", "normal", "hard"]),
            enemyCount: z.number().int().min(1),
          })
          .strict(),
      )
      .length(3),
    map: mapGenConfigSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.difficulties.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["difficulties"],
        message: "difficulty ids must be unique",
      });
    }
    const capacity = Math.max(0, 2 * (value.map.height - 2));
    for (const [index, difficulty] of value.difficulties.entries()) {
      if (difficulty.enemyCount > capacity) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["difficulties", index, "enemyCount"],
          message: `enemyCount exceeds map spawn capacity ${capacity}`,
        });
      }
    }
  });

export const pvpConfigSchema = z
  .object({
    pool: z.array(id),
    /** Стандартное снаряжение бойцов режима (0.21.25): оружие из экипировки,
     *  а не из записи класса. */
    loadouts: loadoutsSchema.optional(),
    nMin: z.number().int().min(1),
    objective: z.enum(["elimination", "apple", "choice"]),
    /** Заготовка поля режима (roadmap 0.14.0: «Комната сбора без сети»). */
    map: mapGenConfigSchema.optional(),
  })
  .strict();

export type QuickMatchConfig = z.infer<typeof quickMatchConfigSchema>;
export type PvpConfig = z.infer<typeof pvpConfigSchema>;
