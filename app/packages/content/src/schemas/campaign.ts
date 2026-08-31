/** Былина: миссии, ранения, предметы (0.20.56). */

import { z } from "zod";
import { id } from "./common.js";
import { mapGenConfigSchema, resourcesSchema, scanConfigSchema } from "./world.js";

export const missionConfigSchema = z
  .object({
    id,
    type: z.enum(["purge", "destroy", "rescue", "recon", "needle"]),
    darknessOnVictory: z.number().int().min(0),
    darknessOnDefeat: z.number().int().min(0),
    /** Положение точки на карте царства (0…100 по каждой оси). */
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    /** Награда миссии при успехе: золото, травы, артефакты. */
    rewards: resourcesSchema,
    map: mapGenConfigSchema,
    enemies: z
      .array(
        z
          .object({
            unitId: id,
            count: z.number().int().min(1),
          })
          .strict(),
      )
      .min(1),
    generals: z.array(id).optional(),
    /** Цель уничтожения: запись идола/строения (тип destroy, 0.13.0). */
    objectiveUnitId: id.optional(),
    /** Спасаемое лицо: запись сопровождаемого (тип rescue, 0.13.0). */
    escorteeUnitId: id.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const capacity = Math.max(0, 2 * (value.map.height - 2));
    const total = value.enemies.reduce((sum, entry) => sum + entry.count, 0);
    if (total > capacity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enemies"],
        message: `total enemy count ${total} exceeds map spawn capacity ${capacity}`,
      });
    }
    if (value.type === "destroy" && value.objectiveUnitId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["objectiveUnitId"],
        message: "destroy missions require objectiveUnitId",
      });
    }
    if (value.type === "rescue" && value.escorteeUnitId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["escorteeUnitId"],
        message: "rescue missions require escorteeUnitId",
      });
    }
    // Зона эвакуации нужна спасению и разведке (game-design §3.2).
    if ((value.type === "rescue" || value.type === "recon") && value.map.extract !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["map", "extract"],
        message: `${value.type} missions require map.extract = true`,
      });
    }
  });

export const woundPenaltySchema = z
  .object({
    aim: z.number().int(),
    defense: z.number().int(),
    mobility: z.number().int(),
  })
  .strict();

export const campaignConfigSchema = z
  .object({
    rosterCap: z.number().int().min(5),
    deployMin: z.number().int().min(1).max(5),
    deployMax: z.number().int().min(1).max(5),
    classUnlockLevel: z.number().int().min(1),
    woundHpRatio: z.number().gt(0).max(1),
    darknessMax: z.number().int().min(1),
    needleMissionId: id,
    /** Запись юнита-рекрута без класса. */
    recruitUnitId: id,
    /** Стартовый состав дружины (записи классов). */
    initialRoster: z.array(id).min(1),
    /** Штрафы ранения, действующие до лечения в Горнице. */
    woundPenalty: woundPenaltySchema,
    /** Начальные запасы корабля. */
    startingResources: resourcesSchema,
    /** Правила открытия участков карты сканированием. */
    scan: scanConfigSchema,
    missions: z.array(missionConfigSchema).min(1),
  })
  .strict()
  .refine((value) => value.deployMin <= value.deployMax, {
    path: ["deployMax"],
    message: "deployMax must be >= deployMin",
  });

export const itemConfigSchema = z
  .object({
    id,
    /** Оружие из записей `weapons`: добавляется бойцу в сражении. */
    weaponId: id.optional(),
    /** Модификаторы характеристик бойца в сражении. */
    aimMod: z.number().int().optional(),
    defenseMod: z.number().int().optional(),
    mobilityMod: z.number().int().optional(),
    maxHpMod: z.number().int().optional(),
    /** Стоимость изготовления в Кузне. */
    cost: resourcesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasEffect =
      value.weaponId !== undefined ||
      value.aimMod !== undefined ||
      value.defenseMod !== undefined ||
      value.mobilityMod !== undefined ||
      value.maxHpMod !== undefined;
    if (!hasEffect) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weaponId"],
        message: "item must provide a weapon or at least one stat modifier",
      });
    }
    const total = value.cost.gold + value.cost.herbs + value.cost.artifacts;
    if (total <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cost"],
        message: "item cost must be positive",
      });
    }
  });

export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
export type MissionConfig = z.infer<typeof missionConfigSchema>;
export type WoundPenaltyConfig = z.infer<typeof woundPenaltySchema>;
export type ItemConfig = z.infer<typeof itemConfigSchema>;
