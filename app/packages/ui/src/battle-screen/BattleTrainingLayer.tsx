import { unitPortrait } from "../portraits.js";
import { CampaignHint } from "../CampaignHint.js";
import { useBattleScreen } from "./context.js";

export function BattleTrainingLayer() {
  const model = useBattleScreen();
  const {
    t,
    isTraining,
    trainingMission,
    activeHint,
    hintStep,
    setHintStep,
    trainingHints,
    trainingNote,
    activeBattleHint,
    closeBattleHint,
    content,
    session,
    trainingDoneMissions,
  } = model;

  return (
    <>
      {isTraining && trainingMission ? (
        // Единая обучающая панель «наставник»: портрет, шаг и инструкция
        // собраны в одну компактную карточку у верхнего края, чтобы не
        // перекрывать центр поля (доработка вёрстки обучения).
        <div className="training-coach" role="status" aria-live="polite">
          {unitPortrait("chronicler") ? (
            <img className="training-coach-face" src={unitPortrait("chronicler")} alt="" draggable={false} />
          ) : null}
          <div className="training-coach-body">
            <div className="training-coach-head">
              <span className="training-coach-name">{t("training.mentor")}</span>
              {activeHint ? (
                <span className="training-hint-step">
                  {t("training.step", { current: hintStep + 1, total: trainingHints.length })}
                </span>
              ) : null}
            </div>
            <p className="training-coach-line">
              {activeHint ? t(activeHint.textKey) : t(`training.${trainingMission.id}.intro`)}
            </p>
            {activeHint && activeHint.until === "noop" ? (
              <button type="button" className="training-continue" onClick={() => setHintStep((value) => value + 1)}>
                {t("training.continue")}
              </button>
            ) : null}
          </div>
          {/* Пропуск шага — только при повторном прохождении уже
              пройденной миссии (0.20.2): первое прохождение ведётся
              по шагам без пропуска (доводка обучения). */}
          {activeHint && (trainingDoneMissions ?? []).includes(trainingMission.id) ? (
            <button type="button" className="training-skip" onClick={() => setHintStep((value) => value + 1)}>
              {t("training.skip")}
            </button>
          ) : null}
          {activeHint ? (
            <span className="training-step-dots" aria-hidden="true">
              {trainingHints.map((item, index) => (
                <i
                  key={item.step}
                  className={`training-step-dot${index < hintStep ? " is-done" : index === hintStep ? " is-current" : ""}`}
                />
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      {trainingNote ? (
        // Реактивные плашки (яд, воскрешение, призыв) — у нижнего края,
        // над панелью действий, чтобы не перекрывать центр поля.
        <div className="training-note" role="status" aria-live="polite">
          <span className="training-note-mark" aria-hidden="true">
            ✦
          </span>
          {t(trainingNote)}
        </div>
      ) : null}
      {activeBattleHint ? (
        <CampaignHint
          key={activeBattleHint}
          hintId={activeBattleHint}
          variant={activeBattleHint === "first_battle" ? "modal" : "banner"}
          onClose={closeBattleHint}
          action={
            // Туториал «первый бой» предлагает режим обучения игроку,
            // который его ещё не прошёл (0.20.2, доводка онбординга).
            activeBattleHint === "first_battle" &&
            !content.training.missions.every((mission) => (trainingDoneMissions ?? []).includes(mission.id))
              ? {
                  label: t("training.offerOpen"),
                  run: () => {
                    closeBattleHint();
                    session.goTo("training");
                  },
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}
