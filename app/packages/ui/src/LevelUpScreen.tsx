import { useMemo } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";
import { unitPortrait } from "./portraits.js";

/**
 * Окно прокачки героя пролога после Миссии 2 (0.21.27).
 *
 * Стандартное окно повышения как в свободных миссиях кампании, без
 * кастомного UI. Микула без класса, при первом повышении выбор класса —
 * единственный вариант Богатырь. Использует тот же `assignClass`, что и
 * вольные миссии (CampaignScreen train-card), только фильтр `[bogatyr]`.
 */
export function LevelUpScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const campaign = session.getCampaign();
  const hero = useMemo(
    () => campaign.getState().fighters.find((f) => f.alive && f.unitId === "mikula_peasant"),
    [campaign],
  );
  // Для крестьянина доступен только Богатырь — стандартный список фильтруется до одного варианта.
  const availableClasses = hero ? (["bogatyr"] as const) : ([] as readonly string[]);
  const unitName = (id: string) => `unit.${id}.name`;

  return (
    <div className="screen menu-screen levelup-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("prologue.title")}</p>
        <h1 className="display-title">{t("prologue.levelup.title")}</h1>
        <p className="muted">{t("prologue.levelup.body")}</p>
      </header>
      <div className="pause-root" role="presentation" style={{ position: "static", background: "transparent" }}>
        <div
          className="pause-card train-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="train-title"
          style={{ boxShadow: "none" }}
        >
          <h2 id="train-title" style={{ display: "none" }}>
            {t("roster.trainTitle", { name: hero?.name ?? "Микула" })}
          </h2>
          <p className="muted">{t("roster.trainHint")}</p>
          <div className="class-grid">
            {availableClasses.map((classId) => {
              const face = unitPortrait(classId);
              return (
                <button key={classId} type="button" className="class-card" onClick={() => session.confirmLevelUp()}>
                  {face ? (
                    <img src={face} alt="" draggable={false} />
                  ) : (
                    <span className="deploy-face-empty" aria-hidden="true" />
                  )}
                  <span>{t(unitName(classId))}</span>
                </button>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            {t("prologue.levelup.bogatyrHint") ?? ""}
          </p>
        </div>
      </div>
    </div>
  );
}
