import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { parseContent } from "@bylina/content";
import { createI18n, loadBundledCatalogs, manifest } from "@bylina/i18n";
import { weaponStatsFromRecord, type EntityState, type SkillStats, type WeaponStats } from "@bylina/core";
import { buildUnitInfo, type UnitInfo } from "../src/unit-info.js";
import { dataTree } from "./training-sim.js";

/**
 * Окно информации о бойце (0.20.53): описание приходит из словаря, а числа —
 * из снимка боя и записей контента. Тест проверяет именно это: правка
 * здоровья, урона или состава экипировки видна в окне без правки переводов.
 */

const i18n = createI18n({ manifest, catalogs: loadBundledCatalogs(), initialLanguage: "ru" });
const t = i18n.t.bind(i18n);

/** Карты оружия и умений из контента: канон и бестиарий пролога вместе. */
function contentMaps(): { weapons: Record<string, WeaponStats>; skills: Record<string, SkillStats>; units: string[] } {
  const parsed = parseContent(dataTree());
  if (!parsed.ok) throw new Error(`content parse failed: ${JSON.stringify(parsed.issues)}`);
  const weapons: Record<string, WeaponStats> = {};
  for (const record of parsed.data.weapons) weapons[record.id] = weaponStatsFromRecord(record);
  for (const record of parsed.data.prologueBestiary?.weapons ?? []) {
    weapons[record.id] = weaponStatsFromRecord(record);
  }
  const skills: Record<string, SkillStats> = {};
  for (const record of parsed.data.skills) skills[record.id] = record as SkillStats;
  const units = [...parsed.data.units, ...(parsed.data.prologueBestiary?.units ?? [])].map((unit) => unit.id);
  return { weapons, skills, units };
}

const maps = contentMaps();

/** Боец снимка: поля, обязательные для ядра, одинаковы у всех записей. */
function entity(overrides: Partial<EntityState> = {}): EntityState {
  return {
    id: 7,
    configId: "bogatyr",
    owner: 1,
    x: 2,
    y: 3,
    z: 0,
    dir: 0,
    ap: 2,
    maxAp: 2,
    mobility: 4,
    hp: 12,
    maxHp: 12,
    aim: 70,
    defense: 10,
    vision: 12,
    will: 40,
    weaponId: "sword",
    weaponIds: ["sword", "mace"],
    skillIds: [],
    obstacle: false,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    ...overrides,
  };
}

function info(overrides: Partial<EntityState> = {}, side: "ally" | "enemy" = "ally"): UnitInfo {
  return buildUnitInfo(entity(overrides), { weapons: maps.weapons, skills: maps.skills, side }, t);
}

function rowOf(unitInfo: UnitInfo, label: string): string | undefined {
  return unitInfo.rows.find((row) => row.label === label)?.value;
}

