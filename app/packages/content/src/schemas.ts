import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_]+$/);
const positiveDuration = z.number().int().min(1);
const statusId = z.enum(["poison", "panic", "immobile", "hidden", "flying", "timed"]);

export const unitConfigSchema = z.object({
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
  timedLife: positiveDuration.optional(),
}).strict();

export const weaponConfigSchema = z.object({
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
  closeRangePenalty: z.object({
    distHLessThan: z.number().int().min(1),
    penalty: z.number().min(0),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.maxDmg < value.minDmg) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["maxDmg"], message: "maxDmg must be >= minDmg" });
  }
  if (value.category === "melee" && value.range !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["range"], message: "melee weapon range must be 1" });
  }
});

const damageEffectSchema = z.object({
  type: z.literal("damage"),
  minDmg: z.number().int().min(0),
  maxDmg: z.number().int().min(0),
  crit: z.number().int().min(0).max(100).optional(),
  critBonus: z.number().int().min(0).optional(),
}).strict();

export const skillEffectSchema = z.discriminatedUnion("type", [
  damageEffectSchema,
  z.object({ type: z.literal("heal"), amount: z.number().int().min(1) }).strict(),
  z.object({ type: z.literal("applyStatus"), status: statusId, duration: positiveDuration, magnitude: z.number().optional() }).strict(),
  z.object({ type: z.literal("removeStatus"), status: statusId }).strict(),
  z.object({ type: z.literal("knockback") }).strict(),
  z.object({ type: z.literal("destroyCover") }).strict(),
  z.object({ type: z.literal("spawn"), unitId: id }).strict(),
  z.object({ type: z.literal("displace") }).strict(),
  z.object({ type: z.literal("flee") }).strict(),
  z.object({ type: z.literal("reveal") }).strict(),
]);

export const skillConfigSchema = z.object({
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
  cooldownTurns: z.number().int().min(1).max(5).optional(),
  maxUsesPerBattle: z.number().int().min(1).optional(),
  effects: z.array(skillEffectSchema).min(1),
}).strict().superRefine((value, context) => {
  if (value.category === "self" && value.range !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["range"], message: "self skill range must be 0" });
  }
  if (value.resolution === "will" && value.willPower === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["willPower"], message: "willPower is required for will resolution" });
  }
  const hasSpawn = value.effects.some((effect) => effect.type === "spawn");
  if (hasSpawn && value.maxUsesPerBattle !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["maxUsesPerBattle"], message: "summoning skills must have maxUsesPerBattle = 1" });
  }
  if (!hasSpawn && value.cooldownTurns === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cooldownTurns"], message: "non-summoning skills require cooldownTurns from 1 to 5" });
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

export const mapGenConfigSchema = z.object({
  width: z.number().int().min(8).max(64),
  height: z.number().int().min(8).max(64),
  pitChance: z.number().min(0).max(1),
  coverDensity: z.number().min(0).max(1),
  wallDensity: z.number().min(0).max(1),
  edgeCoverChance: z.number().min(0).max(1),
  halfCoverChance: z.number().min(0).max(1),
  heightMix: z.object({
    z0: z.number().min(0).max(1),
    z1: z.number().min(0).max(1),
    z2: z.number().min(0).max(1),
  }).strict().refine((mix) => Math.abs(mix.z0 + mix.z1 + mix.z2 - 1) < 1e-9, "heightMix values must sum to 1"),
}).strict();

export const campaignConfigSchema = z.object({
  rosterCap: z.number().int().min(5),
  deployMin: z.number().int().min(1).max(5),
  deployMax: z.number().int().min(1).max(5),
  classUnlockLevel: z.number().int().min(1),
  woundHpRatio: z.number().gt(0).max(1),
  darknessMax: z.number().int().min(1),
  needleMissionId: id,
}).strict().refine((value) => value.deployMin <= value.deployMax, {
  path: ["deployMax"],
  message: "deployMax must be >= deployMin",
});

export const quickMatchConfigSchema = z.object({
  playerSlots: z.tuple([id, id, id]),
  enemyPool: z.tuple([id, id, id]),
  difficulties: z.array(z.object({
    id: z.enum(["easy", "normal", "hard"]),
    enemyCount: z.number().int().min(1),
  }).strict()).length(3),
  map: mapGenConfigSchema,
}).strict().superRefine((value, context) => {
  const ids = value.difficulties.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["difficulties"], message: "difficulty ids must be unique" });
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

export const pvpConfigSchema = z.object({
  pool: z.array(id),
  nMin: z.number().int().min(1),
  objective: z.enum(["elimination", "apple", "choice"]),
}).strict();

export type UnitConfig = z.infer<typeof unitConfigSchema>;
export type WeaponConfig = z.infer<typeof weaponConfigSchema>;
export type SkillConfig = z.infer<typeof skillConfigSchema>;
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
export type MapGenConfig = z.infer<typeof mapGenConfigSchema>;
export type QuickMatchConfig = z.infer<typeof quickMatchConfigSchema>;
export type PvpConfig = z.infer<typeof pvpConfigSchema>;
