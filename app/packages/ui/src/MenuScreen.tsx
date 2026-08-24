import { useState } from "react";
import { MODE_OPENS_IN, type GameMode } from "@bylina/session";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";
import { Mark } from "./Mark.js";

export function MenuScreen() {
  useI18nTick();
  const t = useT();
  const { session, version, install, campaignFlow } = useServices();
  const { unavailableMode } = useSessionState();
  // Предупреждение «Новой былины» (0.20.15): подтверждение потери прогресса.
  const [confirmNewBylina, setConfirmNewBylina] = useState(false);
  const startBylina = (): void => {
    // Есть прогресс (несчитанное сохранение либо текущая былина) — сперва
    // предупреждение с вариантами выбора; свежая кампания открывается сразу.
    if (campaignFlow?.hasProgress) {
      setConfirmNewBylina(true);
      return;
    }
    if (campaignFlow) campaignFlow.startNewCampaign();
    else session.openMode("campaign");
  };

  return (
    <div className="screen menu-screen">
      <header className="menu-brand">
        <Mark className="menu-mark" />
        <p className="eyebrow">{t("app.subtitle")}</p>
        <h1 className="display-title">{t("app.title")}</h1>
        <p className="version-line">{t("app.version", { version })}</p>
      </header>

      <nav className="menu-nav" aria-label={t("app.fullTitle")}>
        {campaignFlow?.canContinue ? (
          // «Продолжить» (0.20.15): акцентная кнопка поверх остальных —
          // сохранённая былина ждёт решения игрока в главном меню.
          <button
            type="button"
            className="btn btn-continue"
            onClick={() => campaignFlow.continueCampaign()}
          >
            <span>{t("menu.continue")}</span>
            <span className="btn-continue-note" aria-hidden="true">→</span>
          </button>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={() => session.openTraining()}>
          <span>{t("menu.training")}</span>
        </button>
        <button type="button" className="btn btn-primary" onClick={() => session.openQuickMatch()}>
          <span>{t("menu.quickMatch")}</span>
        </button>
        <button type="button" className="btn btn-primary" onClick={startBylina}>
          <span>{t("menu.campaign")}</span>
        </button>
        <button type="button" className="btn btn-primary" onClick={() => session.openMode("pvp")}>
          <span>{t("menu.pvp")}</span>
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("settings")}>
          {t("menu.settings")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("replays")}>
          {t("menu.replays")}
        </button>
        {install.canInstall && !install.installed ? (
          <button type="button" className="btn btn-install" onClick={() => void install.prompt()}>
            {t("menu.install")}
          </button>
        ) : null}
      </nav>

      {confirmNewBylina ? (
        <div className="modal-root" role="presentation" onClick={() => setConfirmNewBylina(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-bylina-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="new-bylina-title">{t("menu.newBylinaTitle")}</h2>
            <p>{t("menu.newBylinaBody")}</p>
            <p className="muted">{t("menu.newBylinaNote")}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmNewBylina(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setConfirmNewBylina(false);
                  if (campaignFlow) campaignFlow.startNewCampaign();
                  else session.openMode("campaign");
                }}
              >
                {t("menu.newBylinaConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
