import JSON5 from "json5";
import { z } from "zod";
import {
  campaignConfigSchema,
  itemConfigSchema,
  prologueBestiarySchema,
  prologueConfigSchema,
  prologueHintsSchema,
  pvpConfigSchema,
  quickMatchConfigSchema,
  reinforcementsFileSchema,
  skillConfigSchema,
  trainingConfigSchema,
  unitConfigSchema,
  weaponConfigSchema,
  type CampaignConfig,
  type ItemConfig,
  type PrologueBestiaryConfig,
  type PrologueConfig,
  type PrologueHintsConfig,
  type PvpConfig,
  type QuickMatchConfig,
  type ReinforcementsFileConfig,
  type SkillConfig,
  type TrainingConfig,
  type UnitConfig,
  type WeaponConfig,
} from "./schemas.js";

export interface ContentBundle {
  campaign: CampaignConfig;
  quickMatch: QuickMatchConfig;
  pvp: PvpConfig;
  /** Режим обучения (0.19.0). */
  training: TrainingConfig;
  units: UnitConfig[];
  weapons: WeaponConfig[];
  skills: SkillConfig[];
  items: ItemConfig[];
  /** Пролог (0.20.31): бестиарий изолирован от канонических units/weapons. */
  prologue: PrologueConfig;
  prologueBestiary: PrologueBestiaryConfig;
  prologueHints: PrologueHintsConfig;
  reinforcements: ReinforcementsFileConfig;
}

export interface ContentIssue {
  file: string;
  message: string;
}

export type ContentLoadResult = { ok: true; data: ContentBundle } | { ok: false; issues: ContentIssue[] };

function parseFile<S extends z.ZodTypeAny>(
  file: string,
  raw: string,
  schema: S,
): { value?: z.output<S>; issue?: ContentIssue } {
  try {
    const json: unknown = JSON5.parse(raw);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return {
        issue: {
          file,
          message: parsed.error.issues.map((item) => item.message).join("; "),
        },
      };
    }
    return { value: parsed.data };
  } catch (error) {
    return {
      issue: {
        file,
        message: error instanceof Error ? error.message : "JSON5 parse error",
      },
    };
  }
}

function collect(files: Record<string, string>, folder: string): [string, string][] {
  return Object.entries(files).filter(([path]) => path.replace(/\\/g, "/").includes(`/${folder}/`));
}

