import { useEffect, useMemo, useState } from "react";
import { createCampaign } from "@bylina/campaign";
import { collectCatalogsFromModules, createI18n, manifest } from "@bylina/i18n";
import { APP_VERSION, createSession } from "@bylina/session";
import { createSettings } from "@bylina/settings";
import { ServicesProvider, Shell, applyDocumentLocale } from "@bylina/ui";
import { loadAppContent } from "./content-files.js";
import { useInstallPrompt } from "./install.js";

const localeModules = import.meta.glob("../../../packages/i18n/locales/*/*.json", {
  eager: true,
  import: "default",
});

export function App() {
  const install = useInstallPrompt();
  const content = useMemo(() => loadAppContent(), []);
  const catalogs = useMemo(() => collectCatalogsFromModules(localeModules), []);
  const allowedLanguages = useMemo(
    () => manifest.languages.map((item) => item.code),
    [],
  );

  const settings = useMemo(
    () =>
      createSettings({
        storage: window.localStorage,
        allowedLanguages,
      }),
    [allowedLanguages],
  );

  const i18n = useMemo(
    () =>
      createI18n({
        manifest,
        catalogs,
        initialLanguage: settings.get().language,
      }),
    [catalogs, settings],
  );

  const session = useMemo(() => createSession("boot"), []);
  const [, setLocaleTick] = useState(0);

  useEffect(() => {
    applyDocumentLocale(i18n);
    return i18n.subscribe(() => {
      applyDocumentLocale(i18n);
      settings.set({ language: i18n.getLanguage() });
      setLocaleTick((value) => value + 1);
    });
  }, [i18n, settings]);

  const campaign = useMemo(() => {
    if (!content.ok) return null;
    const unitStats: Record<string, { maxHealth: number }> = {};
    for (const unit of content.data.units) unitStats[unit.id] = { maxHealth: unit.maxHealth };
    return createCampaign(content.data.campaign, { unitStats });
  }, [content]);

  useEffect(() => {
    if (campaign) session.bindCampaign(campaign);
  }, [session, campaign]);

  if (!content.ok) {
    return (
      <div className="content-error">
        <h1>Configuration error</h1>
        <ul>
          {content.issues.map((issue) => (
            <li key={issue.file}>
              {issue.file}: {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  void content;

  return (
    <ServicesProvider
      value={{ i18n, settings, session, content: content.data, version: APP_VERSION, install }}
    >
      <Shell />
    </ServicesProvider>
  );
}
