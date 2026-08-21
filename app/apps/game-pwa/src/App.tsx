import { useEffect, useMemo, useRef, useState } from "react";
import { createCampaign } from "@bylina/campaign";
import { collectCatalogsFromModules, createI18n, manifest } from "@bylina/i18n";
import { APP_VERSION, createSession, type DifficultyId } from "@bylina/session";
import { createSettings } from "@bylina/settings";
import { createSaveStorage, deserializeFog, serializeFog } from "@bylina/storage";
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

  // Сохранение кампании и активной партии (выпуск 0.13.0): запись читается
  // один раз при старте, затем перезаписывается при каждом изменении.
  const saveStorage = useMemo(() => createSaveStorage(), []);
  const saved = useMemo(() => saveStorage.load(), [saveStorage]);

  const session = useMemo(() => {
    const entry = saved?.session;
    const screen =
      entry?.screen === "battle" && entry?.battleKind === "campaign"
        ? "battle"
        : ((entry?.screen as "boot" | "menu" | "campaign" | "deployment" | "missionResult") ?? "boot");
    return createSession(screen, entry ? {
      battleKind: entry.battleKind,
      activeMissionId: entry.activeMissionId,
      deployment: entry.deployment,
      matchSeed: entry.matchSeed,
      outcome: entry.outcome,
      difficulty: entry.difficulty as DifficultyId | null,
      paused: false,
    } : undefined);
    // createSession создаётся один раз за жизнь приложения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return createCampaign(content.data.campaign, { unitStats, items: content.data.items, initialState: saved?.campaign });
  }, [content, saved]);

  useEffect(() => {
    if (campaign) session.bindCampaign(campaign);
  }, [session, campaign]);

  // Восстановление активной партии кампании: снимок и туман войны.
  useEffect(() => {
    if (saved?.match && saved.session?.battleKind === "campaign" && saved.session?.screen === "battle") {
      session.setRestoredBattle({ match: saved.match, fog: deserializeFog(saved.fog) });
    }
  }, [session, saved]);

  // Автосохранение: кампания и активная партия пишутся при каждом изменении.
  const persistRef = useRef<() => void>(() => undefined);
  persistRef.current = () => {
    if (!campaign) return;
    const state = session.get();
    const inCampaignBattle = state.screen === "battle" && state.battleKind === "campaign";
    const match = inCampaignBattle ? (session.getBattleFullSnapshot() ?? undefined) : undefined;
    const fog = match ? session.getBattleFog() : undefined;
    const screen = inCampaignBattle
      ? "battle"
      : state.screen === "missionResult" || state.screen === "deployment" || state.screen === "campaign"
        ? state.screen
        : "menu";
    saveStorage.save({
      version: APP_VERSION,
      savedAt: Date.now(),
      campaign: campaign.getState(),
      session: {
        screen,
        battleKind: state.battleKind,
        activeMissionId: state.activeMissionId,
        deployment: state.deployment,
        matchSeed: state.matchSeed,
        outcome: state.outcome,
        difficulty: state.difficulty,
      },
      match,
      fog: fog ? serializeFog(fog) : undefined,
    });
  };

  useEffect(() => {
    let unBattle: (() => void) | undefined;
    let retryTimer: number | undefined;
    let lastSave = 0;
    const throttledPersist = (): void => {
      const now = Date.now();
      if (now - lastSave < 400) return;
      lastSave = now;
      persistRef.current();
    };
    const subscribeBattle = (): void => {
      if (unBattle || session.get().screen !== "battle") return;
      try {
        unBattle = session.subscribeBattle(throttledPersist);
      } catch {
        // Ядро боя ещё не привязано (экран сменился, BattleScreen монтируется):
        // повторяем попытку на следующем тике.
        retryTimer = window.setTimeout(subscribeBattle, 60);
      }
    };
    const resub = (): void => {
      if (unBattle) {
        unBattle();
        unBattle = undefined;
      }
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      subscribeBattle();
    };
    throttledPersist();
    const unSession = session.subscribe(resub);
    subscribeBattle();
    return () => {
      unSession();
      unBattle?.();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [session]);

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
