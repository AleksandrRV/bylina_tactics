import { useEffect, useMemo, useRef, useState } from "react";
import { createCampaign } from "@bylina/campaign";
import { collectCatalogsFromModules, createI18n, manifest } from "@bylina/i18n";
import { APP_VERSION, createSession, type DifficultyId } from "@bylina/session";
import { createSettings } from "@bylina/settings";
import {
  createReplayStorage,
  createSaveSerializer,
  createSaveStorage,
  deserializeFog,
  SAVE_FORMAT_VERSION,
} from "@bylina/storage";
import { createReplayRecorder, isReplayJournal } from "@bylina/replay";
import type { CampaignState } from "@bylina/campaign";
import type { FogState, MatchState } from "@bylina/core";
import { ServicesProvider, Shell, applyDocumentLocale } from "@bylina/ui";
import { applyPaletteCssVariables } from "@bylina/render";
import { loadAppContent } from "./content-files.js";
import { useInstallPrompt } from "./install.js";

// Этап 1.1 (0.20.20): CSS-переменные интерфейса порождаются единым
// справочником цветов пакета отрисовки — поле и стили используют одни
// и те же величины. Статические значения styles.css остаются запасными.
applyPaletteCssVariables();

const localeModules = import.meta.glob("../../../packages/i18n/locales/*/*.json", {
  eager: true,
  import: "default",
});

