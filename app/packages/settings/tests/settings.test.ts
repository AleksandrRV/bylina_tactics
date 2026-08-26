import { describe, expect, it } from "vitest";
import { SETTINGS_STORAGE_KEY, createSettings, sanitizeSettings } from "../src/index.js";

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("sanitizeSettings", () => {
  it("rejects an unknown language", () => {
    const result = sanitizeSettings({ language: "de" }, ["ru", "en"]);
    expect(result.language).toBe("ru");
  });

  it("clamps volume", () => {
    const result = sanitizeSettings({ masterVolume: 140 }, ["ru"]);
    expect(result.masterVolume).toBe(100);
  });

  it("keeps hints enabled by default and restores an explicit value (0.20.0)", () => {
    expect(sanitizeSettings({}, ["ru"]).showHints).toBe(true);
    expect(sanitizeSettings({ showHints: false }, ["ru"]).showHints).toBe(false);
    expect(sanitizeSettings({ showHints: true }, ["ru"]).showHints).toBe(true);
  });

  it("keeps auto-end-turn enabled by default and allows opting out (stage 1)", () => {
    expect(sanitizeSettings({}, ["ru"]).autoEndTurn).toBe(true);
    expect(sanitizeSettings({ autoEndTurn: false }, ["ru"]).autoEndTurn).toBe(false);
  });
});

describe("createSettings", () => {
  it("restores a stored language", () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ language: "en", masterVolume: 10 }),
    });
    const settings = createSettings({ storage, allowedLanguages: ["ru", "en"] });
    expect(settings.get().language).toBe("en");
    expect(settings.get().masterVolume).toBe(10);
  });

  it("writes changes back to storage", () => {
    const storage = memoryStorage();
    const settings = createSettings({ storage, allowedLanguages: ["ru", "en"] });
    settings.set({ language: "en", masterVolume: 25 });
    const again = createSettings({ storage, allowedLanguages: ["ru", "en"] });
    expect(again.get().language).toBe("en");
    expect(again.get().masterVolume).toBe(25);
  });

  it("restores the showHints preference from storage (0.20.0)", () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ showHints: false }),
    });
    const settings = createSettings({ storage, allowedLanguages: ["ru", "en"] });
    expect(settings.get().showHints).toBe(false);
    settings.set({ showHints: true });
    const again = createSettings({ storage, allowedLanguages: ["ru", "en"] });
    expect(again.get().showHints).toBe(true);
  });
});
