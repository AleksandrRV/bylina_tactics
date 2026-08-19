import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_]+$/);

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
  timedLife: z.number().int().optional(),
});

export const weaponConfigSchema = z.object({
  id,
  category: z.enum(["melee", "ranged"]),
  apCost: z.number().int().min(1),
  endsTurn: z.boolean(),
  range: z.number().int().min(0),
  requiresLOS: z.boolean(),
  aimMod: z.number(),
  minDmg: z.number().int(),
  maxDmg: z.number().int(),
  crit: z.number().min(0).max(100),
  critBonus: z.number().min(0),
  envDmg: z.number().min(0),
  ignoreHalfCover: z.boolean().optional(),
  closeRangePenalty: z
    .object({
      distHLessThan: z.number().int().min(1),
      penalty: z.number(),
    })
    .optional(),
});

export const skillEffectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("damage"),
    minDmg: z.number(),
    maxDmg: z.number(),
    crit: z.number().optional(),
    critBonus: z.number().optional(),
  }),
  z.object({ type: z.literal("heal"), amount: z.number() }),
  z.object({
    type: z.literal("applyStatus"),
    status: z.enum(["poison", "panic", "immobile", "hidden", "flying", "timed"]),
    duration: z.number().int(),
    magnitude: z.number().optional(),
  }),
  z.object({
    type: z.literal("removeStatus"),
    status: z.enum(["poison", "panic", "immobile", "hidden", "flying", "timed"]),
  }),
  z.object({ type: z.literal("knockback") }),
  z.object({ type: z.literal("destroyCover") }),
  z.object({ type: z.literal("spawn"), unitId: id }),
  z.object({ type: z.literal("displace") }),
  z.object({ type: z.literal("flee") }),
  z.object({ type: z.literal("reveal") }),
]);

export const skillConfigSchema = z.object({
  id,
  apCost: z.number().int().min(1),
  endsTurn: z.boolean(),
  range: z.number().int().min(0),
  requiresLOS: z.boolean(),
  category: z.enum(["melee", "ranged", "self"]),
  resolution: z.enum(["attack", "will", "auto"]),
  envDmg: z.number().min(0),
  ignoreHalfCover: z.boolean().optional(),
  detectsHidden: z.boolean().optional(),
  affectsEnvironment: z.boolean().optional(),
  extract: z.boolean().optional(),
  radius: z.number().int().optional(),
  willPower: z.number().optional(),
  filter: z.enum(["enemies", "allies", "all", "cover"]).optional(),
  effects: z.array(skillEffectSchema),
});

export const mapGenConfigSchema = z.object({
  width: z.number().int().min(8).max(64),
  height: z.number().int().min(8).max(64),
  pitChance: z.number().min(0).max(1),
  coverDensity: z.number().min(0).max(1),
  heightMix: z.object({
    z0: z.number(),
    z1: z.number(),
    z2: z.number(),
  }),
});

export const campaignConfigSchema = z.object({
  rosterCap: z.number().int().min(5),
  deployMin: z.number().int().min(1),
  deployMax: z.number().int().min(1),
  classUnlockLevel: z.number().int().min(1),
  woundHpRatio: z.number().gt(0).max(1),
  darknessMax: z.number().int().min(1),
  needleMissionId: id,
});

export const quickMatchConfigSchema = z.object({
  playerSlots: z.tuple([id, id, id]),
  enemyPool: z.tuple([id, id, id]),
  difficulties: z
    .array(
      z.object({
        id: z.enum(["easy", "normal", "hard"]),
        enemyCount: z.number().int().min(1),
      }),
    )
    .min(1),
});

export const pvpConfigSchema = z.object({
  pool: z.array(id),
  nMin: z.number().int().min(1),
  objective: z.enum(["elimination", "apple", "choice"]),
});

export type UnitConfig = z.infer<typeof unitConfigSchema>;
export type WeaponConfig = z.infer<typeof weaponConfigSchema>;
export type SkillConfig = z.infer<typeof skillConfigSchema>;
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
export type QuickMatchConfig = z.infer<typeof quickMatchConfigSchema>;
export type PvpConfig = z.infer<typeof pvpConfigSchema>;
