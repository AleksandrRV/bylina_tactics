import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";
import { unitPortrait } from "./portraits.js";

function unitName(unitId: string): string {
  return `unit.${unitId}.name`;
}

function SwordsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
      <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 4 6.5 10l6 6" />
    </svg>
  );
}

/**
 * Комната сбора поочерёдной игры (roadmap 0.14.0): две стороны на одном
 * устройстве, готовый набор записей, условие «уничтожение всех юнитов».
 */
export function PvpRoomScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const pool = content.pvp.pool;
  const n = pool.length;

  const start = (): void => {
    if (pool.length === 0) return;
    session.startPvpBattle([...pool], [...pool], Date.now() >>> 0);
  };

  return (
    <div className="screen pvp-room-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("app.subtitle")}</p>
        <h1 className="display-title">{t("menu.pvp")}</h1>
        <p className="muted">{t("pvp.roomHint")}</p>
      </header>

      <div className="pvp-arena">
        <section className={`pvp-side-card is-side1`} aria-label={t("pvp.side1")}>
          <h2 className="pvp-side-title">{t("pvp.side1")}</h2>
          <div className="pvp-roster">
            {pool.map((unitId) => {
              const face = unitPortrait(unitId);
              return (
                <div key={unitId} className="pvp-slot">
                  {face ? <img className="pvp-slot-face" src={face} alt="" draggable={false} /> : <span className="deploy-face-empty" aria-hidden="true" />}
                  <span className="pvp-slot-name">{t(unitName(unitId))}</span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="pvp-versus" aria-hidden="true">
          <SwordsIcon />
          <span className="pvp-versus-label">{t("pvp.vs")}</span>
          <span className="pvp-n-badge">{t("pvp.n", { count: n })}</span>
        </div>

        <section className="pvp-side-card is-side2" aria-label={t("pvp.side2")}>
          <h2 className="pvp-side-title">{t("pvp.side2")}</h2>
          <div className="pvp-roster">
            {pool.map((unitId) => {
              const face = unitPortrait(unitId);
              return (
                <div key={unitId} className="pvp-slot">
                  {face ? <img className="pvp-slot-face" src={face} alt="" draggable={false} /> : <span className="deploy-face-empty" aria-hidden="true" />}
                  <span className="pvp-slot-name">{t(unitName(unitId))}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <p className="pvp-objective">{t("pvp.objective")}</p>

      <nav className="menu-nav">
        <button type="button" className="btn btn-primary" onClick={start} disabled={pool.length === 0}>
          <span>{t("pvp.start")}</span>
          <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          <BackIcon />
          {t("common.back")}
        </button>
      </nav>
    </div>
  );
}
