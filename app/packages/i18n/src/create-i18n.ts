import type { Catalog, I18nApi, I18nOptions, LanguageMeta } from "./types.js";

function isRecord(value: unknown): value is Catalog {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  if (!catalog) return undefined;
  const parts = key.split(".");
  let node: string | Catalog | undefined = catalog;
  for (const part of parts) {
    if (!isRecord(node) || !(part in node)) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, name: string) => {
    const value = vars[name];
    return value === undefined ? full : String(value);
  });
}

function languageBase(code: string): string {
  const dash = code.indexOf("-");
  return dash === -1 ? code : code.slice(0, dash);
}

export function createI18n(options: I18nOptions): I18nApi {
  const { manifest, catalogs } = options;
  const known = new Map(manifest.languages.map((item) => [item.code, item]));
  if (!known.has(manifest.fallback)) {
    throw new Error(`i18n: fallback "${manifest.fallback}" is missing from the manifest`);
  }

  const resolveCode = (requested: string | undefined): string => {
    if (requested && known.has(requested) && catalogs[requested]) return requested;
    if (requested) {
      const base = languageBase(requested);
      if (known.has(base) && catalogs[base]) return base;
    }
    return manifest.fallback;
  };

  let language = resolveCode(options.initialLanguage);
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const api: I18nApi = {
    fallback: manifest.fallback,
    getLanguage: () => language,
    setLanguage: (code: string) => {
      const next = resolveCode(code);
      if (next === language) return;
      language = next;
      notify();
    },
    getAvailableLanguages: () => manifest.languages.filter((item) => Boolean(catalogs[item.code])),
    getMeta: (code?: string) => known.get(code ?? language),
    t: (key: string, vars?: Record<string, string | number>) => {
      const selected = lookup(catalogs[language], key);
      if (selected !== undefined) return interpolate(selected, vars);
      const base = languageBase(language);
      if (base !== language) {
        const regional = lookup(catalogs[base], key);
        if (regional !== undefined) return interpolate(regional, vars);
      }
      if (language !== manifest.fallback) {
        const fallback = lookup(catalogs[manifest.fallback], key);
        if (fallback !== undefined) return interpolate(fallback, vars);
      }
      return key;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return api;
}

export function mergeCatalogs(parts: Catalog[]): Catalog {
  const result: Catalog = {};
  for (const part of parts) {
    mergeInto(result, part);
  }
  return result;
}

function mergeInto(target: Catalog, source: Catalog): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isRecord(existing) && isRecord(value)) {
      mergeInto(existing, value);
    } else {
      target[key] = value;
    }
  }
}

export function flattenKeys(catalog: Catalog, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") keys.push(path);
    else if (isRecord(value)) keys.push(...flattenKeys(value, path));
  }
  return keys;
}

export type { LanguageMeta };