export function parseContent(files: Record<string, string>): ContentLoadResult {
  const issues: ContentIssue[] = [];
  const byName = (suffix: string): string | undefined => {
    const hit = Object.entries(files).find(([path]) => path.replace(/\\/g, "/").endsWith(suffix));
    return hit?.[1];
  };

  const campaignRaw = byName("campaign.json5");
  const quickRaw = byName("quick-match.json5");
  const pvpRaw = byName("pvp.json5");
  const trainingRaw = byName("training.json5");
  const prologueRaw = byName("prologue_missions.json5");
  const bestiaryRaw = byName("prologue_bestiary.json5");
  const prologueHintsRaw = byName("prologue_hints.json5");
  const reinforcementsRaw = byName("reinforcements.json5");

  if (!campaignRaw) issues.push({ file: "campaign.json5", message: "file is missing" });
  if (!quickRaw) issues.push({ file: "quick-match.json5", message: "file is missing" });
  if (!pvpRaw) issues.push({ file: "pvp.json5", message: "file is missing" });
  if (!trainingRaw) issues.push({ file: "training.json5", message: "file is missing" });
  if (!prologueRaw) issues.push({ file: "prologue_missions.json5", message: "file is missing" });
  if (!bestiaryRaw) issues.push({ file: "prologue_bestiary.json5", message: "file is missing" });
  if (!prologueHintsRaw) issues.push({ file: "prologue_hints.json5", message: "file is missing" });
  if (!reinforcementsRaw) issues.push({ file: "reinforcements.json5", message: "file is missing" });

  const campaign = campaignRaw ? parseFile("campaign.json5", campaignRaw, campaignConfigSchema) : {};
  const quickMatch = quickRaw ? parseFile("quick-match.json5", quickRaw, quickMatchConfigSchema) : {};
  const pvp = pvpRaw ? parseFile("pvp.json5", pvpRaw, pvpConfigSchema) : {};
  const training = trainingRaw ? parseFile("training.json5", trainingRaw, trainingConfigSchema) : {};
  const prologue = prologueRaw ? parseFile("prologue_missions.json5", prologueRaw, prologueConfigSchema) : {};
  const prologueBestiary = bestiaryRaw ? parseFile("prologue_bestiary.json5", bestiaryRaw, prologueBestiarySchema) : {};
  const prologueHints = prologueHintsRaw
    ? parseFile("prologue_hints.json5", prologueHintsRaw, prologueHintsSchema)
    : {};
  const reinforcements = reinforcementsRaw
    ? parseFile("reinforcements.json5", reinforcementsRaw, reinforcementsFileSchema)
    : {};

  if (campaign.issue) issues.push(campaign.issue);
  if (quickMatch.issue) issues.push(quickMatch.issue);
  if (pvp.issue) issues.push(pvp.issue);
  if (training.issue) issues.push(training.issue);
  if (prologue.issue) issues.push(prologue.issue);
  if (prologueBestiary.issue) issues.push(prologueBestiary.issue);
  if (prologueHints.issue) issues.push(prologueHints.issue);
  if (reinforcements.issue) issues.push(reinforcements.issue);

  const units: UnitConfig[] = [];
  for (const [file, raw] of collect(files, "units")) {
    const parsed = parseFile(file, raw, unitConfigSchema);
    if (parsed.issue) issues.push(parsed.issue);
    else if (parsed.value) units.push(parsed.value);
  }

  const weapons: WeaponConfig[] = [];
  for (const [file, raw] of collect(files, "weapons")) {
    const parsed = parseFile(file, raw, weaponConfigSchema);
    if (parsed.issue) issues.push(parsed.issue);
    else if (parsed.value) weapons.push(parsed.value);
  }

  const skills: SkillConfig[] = [];
  for (const [file, raw] of collect(files, "skills")) {
    const parsed = parseFile(file, raw, skillConfigSchema);
    if (parsed.issue) issues.push(parsed.issue);
    else if (parsed.value) skills.push(parsed.value);
  }

  const items: ItemConfig[] = [];
  for (const [file, raw] of collect(files, "items")) {
    const parsed = parseFile(file, raw, itemConfigSchema);
    if (parsed.issue) issues.push(parsed.issue);
    else if (parsed.value) items.push(parsed.value);
  }

  const checkUnique = <T extends { id: string }>(kind: string, records: T[]): Set<string> => {
    const ids = new Set<string>();
    for (const record of records) {
      if (ids.has(record.id)) issues.push({ file: kind, message: `duplicate id: ${record.id}` });
      ids.add(record.id);
    }
    return ids;
  };
  const unitIds = checkUnique("units", units);
  const weaponIds = checkUnique("weapons", weapons);
  const skillIds = checkUnique("skills", skills);
  // Проверка уникальности: побочный эффект — запись замечаний (0.20.55).
  checkUnique("items", items);

  const prologueUnits = prologueBestiary.value?.units ?? [];
  const prologueWeapons = prologueBestiary.value?.weapons ?? [];
  const prologueUnitIds = checkUnique("prologue_bestiary units", prologueUnits);
  const prologueWeaponIds = checkUnique("prologue_bestiary weapons", prologueWeapons);
  for (const uid of prologueUnitIds) {
    if (unitIds.has(uid))
      issues.push({ file: "prologue_bestiary.json5", message: `unit id overlaps canonical units: ${uid}` });
  }
  for (const wid of prologueWeaponIds) {
    if (weaponIds.has(wid))
      issues.push({ file: "prologue_bestiary.json5", message: `weapon id overlaps canonical weapons: ${wid}` });
  }
  const allUnitIds = new Set<string>([...unitIds, ...prologueUnitIds]);
  const allWeaponIds = new Set<string>([...weaponIds, ...prologueWeaponIds]);
  for (const unit of prologueUnits) {
    for (const weaponId of unit.weapons) {
      if (!allWeaponIds.has(weaponId))
        issues.push({ file: `prologue_bestiary/${unit.id}`, message: `unknown weapon: ${weaponId}` });
    }
    for (const skillId of unit.skills) {
      if (!skillIds.has(skillId))
        issues.push({ file: `prologue_bestiary/${unit.id}`, message: `unknown skill: ${skillId}` });
    }
  }

  for (const unit of units) {
    for (const weaponId of unit.weapons) {
      if (!weaponIds.has(weaponId)) issues.push({ file: `units/${unit.id}`, message: `unknown weapon: ${weaponId}` });
    }
    for (const skillId of unit.skills) {
      if (!skillIds.has(skillId)) issues.push({ file: `units/${unit.id}`, message: `unknown skill: ${skillId}` });
    }
  }
  for (const skill of skills) {
    for (const effect of skill.effects) {
      if (effect.type === "spawn" && !unitIds.has(effect.unitId)) {
        issues.push({ file: `skills/${skill.id}`, message: `unknown spawned unit: ${effect.unitId}` });
      }
    }
  }
  for (const item of items) {
    if (item.weaponId && !weaponIds.has(item.weaponId)) {
      issues.push({ file: `items/${item.id}`, message: `unknown weapon: ${item.weaponId}` });
    }
  }
  if (quickMatch.value) {
    for (const unitId of [...quickMatch.value.playerSlots, ...quickMatch.value.enemyPool]) {
      if (!unitIds.has(unitId)) issues.push({ file: "quick-match.json5", message: `unknown unit: ${unitId}` });
    }
  }
  if (campaign.value) {
    const campaignConfig = campaign.value;
    const missionIds = new Set<string>();
    for (const mission of campaignConfig.missions) {
      if (missionIds.has(mission.id)) {
        issues.push({ file: "campaign.json5", message: `duplicate mission id: ${mission.id}` });
      }
      missionIds.add(mission.id);
      for (const entry of mission.enemies) {
        if (!unitIds.has(entry.unitId)) {
          issues.push({ file: "campaign.json5", message: `mission ${mission.id}: unknown unit: ${entry.unitId}` });
        }
      }
      for (const generalId of mission.generals ?? []) {
        if (!unitIds.has(generalId)) {
          issues.push({ file: "campaign.json5", message: `mission ${mission.id}: unknown general: ${generalId}` });
        }
      }
      if (mission.objectiveUnitId !== undefined && !unitIds.has(mission.objectiveUnitId)) {
        issues.push({
          file: "campaign.json5",
          message: `mission ${mission.id}: unknown objective unit: ${mission.objectiveUnitId}`,
        });
      }
      if (mission.escorteeUnitId !== undefined && !unitIds.has(mission.escorteeUnitId)) {
        issues.push({
          file: "campaign.json5",
          message: `mission ${mission.id}: unknown escortee unit: ${mission.escorteeUnitId}`,
        });
      }
      // Спасаемое лицо обязано уметь эвакуироваться (умение с признаком extract),
      // иначе миссия спасения невыполнима.
      if (mission.escorteeUnitId !== undefined) {
        const escortee = units.find((unit) => unit.id === mission.escorteeUnitId);
        const hasExtractSkill = escortee?.skills.some(
          (skillId) => skills.find((skill) => skill.id === skillId)?.extract === true,
        );
        if (!hasExtractSkill) {
          issues.push({
            file: "campaign.json5",
            message: `mission ${mission.id}: escortee ${mission.escorteeUnitId} lacks an extract skill`,
          });
        }
      }
    }
    // Ссылки дружины: рекрут и стартовый состав обязаны существовать среди записей юнитов.
    if (!unitIds.has(campaignConfig.recruitUnitId)) {
      issues.push({ file: "campaign.json5", message: `unknown recruit unit: ${campaignConfig.recruitUnitId}` });
    }
    for (const unitId of campaignConfig.initialRoster) {
      if (!unitIds.has(unitId)) {
        issues.push({ file: "campaign.json5", message: `unknown initial roster unit: ${unitId}` });
      }
    }
    // Согласованность финальной миссии: если в конфигурации есть миссия типа
    // «needle», её идентификатор обязан совпадать с needleMissionId, и наоборот —
    // точка, на которую ссылается needleMissionId, не может быть иного типа.
    for (const mission of campaignConfig.missions) {
      if (mission.type === "needle" && mission.id !== campaignConfig.needleMissionId) {
        issues.push({
          file: "campaign.json5",
          message: `needle mission ${mission.id} does not match needleMissionId ${campaignConfig.needleMissionId}`,
        });
      }
    }
    const needlePoint = campaignConfig.missions.find((mission) => mission.id === campaignConfig.needleMissionId);
    if (!needlePoint) {
      // The final mission may be delivered in a later content pack; keep the
      // campaign playable but make the dangling reference visible to authors.
      console.warn(`campaign.json5: needleMissionId refers to missing mission ${campaignConfig.needleMissionId}`);
    }
    if (needlePoint && needlePoint.type !== "needle") {
      issues.push({
        file: "campaign.json5",
        message: `needleMissionId refers to mission ${needlePoint.id} of type ${needlePoint.type}, expected "needle"`,
      });
    }
  }
  if (pvp.value) {
    for (const unitId of pvp.value.pool) {
      if (!unitIds.has(unitId)) issues.push({ file: "pvp.json5", message: `unknown unit: ${unitId}` });
    }
  }

  // Ссылки миссий обучения: бойцы и противники должны существовать.
  if (training.value) {
    for (const mission of training.value.missions) {
      for (const unitId of mission.playerSlots) {
        if (!unitIds.has(unitId)) {
          issues.push({ file: "training.json5", message: `mission ${mission.id}: unknown player unit: ${unitId}` });
        }
      }
      for (const entry of mission.enemies) {
        if (!unitIds.has(entry.unitId)) {
          issues.push({
            file: "training.json5",
            message: `mission ${mission.id}: unknown enemy unit: ${entry.unitId}`,
          });
        }
      }
      for (const hint of mission.hints) {
        if (hint.targetUnitId !== undefined && !unitIds.has(hint.targetUnitId)) {
          issues.push({
            file: "training.json5",
            message: `mission ${mission.id}: unknown hint unit: ${hint.targetUnitId}`,
          });
        }
      }
    }
  }

  if (prologue.value) {
    const hintKeys = new Set((prologueHints.value?.hints ?? []).map((hint) => hint.key));
    const reinforcementProfiles = new Set<string>(["default", ...Object.keys(reinforcements.value?.profiles ?? {})]);
    const missionIds = new Set(prologue.value.missions.map((mission) => mission.id));
    for (const rosterUnit of prologue.value.roster) {
      if (!allUnitIds.has(rosterUnit)) {
        issues.push({ file: "prologue_missions.json5", message: `unknown roster unit: ${rosterUnit}` });
      }
    }
    if (!missionIds.has(prologue.value.prologueFinalMissionId)) {
      issues.push({
        file: "prologue_missions.json5",
        message: `prologueFinalMissionId refers to missing mission: ${prologue.value.prologueFinalMissionId}`,
      });
    }
    const reinforcementPools = [
      ...(reinforcements.value ? [reinforcements.value.default] : []),
      ...Object.values(reinforcements.value?.profiles ?? {}),
    ];
    for (const profile of reinforcementPools) {
      for (const poolUnitId of profile.pool) {
        if (!allUnitIds.has(poolUnitId)) {
          issues.push({ file: "reinforcements.json5", message: `unknown pool unit: ${poolUnitId}` });
        }
      }
    }
    for (const mission of prologue.value.missions) {
      if (mission.nextMissionId && !missionIds.has(mission.nextMissionId)) {
        issues.push({
          file: "prologue_missions.json5",
          message: `mission ${mission.id}: unknown nextMissionId: ${mission.nextMissionId}`,
        });
      }
      for (const slot of mission.playerSlots) {
        if (!allUnitIds.has(slot)) {
          issues.push({
            file: "prologue_missions.json5",
            message: `mission ${mission.id}: unknown player unit: ${slot}`,
          });
        }
      }
      for (const entry of mission.enemies ?? []) {
        if (!allUnitIds.has(entry.unitId)) {
          issues.push({
            file: "prologue_missions.json5",
            message: `mission ${mission.id}: unknown enemy unit: ${entry.unitId}`,
          });
        }
      }
      for (const hintKey of mission.hints ?? []) {
        if (!hintKeys.has(hintKey)) {
          issues.push({
            file: "prologue_missions.json5",
            message: `mission ${mission.id}: unknown hint key: ${hintKey}`,
          });
        }
      }
      if (mission.reinforcements && !reinforcementProfiles.has(mission.reinforcements)) {
        issues.push({
          file: "prologue_missions.json5",
          message: `mission ${mission.id}: unknown reinforcements profile: ${mission.reinforcements}`,
        });
      }
      for (const action of [...(mission.script?.priority ?? []), ...(mission.script?.actions ?? [])]) {
        if (action.unitId && !allUnitIds.has(action.unitId)) {
          issues.push({
            file: "prologue_missions.json5",
            message: `mission ${mission.id}: unknown script unit: ${action.unitId}`,
          });
        }
        if (action.weaponId && !allWeaponIds.has(action.weaponId)) {
          issues.push({
            file: "prologue_missions.json5",
            message: `mission ${mission.id}: unknown script weapon: ${action.weaponId}`,
          });
        }
      }
      if (mission.map.layout) {
        const { rows } = mission.map.layout;
        if (rows.some((row) => row.length !== mission.map.width)) {
          issues.push({
            file: "prologue_missions.json5",
            message: `mission ${mission.id}: layout row length != width`,
          });
        }
        if (rows.length !== mission.map.height) {
          issues.push({
            file: "prologue_missions.json5",
            message: `mission ${mission.id}: layout rows count != height`,
          });
        }
      }
    }
  }

  if (
    issues.length > 0 ||
    !campaign.value ||
    !quickMatch.value ||
    !pvp.value ||
    !training.value ||
    !prologue.value ||
    !prologueBestiary.value ||
    !prologueHints.value ||
    !reinforcements.value
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    data: {
      campaign: campaign.value,
      quickMatch: quickMatch.value,
      pvp: pvp.value,
      training: training.value,
      units,
      weapons,
      skills,
      items,
      prologue: prologue.value,
      prologueBestiary: prologueBestiary.value,
      prologueHints: prologueHints.value,
      reinforcements: reinforcements.value,
    },
  };
}
