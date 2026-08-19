export type LocaleDir = "ltr" | "rtl";

export interface LanguageMeta {
  code: string;
  bcp47: string;
  dir: LocaleDir;
  nativeName: string;
}

export interface LocaleManifest {
  fallback: string;
  languages: LanguageMeta[];
}

export type Catalog = { [key: string]: string | Catalog };

export interface I18nOptions {
  manifest: LocaleManifest;
  catalogs: Record<string, Catalog>;
  initialLanguage?: string;
}

export interface I18nApi {
  readonly fallback: string;
  getLanguage(): string;
  setLanguage(code: string): void;
  getAvailableLanguages(): readonly LanguageMeta[];
  getMeta(code?: string): LanguageMeta | undefined;
  t(key: string, vars?: Record<string, string | number>): string;
  subscribe(listener: () => void): () => void;
}