describe("unit info window (0.20.53)", () => {
  it("names the fighter, its side and its description from the catalog", () => {
    const card = info();
    expect(card.name).toBe("Богатырь");
    expect(card.side).toBe("Дружина");
    // Описание — не сырой ключ: без словарной записи окно пустеет.
    expect(card.flavor.length).toBeGreaterThan(20);
    expect(card.portrait, "портрет бойца").toBeTruthy();
  });

  it("takes the numbers from the snapshot, not from the content record", () => {
    // Раненый боец с потраченным очком действия: окно показывает текущее.
    const card = info({ hp: 7, ap: 1, defending: true });
    expect(rowOf(card, t("unit.info.hp"))).toBe("7 / 12");
    expect(rowOf(card, t("action.info.apCost"))).toBe("1 / 2");
    expect(rowOf(card, t("unit.info.mobility"))).toBe(`4 ${t("action.info.cell")}`);
    expect(rowOf(card, t("unit.info.aim"))).toBe("70");
    expect(rowOf(card, t("unit.info.defense"))).toBe("10");
    expect(rowOf(card, t("unit.info.will"))).toBe("40");
    expect(rowOf(card, t("unit.info.vision"))).toBe(`12 ${t("action.info.cell")}`);
  });

  it("lists the equipment with the drawn weapon first and marked", () => {
    const card = info({ weaponId: "mace", weaponIds: ["sword", "mace"] });
    const equipment = card.sections.find((section) => section.id === "equipment");
    expect(equipment, "раздел экипировки").toBeDefined();
    // В руках — палица, и она стоит первою: ответ на вопрос «чем он бьёт».
    expect(equipment!.items.map((item) => item.id)).toEqual(["mace", "sword"]);
    expect(equipment!.items[0]!.current).toBe(true);
    expect(equipment!.items[1]!.current).toBeUndefined();
    const mace = maps.weapons.mace!;
    expect(equipment!.items[0]!.note).toContain(`${mace.minDmg}–${mace.maxDmg}`);
    expect(equipment!.items[0]!.note).toContain(`${mace.range} ${t("action.info.cell")}`);
  });

  it("shows a skill with its cost, cooldown and remaining uses", () => {
    const card = info({
      configId: "bogatyr",
      skillIds: ["shield_bash", "summon_forest_beast"],
      skillCooldowns: { shield_bash: 2 },
    });
    const skills = card.sections.find((section) => section.id === "skills");
    expect(skills, "раздел умений").toBeDefined();
    const byId = new Map(skills!.items.map((item) => [item.id, item.note]));
    // Цена в очках действия есть всегда; перезарядка и предел — когда они есть.
    expect(byId.get("shield_bash")).toContain(t("battle.cooldownShort", { turns: 2 }));
    // Остаток применений считается от предела записи: призыв зверя — один за бой.
    expect(byId.get("summon_forest_beast")).toContain(t("battle.usesShort", { uses: 1 }));
    expect(byId.get("summon_forest_beast")).toContain(t("battle.apLeft"));
    // Потраченный призыв: остаток ноль, а не отрицательное число.
    const spent = info({ skillIds: ["summon_forest_beast"], skillUses: { summon_forest_beast: 1 } });
    const spentSkills = spent.sections.find((section) => section.id === "skills");
    expect(spentSkills!.items[0]!.note).toContain(t("battle.usesShort", { uses: 0 }));
  });

  it("collects the live states: stance, overwatch, poison, panic, summon timer", () => {
    const card = info({
      defending: true,
      overwatch: true,
      poison: { damagePerTurn: 1, turnsLeft: 2 },
      panic: { sourceId: 3, turnsLeft: 1 },
      immobileTurns: 3,
      timedLife: 2,
      hidden: true,
      flying: true,
    });
    expect(card.states).toContain(t("unit.info.stateDefend"));
    expect(card.states).toContain(t("unit.info.stateOverwatch"));
    expect(card.states).toContain(t("unit.info.statePoison", { turns: 2 }));
    expect(card.states).toContain(t("unit.info.statePanic", { turns: 1 }));
    expect(card.states).toContain(t("unit.info.stateImmobile", { turns: 3 }));
    expect(card.states).toContain(t("unit.info.stateTimed", { turns: 2 }));
    expect(card.states).toContain(t("unit.info.stateHidden"));
    expect(card.states).toContain(t("unit.info.stateFlying"));
    // Павший отмечен первым: состояние, а не параметр.
    expect(info({ dead: true }).states[0]).toBe(t("unit.info.fallen"));
  });

  it("marks the enemy by its side and omits empty sections", () => {
    // Крыса пролога: только укус, умений нет — раздела умений быть не должно.
    const rat = buildUnitInfo(
      entity({
        id: 4,
        configId: "forest_rat",
        hp: 2,
        maxHp: 2,
        aim: 50,
        defense: 0,
        will: 10,
        vision: 10,
        weaponId: "teeth",
        weaponIds: ["teeth"],
      }),
      { weapons: maps.weapons, skills: maps.skills, side: "enemy" },
      t,
    );
    expect(rat.side).toBe("Навь");
    expect(rat.name).toBe("Лесная крыса");
    expect(rat.sections.map((section) => section.id)).toEqual(["equipment"]);

    // Княжна: оружия нет, умение есть — раздел ровно один.
    const captive = buildUnitInfo(
      entity({
        id: 5,
        configId: "captive",
        hp: 5,
        maxHp: 5,
        aim: 0,
        defense: 0,
        will: 20,
        vision: 8,
        weaponId: "",
        weaponIds: [],
        skillIds: ["evacuate"],
      }),
      { weapons: maps.weapons, skills: maps.skills, side: "ally" },
      t,
    );
    expect(captive.sections.map((section) => section.id)).toEqual(["skills"]);
  });

  it("describes every unit of the canon and of the prologue in both languages", () => {
    // Описание подставляется динамическим ключом: пропуск виден только
    // в бою, поэтому его ловит тест, а не игрок.
    const locales = ["ru", "en"] as const;
    for (const locale of locales) {
      const path = join(dirname(fileURLToPath(import.meta.url)), `../../i18n/locales/${locale}/ui.json`);
      const catalog = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, { desc?: string }>>;
      for (const id of maps.units) {
        const entry = catalog.unit?.[id];
        expect(entry, `${locale}: unit.${id}`).toBeDefined();
        expect(entry!.desc ?? "", `${locale}: unit.${id}.desc`).not.toBe("");
      }
    }
  });
});
