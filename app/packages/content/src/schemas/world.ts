/** Мир: генерация карты, запасы, разведка (0.20.56). */

import { z } from "zod";

export const mapGenConfigSchema = z
  .object({
    width: z.number().int().min(8).max(64),
    height: z.number().int().min(8).max(64),
    pitChance: z.number().min(0).max(1),
    coverDensity: z.number().min(0).max(1),
    wallDensity: z.number().min(0).max(1),
    edgeCoverChance: z.number().min(0).max(1),
    halfCoverChance: z.number().min(0).max(1),
    heightMix: z
      .object({
        z0: z.number().min(0).max(1),
        z1: z.number().min(0).max(1),
        z2: z.number().min(0).max(1),
      })
      .strict()
      .refine((mix) => Math.abs(mix.z0 + mix.z1 + mix.z2 - 1) < 1e-9, "heightMix values must sum to 1"),
    /** Карта содержит зону эвакуации у края поля (миссии спасения и разведки). */
    extract: z.boolean().optional(),
    /** Минимальное число целоклеточных укрытий (0.20.1): генератор доводит
     *  количество укрытий до этого значения — гарантия для обучающих карт. */
    minCovers: z.number().int().min(0).optional(),
    /**
     * Биом (0.20.25, этап 3.1): исключительно визуальная надстройка — таблица
     * цветов поверхности и откосов по ярусам, стиль укрытий и набор редкого
     * декора. Правила ядра поле не читают. Без поля (старые файлы) — луг.
     */
    biome: z.enum(["meadow", "swamp", "thicket", "scorched"]).optional(),
  })
  .strict();

export const resourcesSchema = z
  .object({
    gold: z.number().int().min(0),
    herbs: z.number().int().min(0),
    artifacts: z.number().int().min(0),
  })
  .strict();

export const scanConfigSchema = z
  .object({
    /** Радиус открытия точек на карте царства (единицы карты, 1…100). */
    radius: z.number().int().min(1).max(100),
    /** Стоимость одного сканирования. */
    cost: resourcesSchema,
  })
  .strict();

export type MapGenConfig = z.infer<typeof mapGenConfigSchema>;
export type ResourcesConfig = z.infer<typeof resourcesSchema>;
export type ScanConfig = z.infer<typeof scanConfigSchema>;
