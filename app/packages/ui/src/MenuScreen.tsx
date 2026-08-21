import { MODE_OPENS_IN, type GameMode } from "@bylina/session";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";
import { Mark } from "./Mark.js";

export function MenuScreen() {
  useI18nTick();
  const t = useT();
  const { session, version, install } = useServices();
  const { unavailableMode } = useSessionState();

  return (
    <div className="screen menu-screen">
      <header className="menu-brand">
        <Mark className="menu-mark" />
        <p className="eyebrow">{t("app.subtitle")}</p>
        <h1 className="display-title">{t("app.title")}</h1>
        <p className="version-line">{t("app.version", { version })}</p>
      </header>

      <nav className="menu-nav" aria-label={t("app.fullTitle")}>
        <button type="button" className="btn btn-primary" onClick={() => session.openQuickMatch()}>
          <span>{t("menu.quickMatch")}</span>
        </button>
        <button type="button" className="btn btn-primary" onClick={() => session.openMode("campaign")}>
          <span>{t("menu.campaign")}</span>
        </button>
        <button type="button" className="btn btn-primary" onClick={() => session.openMode("pvp")}>
          <span>{t("menu.pvp")}</span>
          <span className="btn-note">{t("common.notReady")}</span>
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("settings")}>
          {t("menu.settings")}
        </button>
        {install.canInstall && !install.installed ? (
          <button type="button" className="btn btn-install" onClick={() => void install.prompt()}>
            {t("menu.install")}
          </button>
        ) : null}
      </nav>

      {unavailableMode ? (
        <div className="modal-root" role="presentation" onClick={() => session.dismissUnavailable()}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unavailable-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="unavailable-title">{t("menu.unavailableTitle")}</h2>
            <p>{t("menu.unavailableBody", { version: MODE_OPENS_IN[unavailableMode] })}</p>
            <p className="muted">{t("menu.unavailableHint")}</p>
            <button type="button" className="btn btn-primary" onClick={() => session.dismissUnavailable()}>
              {t("common.ok")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
