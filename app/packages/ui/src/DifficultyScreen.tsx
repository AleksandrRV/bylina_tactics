import type { DifficultyId } from "@bylina/session";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";

const LEVELS: DifficultyId[] = ["easy", "normal", "hard"];

export function DifficultyScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();

  return (
    <div className="screen menu-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("app.title")}</p>
        <h1 className="display-title">{t("difficulty.title")}</h1>
        <p className="muted">{t("difficulty.hint")}</p>
      </header>
      <nav className="menu-nav" aria-label={t("difficulty.title")}>
        {LEVELS.map((id) => (
          <button key={id} type="button" className="btn btn-primary" onClick={() => session.selectDifficulty(id)}>
            <span>{t(`difficulty.${id}`)}</span>
            <span className="btn-note">{t(`difficulty.${id}Note`)}</span>
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          {t("difficulty.back")}
        </button>
      </nav>
    </div>
  );
}
