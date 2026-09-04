import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { missionConfigSchema, parseContent } from "@bylina/content";

/**
 * Полнота словарей (0.20.2): каждый статический ключ, используемый
 * интерфейсом, обязан существовать в каждом словаре — иначе на экране
 * появляется сырой ключ (так проявились пропуски `common.back` и
 * `battle.controls`). Динамические ключи с подстановками проверяются
 * отдельно по известным значениям.
 */

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function flattenKeys(node: unknown, prefix = ""): Set<string> {
  const result = new Set<string>();
  if (typeof node !== "object" || node === null) return result;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      for (const nested of flattenKeys(value, path)) result.add(nested);
    } else {
      result.add(path);
    }
  }
  return result;
}

function sourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(full));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) result.push(full);
  }
  return result;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesRoot = join(root, "../i18n/locales");
const catalogs: Record<string, Set<string>> = {};
for (const locale of ["ru", "en"]) {
  catalogs[locale] = flattenKeys(readJson(join(localesRoot, locale, "ui.json")));
}

function usedStaticKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of sourceFiles(join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bt\("([^"]+)"/g)) keys.add(match[1]!);
    for (const match of text.matchAll(/\bt\(`([^`$]+)`\)/g)) keys.add(match[1]!);
    // Условные вызовы: t(flag ? "a" : "b") — обе ветви обязаны быть в словарях
    // (раньше сканер видел только литерал сразу после `t(` — так потерялся
    // ключ battle.debugMovementHint).
    for (const match of text.matchAll(/\bt\(\s*[^()?]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"\s*\)/g)) {
      keys.add(match[1]!);
      keys.add(match[2]!);
    }
  }
  return keys;
}

describe("i18n catalogs cover every static key used by the UI (0.20.2)", () => {
  const used = [...usedStaticKeys()].sort();

  it("has static keys in every locale", () => {
    for (const locale of ["ru", "en"]) {
      const missing = used.filter((key) => !catalogs[locale]!.has(key));
      expect(missing, `locale ${locale} is missing keys`).toEqual([]);
    }
  });

  it("covers dynamic training keys (intro lines per mission)", () => {
    for (const locale of ["ru", "en"]) {
      for (const id of ["movement", "combat", "skills"]) {
        expect(catalogs[locale]!.has(`training.${id}.intro`), `${locale}: training.${id}.intro`).toBe(true);
        expect(catalogs[locale]!.has(`training.objective.${id}`), `${locale}: training.objective.${id}`).toBe(true);
      }
    }
  });

  it("covers training content keys (titles, descriptions, hints, notes)", () => {
    const dataRoot = join(root, "../content/data");
    const files: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".json5")) files[full] = readFileSync(full, "utf8");
      }
    };
    walk(dataRoot);
    const parsed = parseContent(files);
    if (!parsed.ok) throw new Error("content parse failed");
    for (const locale of ["ru", "en"]) {
      for (const mission of parsed.data.training.missions) {
        expect(catalogs[locale]!.has(mission.titleKey), `${locale}: ${mission.titleKey}`).toBe(true);
        expect(catalogs[locale]!.has(mission.descriptionKey), `${locale}: ${mission.descriptionKey}`).toBe(true);
        for (const hint of mission.hints) {
          expect(catalogs[locale]!.has(hint.textKey), `${locale}: ${hint.textKey}`).toBe(true);
        }
        if (mission.notes) {
          for (const noteKey of Object.values(mission.notes)) {
            expect(catalogs[locale]!.has(noteKey), `${locale}: ${noteKey}`).toBe(true);
          }
        }
      }
    }
  });

  it("covers dynamic reject reasons of the kernel", () => {
    const reasons = [
      "ILLEGAL",
      "NO_AP",
      "ON_COOLDOWN",
      "NO_USES",
      "NOT_YOUR_TURN",
      "OCCUPIED",
      "NOT_FOUND",
      "NO_LOS",
      "OUT_OF_RANGE",
    ];
    for (const locale of ["ru", "en"]) {
      for (const reason of reasons) {
        expect(catalogs[locale]!.has(`battle.reject.${reason}`), `${locale}: battle.reject.${reason}`).toBe(true);
      }
      expect(catalogs[locale]!.has("battle.reject.generic")).toBe(true);
    }
  });

  it("covers dynamic training lock explanations (0.20.13)", () => {
    const locks = ["cell", "weapon", "skill", "actor", "endTurn", "generic"];
    for (const locale of ["ru", "en"]) {
      for (const lock of locks) {
        expect(catalogs[locale]!.has(`training.locked.${lock}`), `${locale}: training.locked.${lock}`).toBe(true);
      }
    }
  });

  it("covers every skill and class talent of the content (0.21.30)", () => {
    // Кнопка умения и окно таланта строят ключи динамически:
    // `skill.<id>.name/flavor` и `talent.<id>.name` для пассивных талантов.
    const dataRoot = join(root, "../content/data");
    const files: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".json5")) files[full] = readFileSync(full, "utf8");
      }
    };
    walk(dataRoot);
    const parsed = parseContent(files);
    if (!parsed.ok) throw new Error("content parse failed");
    for (const locale of ["ru", "en"]) {
      for (const skill of parsed.data.skills) {
        expect(catalogs[locale]!.has(`skill.${skill.id}.name`), `${locale}: skill.${skill.id}.name`).toBe(true);
        expect(catalogs[locale]!.has(`skill.${skill.id}.flavor`), `${locale}: skill.${skill.id}.flavor`).toBe(true);
      }
      for (const tree of Object.values(parsed.data.campaign.talents ?? {})) {
        for (const talent of Object.values(tree).flat()) {
          if (talent.skillId) continue;
          expect(catalogs[locale]!.has(`talent.${talent.id}.name`), `${locale}: talent.${talent.id}.name`).toBe(true);
        }
      }
    }
  });

  it("covers every campaign mission type label derived from the schema", () => {
    // Ключ строится динамически: `campaign.type.${mission.type}` на экране
    // высадки — каждый тип миссии из схемы контента обязан быть в словарях.
    // Схема обёрнута в `superRefine` (ZodEffects), потому берём внутренний тип.
    const types = missionConfigSchema.innerType().shape.type.options;
    for (const locale of ["ru", "en"]) {
      for (const type of types) {
        expect(catalogs[locale]!.has(`campaign.type.${type}`), `${locale}: campaign.type.${type}`).toBe(true);
      }
    }
  });
});
