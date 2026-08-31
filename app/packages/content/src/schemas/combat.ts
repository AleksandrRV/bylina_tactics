/** Боец, оружие и умение: основа бестиария и дружины (0.20.56). */

import { z } from "zod";
import { id, positiveDuration, statusId } from "./common.js";

export const unitConfigSchema = z
  .object({
    id,
    classId: id.optional(),
    side: z.enum(["druzhina", "nav", "pvp"]),
    maxHealth: z.number().int().min(1),
    maxAP: z.number().int().min(1),
    mobility: z.number().int().min(1),
    aim: z.number(),
    defense: z.number(),
    will: z.number().min(0),
    vision: z.number().int().min(0),
    weapons: z.array(id),
    skills: z.array(id),
    tags: z.array(z.enum(["flying", "hiddenStart"])),
    fleeHp: z.number().int().optional(),
    camouflageMinCover: z.boolean().optional(),
    providesCamouflage: z.boolean().optional(),
    decoy: z.boolean().optional(),
    preferredRange: z.number().int().min(0).optional(),
    timedLife: positiveDuration.optional(),
  })
  .strict();

export const weaponConfigSchema = z
  .object({
    id,
    category: z.enum(["melee", "ranged"]),
    apCost: z.number().int().min(1),
    endsTurn: z.boolean(),
    range: z.number().int().min(0),
    requiresLOS: z.boolean(),
    aimMod: z.number(),
    minDmg: z.number().int().min(0),
    maxDmg: z.number().int().min(0),
    crit: z.number().int().min(0).max(100),
    critBonus: z.number().int().min(0),
    envDmg: z.number().int().min(0),
    ignoreHalfCover: z.boolean().optional(),
    closeRangePenalty: z
      .object({
        distHLessThan: z.number().int().min(1),
        penalty: z.number().min(0),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.maxDmg < value.minDmg) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["maxDmg"], message: "maxDmg must be >= minDmg" });
    }
    if (value.category === "melee" && value.range !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["range"], message: "melee weapon range must be 1" });
    }
  });

const damageEffectSchema = z
  .object({
    type: z.literal("damage"),
    minDmg: z.number().int().min(0),
    maxDmg: z.number().int().min(0),
    crit: z.number().int().min(0).max(100).optional(),
    critBonus: z.number().int().min(0).optional(),
  })
  .strict();

export const skillEffectSchema = z.discriminatedUnion("type", [
  damageEffectSchema,
  z.object({ type: z.literal("heal"), amount: z.number().int().min(1) }).strict(),
  z
    .object({
      type: z.literal("applyStatus"),
      status: statusId,
      duration: positiveDuration,
      magnitude: z.number().optional(),
    })
    .strict(),
  z.object({ type: z.literal("removeStatus"), status: statusId }).strict(),
  z.object({ type: z.literal("knockback") }).strict(),
  z.object({ type: z.literal("destroyCover") }).strict(),
  z
    .object({
      type: z.literal("spawn"),
      unitId: id,
      /** Явная причина появления: призыв, иллюзия или воскрешение. Без поля — прежняя эвристика по записи умения. */
      spawnKind: z.enum(["summon", "illusion", "resurrection"]).optional(),
    })
    .strict(),
  z.object({ type: z.literal("displace") }).strict(),
  z.object({ type: z.literal("flee") }).strict(),
  z.object({ type: z.literal("reveal") }).strict(),
]);

export const skillConfigSchema = z
  .object({
    id,
    apCost: z.number().int().min(1),
    endsTurn: z.boolean(),
    range: z.number().int().min(0),
    requiresLOS: z.boolean(),
    category: z.enum(["melee", "ranged", "self"]),
    resolution: z.enum(["attack", "will", "auto"]),
    envDmg: z.number().int().min(0),
    ignoreHalfCover: z.boolean().optional(),
    detectsHidden: z.boolean().optional(),
    affectsEnvironment: z.boolean().optional(),
    extract: z.boolean().optional(),
    radius: z.number().int().min(0).optional(),
    willPower: z.number().optional(),
    filter: z.enum(["enemies", "allies", "all", "cover"]).optional(),
    affectsFlying: z.boolean().optional(),
    cooldownTurns: z.number().int().min(1).max(5).optional(),
    maxUsesPerBattle: z.number().int().min(1).optional(),
    effects: z.array(skillEffectSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.category === "self" && value.range !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["range"], message: "self skill range must be 0" });
    }
    if (value.resolution === "will" && value.willPower === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["willPower"],
        message: "willPower is required for will resolution",
      });
    }
    // Умение обязано иметь следствия, кроме умения с признаком извлечения:
    // эвакуация сама по себе является следствием (удаление с поля, §6 game-rules).
    if (value.effects.length === 0 && !value.extract) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effects"],
        message: "effects must not be empty for non-extract skills",
      });
    }
    const hasSpawn = value.effects.some((effect) => effect.type === "spawn");
    if (hasSpawn && value.maxUsesPerBattle !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxUsesPerBattle"],
        message: "summoning skills must have maxUsesPerBattle = 1",
      });
    }
    if (!hasSpawn && value.cooldownTurns === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cooldownTurns"],
        message: "non-summoning skills require cooldownTurns from 1 to 5",
      });
    }
    value.effects.forEach((effect, index) => {
      if (effect.type === "damage" && effect.maxDmg < effect.minDmg) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["effects", index, "maxDmg"],
          message: "maxDmg must be >= minDmg",
        });
      }
    });
  });

export type UnitConfig = z.infer<typeof unitConfigSchema>;
export type WeaponConfig = z.infer<typeof weaponConfigSchema>;
export type SkillConfig = z.infer<typeof skillConfigSchema>;
