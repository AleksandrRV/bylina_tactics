import { useCallback, useState } from "react";
import { IDLE_INTENT, nextIntent, type Intent, type IntentEvent } from "../battle-intent.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";

export function useBattleIntentState(snapshotModel: BattleSnapshotModel) {
  // Намерение игрока — один объект вместо семи состояний (0.21.16–0.21.17,
  // дни 17–18, P1-2): семь прежних useState (selectedId, action, aimId,
  // skillTargetPos, preview, charge, chargeArmed) заменены одним этим, а
  // прежние имена остаются производными значениями ниже. Запись идёт только
  // событием в чистую nextIntent (battle-intent.ts) — запрещённые сочетания
  // («прицел без бойца», «рывок без плана») невыразимы в типах.
  const [intent, setIntentState] = useState<Intent>(IDLE_INTENT);

  // Стабильный диспетчер: внутри только функциональная обновляющая форма
  // поверх чистой nextIntent, поэтому ссылка не меняется между кадрами.
  const setIntent = useCallback((event: IntentEvent): void => {
    setIntentState((current) => nextIntent(current, event));
  }, []);

  const selectedId = intent.kind === "idle" ? null : intent.actorId;
  const action = intent.kind === "aiming" || intent.kind === "charging" ? intent.action : null;
  const aimId = intent.kind === "aiming" || intent.kind === "charging" ? intent.targetId : null;
  const skillTargetPos = intent.kind === "aiming" ? intent.targetPos : null;
  const preview = intent.kind === "aiming" || intent.kind === "placing" ? intent.preview : null;
  const charge = intent.kind === "charging" ? intent.plan : null;
  const chargeArmed = intent.kind === "charging" ? intent.armed : false;

  const selected = snapshotModel.snapshot.entities.find((entity) => entity.id === selectedId) ?? null;

  /** Снять прицеливание, маршрут пути и рывок (0.20.50); боец остаётся выбранным. */
  const clearAim = useCallback((): void => {
    setIntent({ type: "cancel" });
  }, [setIntent]);

  return {
    intent,
    setIntent,
    selectedId,
    selected,
    action,
    aimId,
    skillTargetPos,
    preview,
    charge,
    chargeArmed,
    clearAim,
  };
}

export type BattleIntentModel = ReturnType<typeof useBattleIntentState>;
