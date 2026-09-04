import { useEffect, useState } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";

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

export function ResultScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const { outcome, pvpWinner, battleKind } = useSessionState();
  const victory = outcome === "victory";
  const isPvp = pvpWinner !== undefined && pvpWinner !== null;
  // Итог сюжетной миссии пролога (0.21.25): стандартный экран победы после
  // финального текстового сообщения миссии; «Дальше» ведёт в следующую миссию.
  const isPrologue = battleKind === "prologue";
  let last: {
    xpGains: Array<{
      fighterId: number;
      name: string;
      xpBefore: number;
      xpAfter: number;
      levelBefore: number;
      levelAfter: number;
      leveled: boolean;
      gained: number;
    }>;
  } | null = null;
  try {
    last = session.getCampaign().getState().lastResult;
  } catch {
    last = null;
  }
  const showXp = isPrologue && last?.xpGains && last.xpGains.length > 0 && victory;

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

      {showXp ? (
        <div className="xp-section" aria-label={t("missionResult.xp") ?? "Опыт"}>
          <p className="xp-section-title">{t("missionResult.xp") ?? "Опыт бойцов"}</p>
          {last!.xpGains.map((gain) => (
            <XpBar key={gain.fighterId} gain={gain} />
          ))}
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {t("prologue.xpHint") ?? ""}
          </p>
        </div>
      ) : null}

      <nav className="menu-nav">
        {isPrologue ? (
          <button type="button" className="btn btn-primary" onClick={() => session.continuePrologue()}>
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
