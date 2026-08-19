import { useEffect } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";
import { Mark } from "./Mark.js";

export function BootScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();

  useEffect(() => {
    const timer = window.setTimeout(() => session.goTo("menu"), 1100);
    return () => window.clearTimeout(timer);
  }, [session]);

  return (
    <div className="screen boot-screen">
      <Mark className="boot-mark" />
      <p className="eyebrow">{t("app.subtitle")}</p>
      <h1 className="display-title">{t("app.title")}</h1>
      <div className="boot-track" aria-hidden="true">
        <div className="boot-bar" />
      </div>
      <p className="muted">{t("boot.loading")}</p>
    </div>
  );
}
