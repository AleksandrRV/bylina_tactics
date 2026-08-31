import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";

export function ResultScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const { outcome, pvpWinner } = useSessionState();
  const victory = outcome === "victory";
  const isPvp = pvpWinner !== undefined && pvpWinner !== null;

  return (
    <div className="screen menu-screen">
      <header className="menu-brand">
        <p className="eyebrow">{isPvp ? t("menu.pvp") : t("menu.quickMatch")}</p>
        <h1 className="display-title">
          {isPvp
            ? pvpWinner === 1
              ? t("pvp.side1")
              : t("pvp.side2")
            : victory
              ? t("result.victory")
              : t("result.defeat")}
        </h1>
        <p className="muted">{isPvp ? t("pvp.won") : victory ? t("result.victoryHint") : t("result.defeatHint")}</p>
      </header>
      <nav className="menu-nav">
        {!isPvp ? (
          <button type="button" className="btn btn-primary" onClick={() => session.playAgain()}>
            {t("result.again")}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => session.openPvpRoom()}>
            {t("pvp.again")}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          {t("result.toMenu")}
        </button>
      </nav>
    </div>
  );
}
