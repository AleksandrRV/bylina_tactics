import { ActionInfoDialog } from "../action-panel.js";
import { UnitInfoDialog } from "../unit-card.js";
import { personaPortrait } from "../portraits.js";
import { useBattleScreen } from "./context.js";

export function BattleDialogs() {
  const model = useBattleScreen();
  const {
    t,
    session,
    battleKind,
    isPrologue,
    isTraining,
    isNetGuest,
    viewOwner,
    snapshot,
    paused,
    busy,
    enemyPhase,
    passReady,
    setPassReady,
    netDisconnected,
    disconnectLeft,
    setDisconnectLeft,
    prologueCard,
    prologueMission,
    prologueRunRef,
    prologueTelemetryRef,
    setPrologueCard,
    director,
    recordTelemetry,
    trainingOver,
    trainingMission,
    storyNote,
    closeStoryNote,
    storyNotePersona,
    cutscenePlaying,
    actionInfo,
    setActionInfo,
    unitInfo,
    setUnitInfo,
    fastPace,
    setFastPace,
    activeMissionId,
  } = model;

  return (
    <>
      {enemyPhase ? (
        <div className="phase-banner" role="status">
          {t("battle.enemyTurn")}
        </div>
      ) : null}

      {battleKind === "pvp" && !passReady ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="pass-title">
            <p className="eyebrow">{t("pvp.passHint")}</p>
            <h2 id="pass-title" className="pass-side-title">
              {viewOwner === 1 ? t("pvp.side1") : t("pvp.side2")}
            </h2>
            <p className="muted">{t("pvp.passBody")}</p>
            <button type="button" className="hud-btn hud-btn-primary pass-ready-btn" onClick={() => setPassReady(true)}>
              {t("pvp.ready")}
            </button>
          </div>
        </div>
      ) : null}

      {battleKind === "pvpNet" && isNetGuest && !session.getNetSnapshot() ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-sync-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-sync-title" className="pass-side-title">
              {t("net.syncing")}
            </h2>
            <p className="muted">{t("net.syncingBody")}</p>
            <span className="net-sync-spinner" aria-hidden="true" />
          </div>
        </div>
      ) : null}

      {battleKind === "pvpNet" && isNetGuest && session.getNetSnapshot() && snapshot.activeOwner !== viewOwner ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-wait-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-wait-title" className="pass-side-title">
              {t("net.opponentTurn")}
            </h2>
            <p className="muted">{t("net.waitBody")}</p>
          </div>
        </div>
      ) : null}

      {netDisconnected ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-lost-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-lost-title" className="pass-side-title">
              {t("net.connectionLost")}
            </h2>
            <p className="muted">
              {disconnectLeft > 0 ? t("net.reconnectIn", { seconds: disconnectLeft }) : t("net.reconnectExpired")}
            </p>
            <div className="net-lost-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  // Сохранение повтора выполняется слоем приложения (persistRef).
                  session.finishReplayDraft(null);
                  session.setNetDisconnected(false);
                  session.goTo("menu");
                }}
              >
                {t("net.saveReplay")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  session.setNetDisconnected(false);
                  session.goTo("menu");
                }}
              >
                {t("net.leaveRoom")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isPrologue && prologueCard && prologueMission ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card training-over-card" role="dialog" aria-modal="true">
            <p className="eyebrow">{t(prologueMission.titleKey)}</p>
            <h2>{prologueCard === "intro" ? t(prologueMission.introKey) : t(prologueMission.outroKey)}</h2>
            <button
              type="button"
              className="hud-btn hud-btn-primary"
              onClick={() => {
                if (prologueCard === "intro") {
                  prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, {
                    type: "skip_cutscene",
                    missionId: prologueMission.id,
                  });
                  setPrologueCard(null);
                  // Дальше кадром управляет сцена миссии: герой → цель → герой,
                  // и только после этого игрок получает управление (§13.4).
                  void director.runCutscene({ type: "missionStart" });
                  return;
                }
                const nextId = prologueMission.nextMissionId ?? null;
                if (prologueRunRef.current?.outcome === "defeat") {
                  prologueTelemetryRef.current = recordTelemetry(prologueTelemetryRef.current, {
                    type: "restart_pressed",
                    missionId: prologueMission.id,
                  });
                  session.startPrologue(prologueMission.id, true);
                  return;
                }
                // Стандартный экран победы после финального текстового
                // сообщения миссии (0.21.25): кнопка «Дальше» на нём ведёт
                // к следующей миссии либо к прокачке героя после М2.
                session.finishPrologueMission("victory", nextId);
              }}
            >
              {t(
                prologueCard === "intro"
                  ? "common.ok"
                  : prologueMission.nextMissionId && prologueMission.id === "prologue_brushwood"
                    ? "prologue.next.toCry"
                    : "prologue.next.toMap",
              )}
            </button>
          </div>
        </div>
      ) : null}

      {storyNote ? (
        // Сюжетное сообщение (0.20.52): окно поверх поля, закрывается
        // кнопкой либо щелчком по фону; кнопки панели оно не задевает.
        // С 0.21.21 здесь же читаются сюжетные подсказки пролога — плашка
        // `.training-note` под ними убрана, чтобы не лежаться на кнопку
        // защитной стойки. Портрет персонажа (Летописец после гибели)
        // приходит с репликой, а не из ключа подсказки.
        <div className="pause-root story-note-root" role="presentation" onClick={closeStoryNote}>
          <div
            className={`pause-card story-note-card${storyNotePersona ? " has-persona" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-note-text"
            onClick={(event) => event.stopPropagation()}
          >
            {storyNotePersona ? (
              <div className="campaign-hint-body">
                {personaPortrait(storyNotePersona) ? (
                  <img
                    className="campaign-hint-face"
                    src={personaPortrait(storyNotePersona)}
                    alt=""
                    draggable={false}
                  />
                ) : null}
                <div className="campaign-hint-meta">
                  <p className="eyebrow">{t(`campaign.persona.${storyNotePersona}`)}</p>
                  <p id="story-note-text" className="story-note-text">
                    {storyNote}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {isPrologue && prologueMission ? <p className="eyebrow">{t(prologueMission.titleKey)}</p> : null}
                <p id="story-note-text" className="story-note-text">
                  {storyNote}
                </p>
              </>
            )}
            <button type="button" className="hud-btn hud-btn-primary" onClick={closeStoryNote}>
              {t("common.ok")}
            </button>
          </div>
        </div>
      ) : null}

      {cutscenePlaying ? (
        <button type="button" className="cutscene-skip" onClick={director.skip}>
          {t("battle.cutscene.skip")}
        </button>
      ) : null}

      {isTraining && trainingOver ? (
        <div className="pause-root" role="presentation">
          <div
            className="pause-card training-over-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="training-over-title"
          >
            <p className="eyebrow">{trainingMission ? t(trainingMission.titleKey) : t("training.title")}</p>
            <h2 id="training-over-title">
              {trainingOver === "victory" ? t("training.over.victory") : t("training.over.defeat")}
            </h2>
            <p className="muted">
              {trainingOver === "victory" ? t("training.over.victoryBody") : t("training.over.defeatBody")}
            </p>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.goTo("training")}>
              {t("training.over.back")}
            </button>
          </div>
        </div>
      ) : null}

      {paused ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <h2 id="pause-title">{t("battle.pause")}</h2>
            <details className="controls-help">
              <summary>{t("battle.controlsTitle")}</summary>
              <ul>
                <li>
                  <kbd>1–8</kbd> {t("battle.controls.weapons")}
                </li>
                <li>
                  <kbd>9</kbd> {t("battle.controls.defend")}
                </li>
                <li>
                  <kbd>0</kbd> {t("battle.controls.overwatch")}
                </li>
                <li>
                  <kbd>Tab</kbd> {t("battle.controls.next")}
                </li>
                <li>
                  <kbd>Esc</kbd> {t("battle.controls.pause")}
                </li>
                <li>{t("battle.controls.touch")}</li>
              </ul>
            </details>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.setPaused(false)}>
              {t("battle.resume")}
            </button>
            {battleKind === "campaign" ? (
              // «К карте корабля» приостанавливает миссию, не покидая её
              // (0.20.18): на карте можно вернуться в миссию или осознанно
              // покинуть её; «Продолжить» меню тоже возвращает в бой.
              <button type="button" className="hud-btn" onClick={() => session.suspendCampaignMission()}>
                {t("battle.toCampaignMap")}
              </button>
            ) : null}
            <button
              type="button"
              className="hud-btn"
              onClick={() => {
                // Выход в меню из боя кампании ПРИОСТАНАВЛИВАЕТ миссию
                // (0.20.17): suspendCampaignBattle сам переводит в меню,
                // сохраняя снимок партии в сессии — «Продолжить» главного
                // меню возвращает в бой. Покинуть миссию можно осознанно —
                // кнопкой «К карте корабля». Иные бои выходят в меню как
                // прежде (их партия эфемерна).
                if (battleKind === "campaign" || battleKind === "prologue") session.suspendCampaignBattle();
                else session.goTo("menu");
              }}
            >
              {t("battle.toMenu")}
            </button>
            {/* Этап 2.10: переключатель темпа в меню паузы */}
            <button
              type="button"
              className={`hud-btn pace-toggle${fastPace ? " is-on" : ""}`}
              onClick={() => setFastPace((value) => !value)}
              aria-pressed={fastPace}
            >
              {t(fastPace ? "battle.fastPaceHint" : "battle.fastPace")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Окно информации о действии: открывается долгим нажатием
          кнопки либо правым кликом и лежит поверх боя. */}
      {actionInfo ? <ActionInfoDialog info={actionInfo} onClose={() => setActionInfo(null)} /> : null}
      {/* Окно информации о бойце: портрет, описание, параметры и экипировка. */}
      {unitInfo ? <UnitInfoDialog info={unitInfo} onClose={() => setUnitInfo(null)} /> : null}
    </>
  );
}
