import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Финальный аудит локализации (0.21.2, этап 5.5): словари ru и en обязаны
 * содержать одинаковые наборы ключей — расхождение ловится проверками,
 * а не ручной пробой обоих языков.
 */

const localesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "locales");

function flatten(value: unknown, prefix = ""): string[] {
  const keys: string[] = [];
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object") keys.push(...flatten(child, full));
    else keys.push(full);
  }
  return keys.sort();
}

async function loadKeys(language: string): Promise<string[]> {
  const raw = JSON.parse(await readFile(path.join(localesDir, language, "ui.json"), "utf8"));
  return flatten(raw);
}

describe("i18n parity (этап 5.5)", () => {
  it("ru and en dictionaries expose the same key sets", async () => {
    const ru = await loadKeys("ru");
    const en = await loadKeys("en");
    expect(ru).toEqual(en);
    expect(ru.length).toBeGreaterThan(100);
  });

  it("battle stage-4 keys exist in both languages", async () => {
    const en = await loadKeys("en");
    for (const key of ["battle.fastPace", "battle.fastPaceHint", "settings.autoEndTurn", "settings.autoEndTurnHint"]) {
      expect(en).toContain(key);
    }
  });
});
