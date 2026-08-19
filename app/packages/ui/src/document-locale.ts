import type { I18nApi } from "@bylina/i18n";

export function applyDocumentLocale(i18n: I18nApi): void {
  const meta = i18n.getMeta();
  const root = document.documentElement;
  root.lang = meta?.bcp47 ?? i18n.getLanguage();
  root.dir = meta?.dir ?? "ltr";
  document.title = i18n.t("app.fullTitle");
}
