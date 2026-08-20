import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";

export function ResultScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const { outcome } = useSessionState();
  const victory = outcome === "victory";

  return (
    <div className="screen menu-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("menu.quickMatch")}</p>
        <h1 className="display-title">{victory ? t("result.victory") : t("result.defeat")}</h1>
        <p className="muted">{victory ? t("result.victoryHint") : t("result.defeatHint")}</p>
      </header>
      <nav className="menu-nav">
        <button type="button" className="btn btn-primary" onClick={() => session.playAgain()}>
          {t("result.again")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          {t("result.toMenu")}
        </button>
      </nav>
    </div>
  );
}
