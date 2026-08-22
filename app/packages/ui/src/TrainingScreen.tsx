import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";
import { unitPortrait } from "./portraits.js";

function unitName(unitId: string): string {
  return `unit.${unitId}.name`;
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 4 6.5 10l6 6" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3.5h8a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2v-11Z" />
      <path d="M14 5.5h2v11h-2" />
      <path d="M6.5 7h4M6.5 9.5h4" />
    </svg>
  );
}

function StepsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h12M4 10h12M4 14h7" />
      <circle cx="16" cy="14" r="2" />
    </svg>
  );
}

function SwordIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
      <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
    </svg>
  );
}

const MISSION_ICONS: Record<string, (props: { className?: string }) => React.JSX.Element> = {
  movement: StepsIcon,
  combat: SwordIcon,
  skills: BookIcon,
};

/**
 * Экран режима обучения (roadmap 0.19.0): три карточки миссий, каждая
 * доступна отдельно; пройденные отмечаются.
 */
export function TrainingScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const { trainingDone } = useSessionState();
  const missions = content.training.missions;
  const done = trainingDone ?? [];

  return (
    <div className="screen menu-screen training-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("app.subtitle")}</p>
        <h1 className="display-title">{t("training.title")}</h1>
        <div className="training-mentor-row" role="status">
          {unitPortrait("chronicler") ? (
            <img className="training-mentor-face" src={unitPortrait("chronicler")} alt="" draggable={false} />
          ) : null}
          <span className="training-mentor-line">
            <b>{t("training.mentor")}:</b> {t("training.hint")}
          </span>
        </div>
      </header>

      <div className="training-grid">
        {missions.map((mission, index) => {
          const completed = done.includes(mission.id);
          const Icon = MISSION_ICONS[mission.id] ?? BookIcon;
          return (
            <button
              key={mission.id}
              type="button"
              className={`training-card${completed ? " is-done" : ""}`}
              onClick={() => session.startTrainingMission(mission.id)}
            >
              <span className="training-card-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="training-card-index">{t("training.mission", { number: index + 1 })}</span>
              <span className="training-card-title">{t(mission.titleKey)}</span>
              <span className="training-card-desc">{t(mission.descriptionKey)}</span>
              <span className="training-card-footer">
                {completed ? <span className="training-done-mark">{t("training.completed")}</span> : <span className="training-start">{t("training.start")} →</span>}
              </span>
            </button>
          );
        })}
      </div>

      <nav className="menu-nav">
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          <BackIcon />
          {t("common.back")}
        </button>
      </nav>
    </div>
  );
}
