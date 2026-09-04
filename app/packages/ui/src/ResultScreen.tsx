import { useEffect, useMemo, useState } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";
import { unitPortrait } from "./portraits.js";
import { TalentChoiceDialog } from "./TalentChoiceDialog.js";

function XpBar({
  gain,
}: {
  gain: {
    name: string;
    xpBefore: number;
    xpAfter: number;
    levelBefore: number;
    levelAfter: number;
    leveled: boolean;
    gained: number;
  };
}) {
  const XP_MAX = 100;
  const beforePct = Math.min(100, Math.max(0, (gain.xpBefore / XP_MAX) * 100));
  const targetPct = gain.leveled ? 100 : Math.min(100, Math.max(0, (gain.xpAfter / XP_MAX) * 100));
  const [pct, setPct] = useState(beforePct);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setPct(targetPct);
      if (gain.leveled) window.setTimeout(() => setFlash(true), 900);
    }, 140);
    return () => window.clearTimeout(id);
  }, [targetPct, gain.leveled]);
  return (
    <div className={`xp-row${gain.leveled ? " is-leveled" : ""}${flash ? " is-flash" : ""}`}>
      <div className="xp-row-head">
        <span className="xp-name">{gain.name}</span>
        <span className="xp-levels">
          Ур. {gain.levelBefore}
          {gain.levelAfter !== gain.levelBefore ? ` → ${gain.levelAfter}` : ""}
          {gain.leveled ? <span className="xp-badge">↗</span> : null}
        </span>
        <span className="xp-values">
          {gain.leveled ? `${XP_MAX}/${XP_MAX}` : `${gain.xpAfter}/${XP_MAX}`}
          {gain.gained > 0 ? <span className="xp-gain">+{gain.gained}</span> : null}
        </span>
      </div>
      <div className="xp-bar" aria-hidden="true">
        <div className="xp-bar-track" />
        <div
          className="xp-bar-fill"
          style={{ width: `${pct}%`, transition: "width 820ms cubic-bezier(0.22,1,0.36,1)" }}
        />
        {gain.leveled ? <span className="xp-bar-shine" /> : null}
      </div>
    </div>
  );
}

/** Классы, доступные герою пролога при повышении (campaign.md §6.1): только богатырь. */
const PROLOGUE_CLASS_IDS: readonly string[] = ["bogatyr"];

export function ResultScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const classUnlockLevel = content.campaign.classUnlockLevel;
  const { outcome, pvpWinner, battleKind } = useSessionState();
  const victory = outcome === "victory";
  const isPvp = pvpWinner !== undefined && pvpWinner !== null;
  // Итог сюжетной миссии пролога (0.21.25): стандартный экран победы после
  // финального текстового сообщения миссии; «Дальше» ведёт в следующую миссию.
  const isPrologue = battleKind === "prologue";
  // Автомат кампании привязан только в былине: быстрый матч и состязание
  // приходят сюда без него, а маршрутизация оболочки может смонтировать
  // экран пролога до привязки — тогда опыт и повышение просто не показываются.
  const campaign = useMemo(() => {
    if (!isPrologue) return null;
    try {
      return session.getCampaign();
    } catch {
      return null;
    }
  }, [isPrologue, session]);
  const [, setTick] = useState(0);
  useEffect(() => campaign?.subscribe(() => setTick((value) => value + 1)), [campaign]);
  const campaignState = campaign?.getState() ?? null;
  const last = campaignState?.lastResult ?? null;
  const showXp = isPrologue && victory && Boolean(last?.xpGains.length);
  // Стандартное окно повышения (0.21.30): Микула, достигший порога класса,
  // выбирает класс тем же окном, что рекрут на карте, — но единственный
  // вариант пролога — Богатырь (campaign.md §6.1). Пока выбор не сделан,
  // «Дальше» закрыта: в М3 герой выходит уже богатырём.
  const heroForTrain =
    campaignState?.fighters.find(
      (fighter) => fighter.alive && fighter.unitId === "mikula_peasant" && fighter.level >= classUnlockLevel,
    ) ?? null;
  const needsPrologueTrain = isPrologue && victory && heroForTrain !== null;
  // Талант (0.21.30): уровни выше порога класса — выбор одного из двух, тем
  // же окном, что в песочнице.
  const talentChoice =
    isPrologue && victory && !needsPrologueTrain ? (campaign?.getPendingTalentChoice() ?? null) : null;
  const talentFighter = talentChoice
    ? campaignState?.fighters.find((fighter) => fighter.id === talentChoice.fighterId)
    : undefined;
  const handlePrologueTrain = (): void => {
    if (!heroForTrain) return;
    session.getCampaign().assignClass(heroForTrain.id, "bogatyr");
  };

  return (
    <div className="screen menu-screen">
      <header className="menu-brand">
        <p className="eyebrow">{isPrologue ? t("prologue.title") : isPvp ? t("menu.pvp") : t("menu.quickMatch")}</p>
        <h1 className="display-title">
          {isPrologue
            ? t(victory ? "prologue.victory.title" : "result.defeat")
            : isPvp
              ? pvpWinner === 1
                ? t("pvp.side1")
                : t("pvp.side2")
              : victory
                ? t("result.victory")
                : t("result.defeat")}
        </h1>
        <p className="muted">
          {isPrologue
            ? t(victory ? "prologue.victory.body" : "result.defeatHint")
            : isPvp
              ? t("pvp.won")
              : victory
                ? t("result.victoryHint")
                : t("result.defeatHint")}
        </p>
      </header>

      {showXp && last ? (
        <div className="xp-section" aria-label={t("missionResult.xp")}>
          <p className="xp-section-title">{t("missionResult.xp")}</p>
          {last.xpGains.map((gain) => (
            <XpBar key={gain.fighterId} gain={gain} />
          ))}
          <p className="muted xp-section-hint">{t("prologue.xpHint")}</p>
        </div>
      ) : null}

      {needsPrologueTrain && heroForTrain ? (
        <div className="pause-root" role="presentation" style={{ position: "static", background: "transparent" }}>
          <div
            className="pause-card train-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="train-title"
            style={{ boxShadow: "none" }}
          >
            <h2 id="train-title">{t("roster.trainTitle", { name: heroForTrain.name })}</h2>
            <p className="muted">{t("roster.trainHint")}</p>
            <div className="class-grid">
              {PROLOGUE_CLASS_IDS.map((classId) => {
                const face = unitPortrait(classId);
                return (
                  <button key={classId} type="button" className="class-card" onClick={handlePrologueTrain}>
                    {face ? (
                      <img src={face} alt="" draggable={false} />
                    ) : (
                      <span className="deploy-face-empty" aria-hidden="true" />
                    )}
                    <span>{t(`unit.${classId}.name`)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {talentChoice && talentFighter ? (
        <TalentChoiceDialog choice={talentChoice} fighterName={talentFighter.name} inline />
      ) : null}

      <nav className="menu-nav">
        {isPrologue ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={needsPrologueTrain || talentChoice !== null}
            onClick={() => session.continuePrologue()}
          >
            {t("prologue.victory.continue")}
          </button>
        ) : !isPvp ? (
          <button type="button" className="btn btn-primary" onClick={() => session.playAgain()}>
            {t("result.again")}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => session.openPvpRoom()}>
            {t("pvp.again")}
          </button>
        )}
        {!isPrologue ? (
          <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
            {t("result.toMenu")}
          </button>
        ) : null}
      </nav>
    </div>
  );
}
