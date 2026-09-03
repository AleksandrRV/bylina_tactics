import { EnemyFace } from "../unit-card.js";
import { unitPortrait } from "../portraits.js";
import { buildUnitInfo } from "../unit-info.js";
import { AutoWinIcon, DebugIcon, ExitIcon } from "../BattleScreenView.icons.js";
import { useBattleScreen } from "./context.js";
import { BattleRosterPanel } from "./BattleRosterPanel.js";

export function BattleTopBar() {
  const model = useBattleScreen();
  const {
    t,
    session,
    debug,
    fastPace,
    setFastPace,
    debugMovement,
    setDebugMovement,
    debugAutoWin,
    isTraining,
    isPrologue,
    battleKind,
    prologueMission,
    prologueObjectiveKey,
    trainingMission,
    mission,
    activeMissionId,
    snapshot,
    sideKey,
    objectiveEntity,
    enemyStrip,
    knownEnemies,
    viewOwner,
    rendererRef,
    setUnitInfo,
    weapons,
    skills,
    unitNameKey,
  } = model;

  return (
    <header className="battle-top">
      <div className="top-controls">
        <button type="button" className="hud-btn" onClick={() => session.setPaused(true)}>
          {t("battle.pause")}
        </button>
        {/* Этап 2.10: переключатель темпа боя — обычная и двойная скорость.
            Состояние подписано подсказкой, доступно с клавиатуры,
            помечено атрибутом нажатости. */}
        <button
          type="button"
          className={`hud-btn hud-icon-btn pace-toggle${fastPace ? " is-on" : ""}`}
          onClick={() => setFastPace((value) => !value)}
          aria-pressed={fastPace}
          title={t(fastPace ? "battle.fastPaceHint" : "battle.fastPace")}
          aria-label={t("battle.fastPace")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 5l7 7-7 7M13 5l7 7-7 7" />
          </svg>
        </button>
        {isTraining ? (
          <button
            type="button"
            className="hud-btn hud-icon-btn training-exit"
            onClick={() => session.goTo("training")}
            title={t("training.exitHint")}
            aria-label={t("training.exit")}
          >
            <ExitIcon />
          </button>
        ) : null}
        {debug ? (
          <>
            <button
              type="button"
              className={`hud-btn hud-icon-btn debug-toggle${debugMovement ? " is-on" : ""}`}
              onClick={() => setDebugMovement((value) => !value)}
              title={t(debugMovement ? "battle.debugMovementHint" : "battle.debugMovement")}
              aria-pressed={debugMovement}
              aria-label={t("battle.debugMovement")}
            >
              <DebugIcon />
            </button>
            <button
              type="button"
              className="hud-btn hud-icon-btn debug-win"
              onClick={() => debugAutoWin()}
              title={t("battle.debugAutoWinHint")}
              aria-label={t("battle.debugAutoWin")}
            >
              <AutoWinIcon />
            </button>
          </>
        ) : null}
      </div>
      <div className="battle-objective">
        <p className="eyebrow">
          {battleKind === "campaign" ? (
            <>
              <span className="mission-badge">{t("campaign.mission")}</span>
              {activeMissionId ?? ""}
            </>
          ) : battleKind === "pvp" ? (
            t("menu.pvp")
          ) : isTraining ? (
            t("training.battleLabel")
          ) : isPrologue && prologueMission ? (
            t(prologueMission.titleKey)
          ) : (
            t("menu.quickMatch")
          )}
        </p>
        <p>
          {isPrologue
            ? t(prologueObjectiveKey)
            : battleKind === "campaign" && mission
              ? t(`battle.objective.${mission.type}`)
              : isTraining && trainingMission
                ? t(`training.objective.${trainingMission.id}`)
                : t("battle.objectiveQuick")}
        </p>
        <p className="muted">
          {t("field.turn", { turn: snapshot.turnNumber })}
          {" · "}
          {t(sideKey)}
        </p>
        {snapshot.apple ? (
          <div className="apple-hud" aria-label={t("pvp.appleLabel")}>
            <span className="apple-hud-icon" aria-hidden="true">
              ◎
            </span>
            <span className="apple-hud-text">
              {snapshot.apple.carrierId !== null
                ? (() => {
                    const carrier = snapshot.entities.find((entity) => entity.id === snapshot.apple?.carrierId);
                    const side = carrier?.owner === 1 ? t("pvp.side1") : t("pvp.side2");
                    return t("pvp.appleCarrier", { side });
                  })()
                : t("pvp.appleLying")}
            </span>
          </div>
        ) : null}
        {objectiveEntity ? (
          <div className="objective-hud" aria-label={t("campaign.objective")}>
            {unitPortrait(objectiveEntity.configId) ? (
              <img
                className={`objective-face${objectiveEntity.dead ? " is-dead" : ""}`}
                src={unitPortrait(objectiveEntity.configId)}
                alt=""
                draggable={false}
              />
            ) : null}
            <span className="objective-meta">
              <span className="objective-name">{t(unitNameKey(objectiveEntity.configId))}</span>
              <span
                className="objective-hp"
                aria-label={t("battle.hp", { current: objectiveEntity.hp, max: objectiveEntity.maxHp })}
              >
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, (objectiveEntity.hp / objectiveEntity.maxHp) * 100))}%`,
                  }}
                />
              </span>
            </span>
          </div>
        ) : null}
        {enemyStrip.length > 0 ? (
          <div className="enemies-strip" aria-label={t("field.sideEnemy")}>
            {enemyStrip.map((enemy) => {
              const name = t(unitNameKey(enemy.configId));
              return (
                <EnemyFace
                  key={enemy.id}
                  configId={enemy.configId}
                  dead={enemy.dead}
                  seen={enemy.seen}
                  label={enemy.seen || enemy.dead ? name : `${name} · ${t("field.enemyUnseen")}`}
                  onFocus={() => {
                    // Клик ведёт камеру к противнику — но только к тому,
                    // кого видит хоть один боец дружины (0.20.42).
                    rendererRef.current?.focusEntity?.(enemy.id);
                  }}
                  onInspect={() => {
                    // Окно информации о противнике: из снимка виден только
                    // тот, кого дружина наблюдает прямо сейчас.
                    const live = knownEnemies.find((candidate) => candidate.id === enemy.id);
                    if (live) setUnitInfo(buildUnitInfo(live, { weapons, skills, side: "enemy" }, t));
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </div>
      {battleKind === "pvp" ? (
        <div className="pvp-sides-strip" aria-label={t("pvp.objective")}>
          <span className={`pvp-side-emblem is-side1${viewOwner === 1 ? " is-active" : ""}`} aria-hidden="true">
            1
          </span>
          <span className="pvp-side-emblem-sep" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
              <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
            </svg>
          </span>
          <span className={`pvp-side-emblem is-side2${viewOwner === 2 ? " is-active" : ""}`} aria-hidden="true">
            2
          </span>
        </div>
      ) : null}
      <BattleRosterPanel />
    </header>
  );
}
