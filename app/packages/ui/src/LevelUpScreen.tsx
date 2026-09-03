import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";

/**
 * Окно прокачки героя пролога после Миссии 2 (0.21.25).
 *
 * Микула получает уровень и выбирает класс — единственная опция «Богатырь».
 * Оружие при смене класса не переназначается: дубина из Миссии 1 остаётся
 * с героем, меч и булава не выдаются (оружие — из экипировки, не из класса).
 */
export function LevelUpScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();

  return (
    <div className="screen menu-screen levelup-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("prologue.title")}</p>
        <h1 className="display-title">{t("prologue.levelup.title")}</h1>
        <p className="muted">{t("prologue.levelup.body")}</p>
      </header>
      <nav className="menu-nav" aria-label={t("prologue.levelup.title")}>
        <div className="levelup-option">
          <div className="levelup-class">
            <span className="levelup-class-name">{t("unit.bogatyr.name")}</span>
            <p className="muted">{t("unit.bogatyr.desc")}</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => session.confirmLevelUp()}>
            {t("prologue.levelup.confirm")}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
