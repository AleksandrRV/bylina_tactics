import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";

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
          {isPrologue ? t(victory ? "prologue.victory.body" : "result.defeatHint") : isPvp ? t("pvp.won") : victory ? t("result.victoryHint") : t("result.defeatHint")}
        </p>
      </header>
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
