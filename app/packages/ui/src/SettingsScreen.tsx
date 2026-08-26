import { useServices, useT } from "./context.js";
import { useI18nTick, useSettingsState } from "./hooks.js";

export function SettingsScreen() {
  useI18nTick();
  const t = useT();
  const { settings, i18n, session } = useServices();
  const state = useSettingsState();
  const languages = i18n.getAvailableLanguages();

  return (
    <div className="screen settings-screen">
      <header className="settings-head">
        <p className="eyebrow">{t("app.title")}</p>
        <h1>{t("settings.title")}</h1>
      </header>

      <section className="panel">
        <h2>{t("settings.language")}</h2>
        <p className="muted">{t("settings.languageHint")}</p>
        <div className="lang-row" role="radiogroup" aria-label={t("settings.language")}>
          {languages.map((language) => {
            const active = state.language === language.code;
            return (
              <button
                key={language.code}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? "chip chip-active" : "chip"}
                onClick={() => {
                  settings.set({ language: language.code });
                  i18n.setLanguage(language.code);
                }}
              >
                {language.nativeName}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <label className="volume-label" htmlFor="master-volume">
          <span>{t("settings.masterVolume")}</span>
          <span className="volume-value">{state.masterVolume}</span>
        </label>
        <input
          id="master-volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={state.masterVolume}
          onChange={(event) => settings.set({ masterVolume: Number(event.target.value) })}
        />
      </section>

      <section className="panel">
        <label className="toggle-row" htmlFor="show-hints">
          <span className="toggle-meta">
            <span>{t("settings.showHints")}</span>
            <span className="muted">{t("settings.showHintsHint")}</span>
          </span>
          <input
            id="show-hints"
            type="checkbox"
            role="switch"
            aria-checked={state.showHints}
            checked={state.showHints}
            onChange={(event) => settings.set({ showHints: event.target.checked })}
          />
        </label>
      </section>

      <section className="panel">
        <label className="toggle-row" htmlFor="auto-end-turn">
          <span className="toggle-meta">
            <span>{t("settings.autoEndTurn")}</span>
            <span className="muted">{t("settings.autoEndTurnHint")}</span>
          </span>
          <input
            id="auto-end-turn"
            type="checkbox"
            role="switch"
            aria-checked={state.autoEndTurn}
            checked={state.autoEndTurn}
            onChange={(event) => settings.set({ autoEndTurn: event.target.checked })}
          />
        </label>
      </section>

      <section className="panel">
        <label className="toggle-row" htmlFor="debug-mode">
          <span className="toggle-meta">
            <span>{t("settings.debugMode")}</span>
            <span className="muted">{t("settings.debugModeHint")}</span>
          </span>
          <input
            id="debug-mode"
            type="checkbox"
            role="switch"
            aria-checked={state.debugMode}
            checked={state.debugMode}
            onChange={(event) => settings.set({ debugMode: event.target.checked })}
          />
        </label>
      </section>

      <button type="button" className="btn btn-primary" onClick={() => session.goTo("menu")}>
        {t("settings.back")}
      </button>
    </div>
  );
}
