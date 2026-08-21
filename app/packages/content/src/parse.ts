import JSON5 from "json5";
import { z } from "zod";
import {
  campaignConfigSchema,
  itemConfigSchema,
  pvpConfigSchema,
  quickMatchConfigSchema,
  skillConfigSchema,
  unitConfigSchema,
  weaponConfigSchema,
  type CampaignConfig,
  type ItemConfig,
  type PvpConfig,
  type QuickMatchConfig,
  type SkillConfig,
  type UnitConfig,
  type WeaponConfig,
} from "./schemas.js";

export interface ContentBundle {
  campaign: CampaignConfig;
  quickMatch: QuickMatchConfig;
  pvp: PvpConfig;
  units: UnitConfig[];
  weapons: WeaponConfig[];
  skills: SkillConfig[];
  items: ItemConfig[];
}

export interface ContentIssue {
  file: string;
  message: string;
}

export type ContentLoadResult =
  | { ok: true; data: ContentBundle }
  | { ok: false; issues: ContentIssue[] };

function parseFile<T>(file: string, raw: string, schema: z.ZodType<T>): { value?: T; issue?: ContentIssue } {
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

  if (!campaignRaw) issues.push({ file: "campaign.json5", message: "file is missing" });
  if (!quickRaw) issues.push({ file: "quick-match.json5", message: "file is missing" });
  if (!pvpRaw) issues.push({ file: "pvp.json5", message: "file is missing" });

  const campaign = campaignRaw ? parseFile("campaign.json5", campaignRaw, campaignConfigSchema) : {};
  const quickMatch = quickRaw ? parseFile("quick-match.json5", quickRaw, quickMatchConfigSchema) : {};
  const pvp = pvpRaw ? parseFile("pvp.json5", pvpRaw, pvpConfigSchema) : {};

  if (campaign.issue) issues.push(campaign.issue);
  if (quickMatch.issue) issues.push(quickMatch.issue);
  if (pvp.issue) issues.push(pvp.issue);

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
  const itemIds = checkUnique("items", items);

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
        issues.push({ file: "campaign.json5", message: `mission ${mission.id}: unknown objective unit: ${mission.objectiveUnitId}` });
      }
      if (mission.escorteeUnitId !== undefined && !unitIds.has(mission.escorteeUnitId)) {
        issues.push({ file: "campaign.json5", message: `mission ${mission.id}: unknown escortee unit: ${mission.escorteeUnitId}` });
      }
      // Спасаемое лицо обязано уметь эвакуироваться (умение с признаком extract),
      // иначе миссия спасения невыполнима.
      if (mission.escorteeUnitId !== undefined) {
        const escortee = units.find((unit) => unit.id === mission.escorteeUnitId);
        const hasExtractSkill = escortee?.skills.some((skillId) =>
          skills.find((skill) => skill.id === skillId)?.extract === true
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

  if (issues.length > 0 || !campaign.value || !quickMatch.value || !pvp.value) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    data: {
      campaign: campaign.value,
      quickMatch: quickMatch.value,
      pvp: pvp.value,
      units,
      weapons,
      skills,
      items,
    },
  };
}
