import type { Catalog, LocaleDir, LocaleManifest } from "./types.js";
import { mergeCatalogs } from "./create-i18n.js";
import rawManifest from "../locales/manifest.json";
import ruUi from "../locales/ru/ui.json";
import enUi from "../locales/en/ui.json";

function asDir(value: string): LocaleDir {
  return value === "rtl" ? "rtl" : "ltr";
}

export const manifest: LocaleManifest = {
  fallback: rawManifest.fallback,
  languages: rawManifest.languages.map((item) => ({
    code: item.code,
    bcp47: item.bcp47,
    dir: asDir(item.dir),
    nativeName: item.nativeName,
  })),
};

const bundled: Record<string, Catalog[]> = {
  ru: [ruUi as Catalog],
  en: [enUi as Catalog],
};

/** Каталоги ru/en для тестов в Node.js. */
export function loadBundledCatalogs(): Record<string, Catalog> {
  const result: Record<string, Catalog> = {};
  for (const [code, parts] of Object.entries(bundled)) {
    result[code] = mergeCatalogs(parts);
  }
  return result;
}

/** Собрать каталоги из glob вида locales/<code>/<file>.json. Новый язык — папка и запись манифеста. */
export function collectCatalogsFromModules(modules: Record<string, unknown>): Record<string, Catalog> {
  const grouped: Record<string, Catalog[]> = {};
  for (const [path, value] of Object.entries(modules)) {
    const match = path.replace(/\\/g, "/").match(/locales\/([^/]+)\/[^/]+\.json$/);
    if (!match?.[1] || match[1] === "manifest") continue;
    const code = match[1];
    const list = grouped[code] ?? [];
    list.push(value as Catalog);
    grouped[code] = list;
  }
  const result: Record<string, Catalog> = {};
  for (const [code, parts] of Object.entries(grouped)) {
    result[code] = mergeCatalogs(parts);
  }
  return result;
}
