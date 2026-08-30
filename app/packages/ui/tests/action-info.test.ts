import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createI18n, loadBundledCatalogs, manifest } from "@bylina/i18n";
import type { SkillStats, WeaponStats } from "@bylina/core";
import { actionArt, actionArtFile, knownActionArtIds } from "../src/action-art.js";
import { skillActionInfo, stanceActionInfo, weaponActionInfo } from "../src/action-info.js";

/**
 * Содержимое окна информации о действии (0.20.46): числа берутся из
 * боевых данных, поэтому правка урона или стоимости видна в окне без
 * правки переводов — тест проверяет именно это, а не текст строк.
 */

const i18n = createI18n({
  manifest,
  catalogs: loadBundledCatalogs(),
  initialLanguage: "ru",
});
const t = i18n.t.bind(i18n);

const SWORD: WeaponStats = {
  id: "sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 4,
  maxDmg: 6,
  crit: 15,
  critBonus: 2,
  envDmg: 0,
};

const SHIELD_BASH: SkillStats = {
  id: "shield_bash",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  category: "melee",
  resolution: "attack",
  envDmg: 0,
  filter: "enemies",
  cooldownTurns: 1,
  effects: [
    { type: "damage", minDmg: 1, maxDmg: 2 },
    { type: "knockback" },
  ],
};

function rowOf(rows: { label: string; value: string }[], label: string): string | undefined {
  return rows.find((row) => row.label === label)?.value;
}

describe("action art (0.20.46)", () => {
  it("gives every shipped weapon and skill its own image", () => {
    const ids = knownActionArtIds();
    for (const id of ["sword", "bow", "club", "teeth", "defend", "overwatch", "heal", "evacuate"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("reuses the base art for debug weapons and stays silent for unknown ids", () => {
    expect(actionArtFile("sword_debug")).toBe("sword.jpg");
    expect(actionArtFile("bow_debug")).toBe("bow.jpg");
    expect(actionArtFile("no_such_action")).toBeUndefined();
    expect(actionArt("no_such_action")).toBeUndefined();
  });

  it("returns a document-relative url for a known action", () => {
    const url = actionArt("sword");
    expect(url).toBeDefined();
    expect(url).toContain("actions/sword.jpg");
  });
});

describe("action info content (0.20.46)", () => {
  it("reads weapon numbers from the battle data, not from the catalog", () => {
    const info = weaponActionInfo("sword", SWORD, t);
    expect(info.name).toBe(t("weapon.sword.name"));
    expect(info.flavor.length, "нарративная строка из словаря").toBeGreaterThan(0);
    expect(rowOf(info.rows, t("action.info.damage"))).toBe("4–6");
    expect(rowOf(info.rows, t("action.info.crit"))).toBe("15% +2");
    expect(rowOf(info.rows, t("action.info.range"))).toBe(`1 ${t("action.info.cell")}`);
    expect(rowOf(info.rows, t("action.info.apCost"))).toBe("1");
    expect(rowOf(info.rows, t("action.info.endsTurn"))).toBe(t("action.info.yes"));
  });

  it("follows a weapon that was rebalanced", () => {
    const rebalanced: WeaponStats = { ...SWORD, apCost: 2, endsTurn: false, minDmg: 7, maxDmg: 7, crit: 0 };
    const info = weaponActionInfo("sword", rebalanced, t);
    expect(rowOf(info.rows, t("action.info.damage"))).toBe("7–7");
    expect(rowOf(info.rows, t("action.info.apCost"))).toBe("2");
    expect(rowOf(info.rows, t("action.info.endsTurn"))).toBe(t("action.info.no"));
  });

  it("lists skill effects, target and resources", () => {
    const info = skillActionInfo("shield_bash", SHIELD_BASH, t);
    expect(info.name).toBe(t("skill.shield_bash.name"));
    expect(rowOf(info.rows, t("action.info.damage"))).toBe("1–2");
    expect(rowOf(info.rows, t("action.info.knockback"))).toBe(t("action.info.yes"));
    expect(rowOf(info.rows, t("action.info.target"))).toBe(t("action.info.targetEnemies"));
    expect(rowOf(info.rows, t("action.info.cooldown"))).toBe("1");
  });

  it("describes healing and status skills", () => {
    const heal: SkillStats = {
      ...SHIELD_BASH,
      id: "heal",
      category: "ranged",
      range: 6,
      filter: "allies",
      cooldownTurns: 2,
      effects: [{ type: "heal", amount: 4 }],
    };
    const info = skillActionInfo("heal", heal, t);
    expect(rowOf(info.rows, t("action.info.heal"))).toBe("4");
    expect(rowOf(info.rows, t("action.info.target"))).toBe(t("action.info.targetAllies"));

    const roots: SkillStats = {
      ...SHIELD_BASH,
      id: "roots",
      category: "ranged",
      range: 6,
      effects: [{ type: "applyStatus", status: "immobile", duration: 1 }],
    };
    const rootsInfo = skillActionInfo("roots", roots, t);
    expect(rowOf(rootsInfo.rows, t("action.info.status"))).toBe(`${t("action.status.immobile")} · 1`);
  });

  it("describes the stance and the watch: they live outside the bestiary", () => {
    const defend = stanceActionInfo("defend", t);
    expect(defend.name).toBe(t("battle.defend"));
    expect(rowOf(defend.rows, t("action.info.defendEffect"))).toBe(t("action.info.defendEffectValue"));
    expect(rowOf(defend.rows, t("action.info.apCost"))).toBe("1");

    const watch = stanceActionInfo("overwatch", t);
    expect(watch.name).toBe(t("battle.overwatch"));
    expect(rowOf(watch.rows, t("action.info.overwatchEffect"))).toBe(t("action.info.yes"));
    expect(watch.flavor.length).toBeGreaterThan(0);
  });
});

/** Размер кадра JPEG: чтение маркера SOF, без сторонних библиотек. */
function jpegSize(path: string): [number, number] | null {
  const data = readFileSync(path);
  let offset = 2;
  while (offset < data.length - 9) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1]!;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return [data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)];
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return null;
}

describe("action art files (0.20.46)", () => {
  it("keeps every shipped icon a 512×512 square named after a known action", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/game-pwa/public/actions");
    const files = readdirSync(dir).filter((name) => name.endsWith(".jpg"));
    expect(files.length, "образы есть").toBeGreaterThan(0);
    const known = new Set(knownActionArtIds());
    for (const file of files) {
      // Файл без записи в карте — потерянный образ: кнопка его не найдёт.
      expect(known.has(file.replace(/\.jpg$/, "")), `${file} не значится в карте`).toBe(true);
      expect(jpegSize(join(dir, file)), `${file}: 512×512`).toEqual([512, 512]);
    }
  });
});
