import { useEffect, useMemo, useRef, useState } from "react";
import { createCampaign } from "@bylina/campaign";
import { collectCatalogsFromModules, createI18n, manifest } from "@bylina/i18n";
import { APP_VERSION, createSession, type DifficultyId } from "@bylina/session";
import { createSettings } from "@bylina/settings";
import { createReplayStorage, createSaveStorage, deserializeFog, serializeFog } from "@bylina/storage";
import { createReplayRecorder, isReplayJournal, type ReplayJournal } from "@bylina/replay";
import type { FogState, MatchState } from "@bylina/core";
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
  const replayStorage = useMemo(() => createReplayStorage(), []);
  const saved = useMemo(() => saveStorage.load(), [saveStorage]);

  const session = useMemo(() => {
    const entry = saved?.session;
    // Экран сражения восстанавливается только для партии кампании: локальная
    // и сетевая партии эфемерны (ядро/транспорт не сохраняются), повтор
    // открывается из списка повторов. Иначе BattleScreen упадёт без ядра.
    const inCampaignBattle = entry?.screen === "battle" && entry?.battleKind === "campaign";
    const screen = inCampaignBattle
      ? "battle"
      : entry?.screen === "deployment" || entry?.screen === "campaign" || entry?.screen === "missionResult"
        ? entry.screen
        : "menu";
    const restoredBattle = saved?.match && inCampaignBattle
      ? { restoredMatch: saved.match, restoredFog: deserializeFog(saved.fog) }
      : undefined;
    return createSession(screen, {
      battleKind: inCampaignBattle ? "campaign" : null,
      activeMissionId: entry?.activeMissionId ?? null,
      deployment: entry?.deployment ?? [],
      matchSeed: entry?.matchSeed ?? 0,
      outcome: entry?.outcome ?? null,
      difficulty: (entry?.difficulty as DifficultyId | null) ?? null,
      paused: false,
      trainingDone: entry?.trainingDone ?? [],
      campaignHintsDone: entry?.campaignHintsDone ?? [],
      ...restoredBattle,
    });
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

  const contentData = content.ok ? content.data : null;
  const campaign = useMemo(() => {
    if (!content.ok) return null;
    const unitStats: Record<string, { maxHealth: number }> = {};
    for (const unit of content.data.units) unitStats[unit.id] = { maxHealth: unit.maxHealth };
    // Назначение класса рекруту — только записи дружины, кроме самого рекрута.
    const classUnitIds = content.data.units
      .filter((unit) => unit.side === "druzhina" && unit.id !== content.data.campaign.recruitUnitId)
      .map((unit) => unit.id);
    return createCampaign(content.data.campaign, {
      unitStats,
      items: content.data.items,
      initialState: saved?.campaign,
      classUnitIds,
    });
  }, [content, saved]);

  useEffect(() => {
    if (campaign) session.bindCampaign(campaign);
  }, [session, campaign]);

  // Автосохранение: кампания и активная партия пишутся при каждом изменении.
  // Пока ядро боя не привязано (экран «battle» смонтирован, BattleScreen ещё
  // создаёт ядро), используется последний известный снимок партии — иначе
  // стартовое сохранение затрёт восстановленный бой.
  const lastMatchRef = useRef<{ match?: MatchState; fog?: FogState }>({
    match: saved?.match,
    fog: saved?.match ? deserializeFog(saved.fog) : undefined,
  });
  const persistRef = useRef<() => void>(() => undefined);
  persistRef.current = () => {
    if (!campaign) return;
    const state = session.get();
    // Сохранение повтора состязательной партии (0.17.0): при завершении
    // либо обрыве боя черновик журнала превращается в запись.
    if ((state.screen === "result" || state.netDisconnected === true) && (state.battleKind === "pvp" || state.battleKind === "pvpNet") && state.replayDraft) {
      const draft = state.replayDraft;
      const pvpOptions = {
        units: contentData!.units,
        map: contentData!.pvp.map ?? contentData!.quickMatch.map,
        side1: draft.sides.side1,
        side2: draft.sides.side2,
        objective: draft.objective ?? "elimination",
        seed: draft.seed,
      };
      const recorder = createReplayRecorder(pvpOptions, `${state.battleKind === "pvpNet" ? "Сеть" : "Поочерёдная"} · ${new Date().toLocaleDateString()}`);
      for (const command of draft.commands) recorder.record(command);
      const journal = recorder.finish(state.replayWinner ?? null, recorder.getJournal()?.title ?? "Бой");
      if (isReplayJournal(journal)) replayStorage.saveReplay(journal);
      // Черновик очищается после записи: повтор не дублируется при следующем
      // автосохранении, а новый бой начинает журнал с нуля.
      session.setReplayDraft(null);
    }
    const inCampaignBattle = state.screen === "battle" && state.battleKind === "campaign";
    if (!inCampaignBattle) lastMatchRef.current = {};
    let match = inCampaignBattle ? (session.getBattleFullSnapshot() ?? undefined) : undefined;
    let fog: FogState | undefined = match ? (session.getBattleFog() ?? undefined) : undefined;
    if (!match && inCampaignBattle) {
      match = lastMatchRef.current.match;
      fog = lastMatchRef.current.fog;
    }
    if (match) lastMatchRef.current = { match, fog };
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
        trainingDone: state.trainingDone ?? [],
        campaignHintsDone: state.campaignHintsDone ?? [],
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

  // Отладочный режим (0.20.1): средства QA (автопобеда, оверлей стоимости)
  // доступны только при адресе с параметром ?debug=1 — в обычной игре
  // служебные кнопки в боевом интерфейсе не показываются.
  const debug = useMemo(
    () => (typeof window === "undefined" ? false : new URLSearchParams(window.location.search).has("debug")),
    [],
  );

  return (
    <ServicesProvider
      value={{ i18n, settings, session, content: content.data, version: APP_VERSION, install, debug }}
    >
      <Shell />
    </ServicesProvider>
  );
}
