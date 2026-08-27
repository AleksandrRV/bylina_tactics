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
  preferredRange: z.number().int().min(0).optional(),
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
  z.object({
    type: z.literal("spawn"),
    unitId: id,
    /** Явная причина появления: призыв, иллюзия или воскрешение. Без поля — прежняя эвристика по записи умения. */
    spawnKind: z.enum(["summon", "illusion", "resurrection"]).optional(),
  }).strict(),
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
  affectsFlying: z.boolean().optional(),
  cooldownTurns: z.number().int().min(1).max(5).optional(),
  maxUsesPerBattle: z.number().int().min(1).optional(),
  effects: z.array(skillEffectSchema),
}).strict().superRefine((value, context) => {
  if (value.category === "self" && value.range !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["range"], message: "self skill range must be 0" });
  }
  if (value.resolution === "will" && value.willPower === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["willPower"], message: "willPower is required for will resolution" });
  }
  // Умение обязано иметь следствия, кроме умения с признаком извлечения:
  // эвакуация сама по себе является следствием (удаление с поля, §6 game-rules).
  if (value.effects.length === 0 && !value.extract) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["effects"], message: "effects must not be empty for non-extract skills" });
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
}).strict();

export const resourcesSchema = z.object({
  gold: z.number().int().min(0),
  herbs: z.number().int().min(0),
  artifacts: z.number().int().min(0),
}).strict();

export const scanConfigSchema = z.object({
  /** Радиус открытия точек на карте царства (единицы карты, 1…100). */
  radius: z.number().int().min(1).max(100),
  /** Стоимость одного сканирования. */
  cost: resourcesSchema,
}).strict();

export const missionConfigSchema = z.object({
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
  enemies: z.array(z.object({
    unitId: id,
    count: z.number().int().min(1),
  }).strict()).min(1),
  generals: z.array(id).optional(),
  /** Цель уничтожения: запись идола/строения (тип destroy, 0.13.0). */
  objectiveUnitId: id.optional(),
  /** Спасаемое лицо: запись сопровождаемого (тип rescue, 0.13.0). */
  escorteeUnitId: id.optional(),
}).strict().superRefine((value, context) => {
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

export const woundPenaltySchema = z.object({
  aim: z.number().int(),
  defense: z.number().int(),
  mobility: z.number().int(),
}).strict();

export const campaignConfigSchema = z.object({
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
}).strict().refine((value) => value.deployMin <= value.deployMax, {
  path: ["deployMax"],
  message: "deployMax must be >= deployMin",
});

export const itemConfigSchema = z.object({
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
}).strict().superRefine((value, context) => {
  const hasEffect = value.weaponId !== undefined
    || value.aimMod !== undefined
    || value.defenseMod !== undefined
    || value.mobilityMod !== undefined
    || value.maxHpMod !== undefined;
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
  /** Заготовка поля режима (roadmap 0.14.0: «Комната сбора без сети»). */
  map: mapGenConfigSchema.optional(),
}).strict();

/**
 * Запись хода Нави в сценарии обучения (0.20.13). Структурно совместима с
 * типом TrainingEnemyAction ядра (@bylina/core): конфигурация передаётся
 * исполнителю сценария без преобразования.
 */
export const trainingEnemyActionSchema = z.object({
  unitId: id.optional(),
  kind: z.enum(["attack", "skill", "approach", "defend", "overwatch", "resurrect", "endTurn"]),
  targetUnitId: id.optional(),
  weaponId: id.optional(),
  skillId: id.optional(),
  corpseUnitId: id.optional(),
  onlyIf: z.enum(["targetAlive", "targetNotPoisoned", "targetWounded", "corpseExists"]).optional(),
}).strict();

export const trainingEnemyScriptSchema = z.object({
  priority: z.array(trainingEnemyActionSchema),
  actions: z.array(trainingEnemyActionSchema),
}).strict();

export const trainingHintSchema = z.object({
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
}).strict();

export const trainingMissionSchema = z.object({
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
  notes: z.object({
    poison: z.string().min(1),
    resurrect: z.string().min(1),
    summon: z.string().min(1),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
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
export const trainingConfigSchema = z.object({
  missions: z.array(trainingMissionSchema).length(3),
}).strict();

export type TrainingHintConfig = z.infer<typeof trainingHintSchema>;
export type TrainingMissionConfig = z.infer<typeof trainingMissionSchema>;
export type TrainingConfig = z.infer<typeof trainingConfigSchema>;

export type UnitConfig = z.infer<typeof unitConfigSchema>;
export type WeaponConfig = z.infer<typeof weaponConfigSchema>;
export type SkillConfig = z.infer<typeof skillConfigSchema>;
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
export type MissionConfig = z.infer<typeof missionConfigSchema>;
export type MapGenConfig = z.infer<typeof mapGenConfigSchema>;
export type QuickMatchConfig = z.infer<typeof quickMatchConfigSchema>;
export type PvpConfig = z.infer<typeof pvpConfigSchema>;
export type WoundPenaltyConfig = z.infer<typeof woundPenaltySchema>;
export type ItemConfig = z.infer<typeof itemConfigSchema>;
export type ResourcesConfig = z.infer<typeof resourcesSchema>;
export type ScanConfig = z.infer<typeof scanConfigSchema>;
