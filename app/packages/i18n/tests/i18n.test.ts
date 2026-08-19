import { describe, expect, it } from "vitest";
import { createI18n, flattenKeys, loadBundledCatalogs, manifest } from "../src/index.js";

const catalogs = loadBundledCatalogs();

describe("manifest", () => {
  it("lists Russian and English", () => {
    const codes = manifest.languages.map((item) => item.code);
    expect(codes).toContain("ru");
    expect(codes).toContain("en");
    expect(manifest.fallback).toBe("ru");
  });

  it("has a catalog for every manifest language", () => {
    for (const language of manifest.languages) {
      expect(catalogs[language.code]).toBeDefined();
    }
  });
});

describe("createI18n", () => {
  it("translates a control key in both languages", () => {
    const ru = createI18n({ manifest, catalogs, initialLanguage: "ru" });
    const en = createI18n({ manifest, catalogs, initialLanguage: "en" });
    expect(ru.t("menu.settings")).toBe("Настройки");
    expect(en.t("menu.settings")).toBe("Settings");
  });

  it("falls back to Russian when a key is missing", () => {
    const partial = {
      ...catalogs,
      en: { menu: { settings: "Settings" } },
    };
    const i18n = createI18n({ manifest, catalogs: partial, initialLanguage: "en" });
    expect(i18n.t("menu.quickMatch")).toBe("Быстрый матч");
  });

  it("substitutes named parameters", () => {
    const i18n = createI18n({ manifest, catalogs, initialLanguage: "en" });
    expect(i18n.t("app.version", { version: "0.1.0" })).toBe("Version 0.1.0");
  });

  it("returns the key when nothing is found", () => {
    const i18n = createI18n({ manifest, catalogs, initialLanguage: "ru" });
    expect(i18n.t("missing.path")).toBe("missing.path");
  });

  it("ignores catalogs that are not in the manifest", () => {
    const i18n = createI18n({
      manifest,
      catalogs: { ...catalogs, de: { menu: { settings: "Einstellungen" } } },
      initialLanguage: "de",
    });
    expect(i18n.getLanguage()).toBe("ru");
    expect(i18n.getAvailableLanguages().map((item) => item.code)).toEqual(["ru", "en"]);
  });

  it("notifies subscribers on language change", () => {
    const i18n = createI18n({ manifest, catalogs, initialLanguage: "ru" });
    let ticks = 0;
    const stop = i18n.subscribe(() => {
      ticks += 1;
    });
    i18n.setLanguage("en");
    i18n.setLanguage("en");
    stop();
    i18n.setLanguage("ru");
    expect(ticks).toBe(1);
  });
});

describe("catalog completeness for 0.1.0 shell", () => {
  it("keeps the same keys in ru and en", () => {
    const ruKeys = flattenKeys(catalogs.ru ?? {}).sort();
    const enKeys = flattenKeys(catalogs.en ?? {}).sort();
    expect(enKeys).toEqual(ruKeys);
    expect(ruKeys.length).toBeGreaterThan(10);
  });
});
