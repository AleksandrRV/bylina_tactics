import { RosterCard } from "../unit-card.js";
import { buildUnitInfo } from "../unit-info.js";
import { useBattleScreen } from "./context.js";

export function BattleRosterPanel() {
  const model = useBattleScreen();
  const {
    t,
    roster,
    selectedId,
    isTraining,
    trainingActorId,
    setLog,
    setIntent,
    setUnitInfo,
    rendererRef,
    weapons,
    skills,
    unitNameKey,
  } = model;

  return (
    <div className="roster" aria-label={t("field.sidePlayer")}>
      {roster.map((entity) => (
        <RosterCard
          key={entity.id}
          entity={entity}
          selected={entity.id === selectedId}
          name={t(unitNameKey(entity.configId))}
          onSelect={() => {
            if (entity.dead) return;
            // Обучение: выбор иного бойца запрещён — действует только
            // исполнитель текущего указания (строгий сценарий, 0.20.13).
            if (isTraining && trainingActorId !== null && entity.id !== trainingActorId) {
              setLog(t("training.locked.actor"));
              return;
            }
            setIntent({ type: "select", actorId: entity.id });
            // Камера плавно приходит к выбранному бойцу (0.20.42):
            // поле крупнее окна, и боец мог стоять за кадром.
            rendererRef.current?.focusEntity?.(entity.id);
          }}
          onInspect={() => setUnitInfo(buildUnitInfo(entity, { weapons, skills, side: "ally" }, t))}
        />
      ))}
    </div>
  );
}