export function App() {
  const install = useInstallPrompt();
  const [content, setContent] = useState<Awaited<ReturnType<typeof loadAppContent>> | null>(null);
  useEffect(() => {
    void Promise.resolve(loadAppContent()).then(setContent);
  }, []);
  const catalogs = useMemo(() => collectCatalogsFromModules(localeModules), []);
  const allowedLanguages = useMemo(() => manifest.languages.map((item) => item.code), []);

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
  const saveSerializer = useMemo(() => createSaveSerializer(), []);
  const replayStorage = useMemo(() => createReplayStorage(), []);
  const saved = useMemo(() => saveStorage.load(), [saveStorage]);

  const contentData = content?.ok ? content.data : null;

  // Продолжение былины (0.20.15): сохранение кампании НЕ загружается при
  // запуске — приложение всегда открывает главное меню. Состояние былины
  // держится «на ожидании» до решения игрока: «Продолжить» загружает его,
  // «Новая былина» (после предупреждения) запускает свежую кампанию.
  // «На ожидании» лежит только осмысленный прогресс (Тьма, начатая либо
  // пройденная миссия): пустое сохранение свежей установки эквивалентно
  // отсутствию былины.
  // Начатый пролог — уже былина (0.20.51): сюжет не значится точками
  // карты, Тьму не копит и миссий не отмечает, поэтому прежний перечень
  // признаков считал сохранение пустым и скрывал «Продолжить».
  const savedCampaignHasProgress = saved?.campaign
    ? saved.campaign.darkness > 0 ||
      saved.campaign.activeMissionId !== null ||
      saved.campaign.chapter === "prologue" ||
      saved.session?.battleKind === "prologue" ||
      Boolean(saved.session?.prologueMissionId) ||
      saved.campaign.missions.some((mission) => mission.status === "done")
    : false;
  const [campaignRestore, setCampaignRestore] = useState<CampaignState | "pending" | null>(
    savedCampaignHasProgress ? "pending" : null,
  );

  // Сессия создаётся один раз за жизнь приложения и НЕ зависит от кампании:
  // пересоздание теряло бы прогресс этой сессии (обучение, туториалы) и
  // перемонтировало оболочку. Из сохранения восстанавливаются только
  // глобальные поля; контекст ветки кампании применяет continueCampaign.
  const session = useMemo(() => {
    const entry = saved?.session;
    return createSession("menu", {
      difficulty: (entry?.difficulty as DifficultyId | null) ?? null,
      paused: false,
      trainingDone: entry?.trainingDone ?? [],
      campaignHintsDone: entry?.campaignHintsDone ?? [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const campaign = useMemo(() => {
    if (!content?.ok) return null;
    const unitStats: Record<string, { maxHealth: number }> = {};
    for (const unit of content.data.units) unitStats[unit.id] = { maxHealth: unit.maxHealth };
    // Назначение класса рекруту — только записи дружины, кроме самого рекрута.
    const classUnitIds = content.data.units
      .filter((unit) => unit.side === "druzhina" && unit.id !== content.data.campaign.recruitUnitId)
      .map((unit) => unit.id);
    // «pending» — решение игрока ещё не принято: автомат строится свежим,
    // сохранённое состояние былины не трогается. Иначе — восстановление.
    const created = createCampaign(content.data.campaign, {
      unitStats,
      items: content.data.items,
      initialState: campaignRestore !== "pending" && campaignRestore ? campaignRestore : undefined,
      classUnitIds,
      prologueFinalMissionId: content.data.prologue.prologueFinalMissionId,
      chapter: session.get().battleKind === "prologue" ? "prologue" : undefined,
    });
    // Привязка СИНХРОННО, до первого рендера экранов (исправление 0.20.2):
    // экраны кампании читают автомат в первом же рендере; мемо исполняется
    // до рендера оболочки, поэтому и пересоздание автомата («Продолжить»/
    // «Новая былина») остаётся синхронным — пустых экранов не возникает.
    session.bindCampaign(created);
    return created;
  }, [content, campaignRestore, session]);

  /** «Продолжить»: несчитанное сохранение — загрузить былину и вернуться к
   *  сохранённому экрану ветки кампании (карта, высадка, итог миссии либо
   *  бой); уже загруженная былина — вернуться на карту корабля (кнопка
   *  «Продолжить» доступна всегда, пока былина начата, 0.20.16). */
  const continueSavedCampaign = (): void => {
    if (campaignRestore !== "pending" || !saved) {
      // Былина уже загружена: вернуться к начатой миссии — в
      // приостановленный бой (снимок в сессии), иначе на карту корабля.
      if (campaignRestore !== "pending") session.resumeCampaign();
      return;
    }
    const entry = saved.session;
    // Сюжетная миссия (0.20.51): пролог сохраняется своим родом боя. Для
    // записей прежних версий, где пролог был помечен как бой кампании,
    // сюжет узнаётся по идентификатору миссии.
    const storyId =
      entry.prologueMissionId ?? (entry.activeMissionId?.startsWith("prologue_") ? entry.activeMissionId : null);
    const inCampaignBattle =
      entry.screen === "battle" && (entry.battleKind === "campaign" || storyId !== null) && Boolean(saved.match);
    if (inCampaignBattle && saved.match) {
      lastMatchRef.current = { match: saved.match, fog: deserializeFog(saved.fog) };
    }
    setCampaignRestore(saved.campaign);
    session.continueCampaign({
      screen: inCampaignBattle
        ? "battle"
        : entry.screen === "deployment" || entry.screen === "missionResult" || entry.screen === "campaign"
          ? entry.screen
          : "campaign",
      prologueMissionId: inCampaignBattle ? storyId : null,
      activeMissionId: storyId ? null : (entry.activeMissionId ?? null),
      deployment: entry.deployment ?? [],
      matchSeed: entry.matchSeed ?? 0,
      outcome: entry.outcome ?? null,
      restoredMatch: inCampaignBattle && saved.match ? saved.match : undefined,
      restoredFog: inCampaignBattle ? deserializeFog(saved.fog) : undefined,
    });
  };

  /** «Новая былина» после предупреждения: свежий автомат кампании;
   *  слот приостановленной миссии прежней былины гасится (0.20.19). */
  const startNewCampaign = (): void => {
    setCampaignRestore(null);
    session.clearSuspendedCampaign();
    if (contentData?.prologue.enabled) {
      const first = contentData.prologue.missions[0]?.id ?? "prologue_brushwood";
      session.startPrologue(first, true);
      return;
    }
    session.openMode("campaign");
  };

  const [, setLocaleTick] = useState(0);
  // Тик изменений кампании (0.20.16): миссии и Тьма, зарабатываемые уже
  // после загрузки былины, обновляют «Продолжить» и предупреждение
  // «Новой былины» при возврате в меню.
  const [campaignTick, setCampaignTick] = useState(0);

  useEffect(() => {
    applyDocumentLocale(i18n);
    return i18n.subscribe(() => {
      applyDocumentLocale(i18n);
      settings.set({ language: i18n.getLanguage() });
      setLocaleTick((value) => value + 1);
    });
  }, [i18n, settings]);

  useEffect(() => {
    if (!campaign) return;
    return campaign.subscribe(() => {
      setCampaignTick((value) => value + 1);
      // Правки дружины и запасы (0.20.51): былина пишется не только по
      // ходам боя, иначе Кузня и Горница оставались бы в памяти до
      // следующего сражения.
      schedulePersistRef.current();
    });
  }, [campaign]);

  // Автосохранение: кампания и активная партия пишутся при каждом изменении.
  // Пока ядро боя не привязано (экран «battle» смонтирован, BattleScreen ещё
  // создаёт ядро), используется последний известный снимок партии — иначе
  // стартовое сохранение затрёт восстановленный бой.
  const lastMatchRef = useRef<{ match?: MatchState; fog?: FogState }>({
    match: saved?.match,
    fog: saved?.match ? deserializeFog(saved.fog) : undefined,
  });
  const persistRef = useRef<() => void>(() => undefined);
  /**
   * Отложенная запись (0.20.51): изменения автомата кампании (экипировка,
   * лечение, Кузня, исход миссии) пишутся тем же трейлинг-дебаунсом, что
   * и ходы боя, — пачка правок дружины даёт одну запись, а не десять.
   */
  const schedulePersistRef = useRef<() => void>(() => undefined);
  // A later state must not be overwritten by an earlier worker response.
  const saveRequestRef = useRef(0);
  persistRef.current = () => {
    if (!campaign) return;
    const state = session.get();
    // Сохранение повтора состязательной партии (0.17.0): при завершении
    // либо обрыве боя черновик журнала превращается в запись.
    if (
      (state.screen === "result" || state.netDisconnected === true) &&
      (state.battleKind === "pvp" || state.battleKind === "pvpNet") &&
      state.replayDraft
    ) {
      const draft = state.replayDraft;
      const pvpOptions = {
        units: contentData!.units,
        map: contentData!.pvp.map ?? contentData!.quickMatch.map,
        side1: draft.sides.side1,
        side2: draft.sides.side2,
        objective: draft.objective ?? "elimination",
        loadouts: contentData!.pvp.loadouts,
        seed: draft.seed,
      };
      const recorder = createReplayRecorder(
        pvpOptions,
        `${state.battleKind === "pvpNet" ? "Сеть" : "Поочерёдная"} · ${new Date().toLocaleDateString()}`,
      );
      for (const command of draft.commands) recorder.record(command);
      const journal = recorder.finish(state.replayWinner ?? null, recorder.getJournal()?.title ?? "Бой");
      if (isReplayJournal(journal)) replayStorage.saveReplay(journal);
      // Черновик очищается после записи: повтор не дублируется при следующем
      // автосохранении, а новый бой начинает журнал с нуля.
      session.setReplayDraft(null);
    }
    // Продолжение былины (0.20.15): пока решение не принято, сохранение
    // былины не загружено и не должно затираться — в запись пишется
    // исходное состояние кампании и её сессии (бой/высадка/итог), а также
    // свежий глобальный прогресс (обучение, туториалы, трудность).
    if (campaignRestore === "pending") {
      if (!saved) return;
      const pendingRequest = ++saveRequestRef.current;
      void saveSerializer
        .serialize({
          formatVersion: SAVE_FORMAT_VERSION,
          version: APP_VERSION,
          savedAt: Date.now(),
          campaign: saved.campaign,
          session: {
            screen: saved.session.screen,
            battleKind: saved.session.battleKind,
            activeMissionId: saved.session.activeMissionId,
            deployment: saved.session.deployment,
            matchSeed: saved.session.matchSeed,
            outcome: saved.session.outcome,
            difficulty: state.difficulty ?? saved.session.difficulty,
            trainingDone: state.trainingDone ?? [],
            campaignHintsDone: state.campaignHintsDone ?? [],
          },
          match: saved.match,
          fog: saved.fog ? deserializeFog(saved.fog) : undefined,
        })
        .then((serialized) => {
          if (pendingRequest === saveRequestRef.current) saveStorage.saveSerialized(serialized);
        })
        .catch(() => {
          /* рабочий поток может исчезнуть при закрытии — следующий автосейв повторит */
        });
      return;
    }
    // Сюжетная миссия пролога сохраняется так же, как миссия карты
    // (0.20.51): иначе выход из пролога или перезапуск обозревателя
    // выбрасывал игрока из былины, начатой сюжетом.
    const inPrologueBattle = state.screen === "battle" && state.battleKind === "prologue";
    const inCampaignBattle = (state.screen === "battle" && state.battleKind === "campaign") || inPrologueBattle;
    const inCampaignDeployment = state.screen === "deployment" && state.battleKind === "campaign";
    // Приостановленная миссия кампании (0.20.17–0.20.19): контекст — в слоте,
    // не зависящем от навигации (заход в обучение/быстрый матч/настройки из
    // меню его не стирает). Сохранение обязано вернуть в миссию и после
    // перезапуска приложения: бой со снимком — как бой, миссия без снимка —
    // как формирование высадки.
    const slot = state.suspendedCampaign ?? null;
    const suspendedCampaign = slot !== null && !inCampaignBattle && !inCampaignDeployment;
    const suspendedStory = suspendedCampaign && slot!.activeMissionId.startsWith("prologue_");
    if (!inCampaignBattle) lastMatchRef.current = {};
    let match = inCampaignBattle
      ? (session.getBattleFullSnapshot() ?? undefined)
      : suspendedCampaign
        ? slot!.restoredMatch
        : undefined;
    let fog: FogState | undefined = inCampaignBattle
      ? (session.getBattleFog() ?? undefined)
      : suspendedCampaign
        ? slot!.restoredFog
        : undefined;
    if (!match && inCampaignBattle) {
      match = lastMatchRef.current.match;
      fog = lastMatchRef.current.fog;
    }
    if (match) lastMatchRef.current = { match, fog };
    const screen = inCampaignBattle
      ? "battle"
      : suspendedCampaign
        ? slot!.restoredMatch
          ? "battle"
          : "deployment"
        : state.screen === "missionResult" || state.screen === "deployment" || state.screen === "campaign"
          ? state.screen
          : "menu";
    // Сюжетный контекст: из боя пролога либо из приостановленного слота.
    const prologueMissionId = inPrologueBattle
      ? state.prologueMissionId
      : suspendedStory
        ? slot!.activeMissionId
        : null;
    // Контекст ветки кампании в записи — из боя либо из слота.
    const campaignSession =
      inCampaignBattle || inCampaignDeployment
        ? {
            activeMissionId: prologueMissionId ? null : state.activeMissionId,
            deployment: state.deployment,
            matchSeed: state.matchSeed,
            outcome: state.outcome,
          }
        : suspendedCampaign
          ? {
              activeMissionId: suspendedStory ? null : slot!.activeMissionId,
              deployment: slot!.deployment,
              matchSeed: slot!.matchSeed,
              outcome: null,
            }
          : {
              activeMissionId: null,
              deployment: [],
              matchSeed: 0,
              outcome: null,
            };
    const request = ++saveRequestRef.current;
    // MatchState, fog conversion and JSON.stringify run in packages/storage's
    // worker. localStorage itself remains synchronous but receives ready JSON.
    void saveSerializer
      .serialize({
        formatVersion: SAVE_FORMAT_VERSION,
        version: APP_VERSION,
        savedAt: Date.now(),
        campaign: campaign.getState(),
        session: {
          screen,
          battleKind:
            inCampaignBattle || inCampaignDeployment
              ? state.battleKind
              : suspendedCampaign
                ? suspendedStory
                  ? "prologue"
                  : "campaign"
                : state.battleKind,
          prologueMissionId,
          activeMissionId: campaignSession.activeMissionId,
          deployment: campaignSession.deployment,
          matchSeed: campaignSession.matchSeed,
          outcome: campaignSession.outcome,
          difficulty: state.difficulty,
          trainingDone: state.trainingDone ?? [],
          campaignHintsDone: state.campaignHintsDone ?? [],
        },
        match,
        fog,
      })
      .then((serialized) => {
        if (request === saveRequestRef.current) saveStorage.saveSerialized(serialized);
      })
      .catch(() => {
        // The worker can disappear during page shutdown; the next autosave retries.
      });
  };

  useEffect(() => () => saveSerializer.dispose(), [saveSerializer]);

  useEffect(() => {
    let unBattle: (() => void) | undefined;
    let retryTimer: number | undefined;
    let pendingTimer: number | undefined;
    let lastSave = 0;
    // Трейлинг-дебаунс: частые изменения боя не пишутся чаще раза в окно,
    // но изменение, попавшее в окно, НЕ отбрасывается, а откладывается до его
    // закрытия — последний ход всегда будет сохранён (исправление 0.20.20).
    const debouncedPersist = (): void => {
      schedulePersistRef.current = debouncedPersist;
      const now = Date.now();
      if (now - lastSave >= 400) {
        if (pendingTimer !== undefined) {
          window.clearTimeout(pendingTimer);
          pendingTimer = undefined;
        }
        lastSave = now;
        persistRef.current();
        return;
      }
      if (pendingTimer !== undefined) return;
      pendingTimer = window.setTimeout(
        () => {
          pendingTimer = undefined;
          lastSave = Date.now();
          persistRef.current();
        },
        400 - (now - lastSave),
      );
    };
    const subscribeBattle = (): void => {
      if (unBattle || session.get().screen !== "battle") return;
      try {
        unBattle = session.subscribeBattle(debouncedPersist);
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
      // Переход сессии — тоже повод записать былину (0.20.51). Прежде
      // запись шла только от ядра боя и от первого монтирования, поэтому
      // выход из миссии в меню, старт высадки и итог миссии в сохранение
      // не попадали: перезапуск возвращал игрока в устаревший кадр, а
      // былина, начатая сюжетом, и вовсе терялась.
      debouncedPersist();
    };
    debouncedPersist();
    const unSession = session.subscribe(resub);
    subscribeBattle();
    return () => {
      schedulePersistRef.current = () => undefined;
      unSession();
      unBattle?.();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (pendingTimer !== undefined) {
        // Отложенная запись не должна потеряться при переподписании.
        window.clearTimeout(pendingTimer);
        pendingTimer = undefined;
        persistRef.current();
      }
    };
    // Кампания входит в зависимости: содержимое грузится асинхронно, а без
    // автомата сохранение не пишется; пересоздание автомата («Продолжить»,
    // «Новая былина», 0.20.15) также переподписывает и сразу сохраняет.
  }, [session, campaign]);

  // Отладочный режим (0.20.1, doc/debug-mode.md): средства QA (автопобеда,
  // оверлей стоимости) доступны при адресе с параметром ?debug=1 либо при
  // включённой настройкой отладочного режима. Настройка реактивна: включение
  // в «Настройках» сразу открывает служебные кнопки в бою.
  const [debugMode, setDebugMode] = useState(settings.get().debugMode ?? false);
  useEffect(() => settings.subscribe((state) => setDebugMode(Boolean(state.debugMode))), [settings]);
  const debug = useMemo(
    () =>
      debugMode || (typeof window === "undefined" ? false : new URLSearchParams(window.location.search).has("debug")),
    [debugMode],
  );

  // Контроллер ветки кампании для меню (0.20.15; исправление 0.20.16):
  // «Продолжить» доступен ВСЕГДА, когда былина начата, — не только пока
  // сохранение не считано: выйдя из кампании в меню, игрок продолжает
  // текущую былину той же кнопкой. Признак «начата» — прогресс: несчитанное
  // сохранение (гейт загрузки уже отсеял пустые) либо Тьма, начатая либо
  // пройденная миссия в текущем автомате. Тот же признак включает
  // предупреждение «Новой былины».
  const hasActiveBylina = useMemo(() => {
    if (!campaign) return false;
    if (campaignRestore === "pending") return true;
    const snapshot = campaign.getState();
    // Пролог (0.20.51): былина начата сюжетом — «Продолжить» обязана
    // вернуть игрока в недойденный бой, а не предлагать начать заново.
    return (
      snapshot.darkness > 0 ||
      snapshot.activeMissionId !== null ||
      snapshot.chapter === "prologue" ||
      snapshot.missions.some((mission) => mission.status === "done") ||
      Boolean(session.get().suspendedCampaign)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, campaignRestore, campaignTick]);

  const campaignFlow = useMemo(() => {
    if (!campaign) return undefined;
    return {
      canContinue: hasActiveBylina,
      hasProgress: hasActiveBylina,
      continueCampaign: continueSavedCampaign,
      startNewCampaign,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, hasActiveBylina]);

  if (!content)
    return (
      <div className="content-error">
        <h1>{i18n.t("app.loadingContent")}</h1>
      </div>
    );
  if (!content.ok) {
    return (
      <div className="content-error">
        <h1>{i18n.t("app.configError")}</h1>
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

  return (
    <ServicesProvider
      value={{ i18n, settings, session, content: content.data, version: APP_VERSION, install, debug, campaignFlow }}
    >
      <Shell />
    </ServicesProvider>
  );
}
