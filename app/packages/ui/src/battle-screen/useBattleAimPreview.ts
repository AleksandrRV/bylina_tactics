import { useEffect, useMemo, useState } from "react";
import type { CellPos, HitPreview, SkillStats } from "@bylina/core";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";

export function useBattleAimPreview(
  base: BattleScreenBase,
  kinds: BattleKinds,
  snapshotModel: BattleSnapshotModel,
  intentModel: BattleIntentModel,
  skills: Record<string, SkillStats>,
) {
  const { session, paused, rendererRef } = base;
  const { isNetGuest, usesNetSnapshot, isReplay } = kinds;
  const { battleRevision, snapshot } = snapshotModel;
  const { selectedId, selected, action, aimId, skillTargetPos, preview } = intentModel;

  const hit: HitPreview | null = useMemo(() => {
    void battleRevision;
    if (selectedId === null || !action) return null;
    if (action.type === "weapon") {
      if (aimId === null) return null;
      if (isNetGuest) return session.requestNetHitPreview(selectedId, aimId, action.id);
      if (usesNetSnapshot || isReplay) return null;
      return session.getBattleHitPreview(selectedId, aimId, action.id);
    }
    if (aimId === null && !skillTargetPos) return null;
    // Предпросмотр умений у гостя/наблюдателя не вычисляется (нет ядра / просмотр).
    if (usesNetSnapshot) return null;
    const result = session.getBattleSkillPreview(
      selectedId,
      action.id,
      aimId ?? undefined,
      skillTargetPos ?? undefined,
    );
    return {
      available: result.available,
      reason: result.reason,
      chance: result.chance,
      dmgMin: result.dmgMin,
      dmgMax: result.dmgMax,
      cover: result.cover,
      heightMod: result.heightMod,
      flanked: result.flanked,
      areaCells: result.areaCells,
    };
    // Состояние исполнителя и цели меняется только с боем — ревизия служит
    // триггером пересчёта предпросмотра (0.21.11); координаты наведения
    // (aimId/skillTargetPos) остаются явными зависимостями.
  }, [battleRevision, selectedId, aimId, skillTargetPos, action, isNetGuest, usesNetSnapshot, isReplay, session]);

  const aimBreakCell = useMemo(() => {
    if (!hit || !selected || !aimId) return null;
    // breakCell теперь вычисляется ядром в previewAttack (§7, §9.3).
    if (hit.breakCell) return hit.breakCell;
    return null;
  }, [hit, selected, aimId]);

  const hoverCell = useMemo<CellPos | null>(() => {
    if (skillTargetPos) return skillTargetPos;
    if (!preview) return null;
    const [xs, ys] = preview.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const tile = snapshot.grid.tiles.find((t) => t.x === x && t.y === y);
    return { x, y, z: tile?.z ?? 0 };
  }, [preview, skillTargetPos, snapshot.grid]);

  // Этап 2.6 (правка по ревью): областной прицел виден сразу при выборе
  // умения с областью, включая «круговой взмах» богатыря (self + радиус).
  // Геометрия приходит из того же preview-вызова ядра, который использует
  // боевой экран, поэтому renderer не может расхождениями Math.hypot
  // потерять диагональные клетки.
  const areaPreview = useMemo(() => {
    void battleRevision;
    if (action?.type !== "skill" || selectedId === null || paused || base.busy) return null;
    const skill = skills[action.id];
    if (!skill) return null;
    const hasArea =
      (skill.radius ?? 0) > 0 || skill.effects.some((effect) => effect.type === "spawn" || effect.type === "displace");
    if (!hasArea) return null;

    const center =
      skill.category === "self"
        ? selected
        : skillTargetPos
          ? { x: skillTargetPos.x, y: skillTargetPos.y, z: skillTargetPos.z }
          : undefined;
    if (!center) return null;

    // У self-навыка без цели hit намеренно null: это не одиночный target
    // preview. Запрашиваем тот же SkillPreview отдельно, чтобы получить
    // areaCells и не дублировать геометрию в UI или renderer.
    const skillPreview =
      skill.category === "self" && !usesNetSnapshot ? session.getBattleSkillPreview(selectedId, action.id) : hit;
    if (!skillPreview?.areaCells?.length) return null;

    return {
      center: { x: center.x, y: center.y, z: center.z },
      radius: skill.radius ?? 0,
      areaCells: skillPreview.areaCells,
      // Красное предупреждение нужно только там, где атака действительно
      // допускает friendly fire; лечение/призыв с filter="all" не опасны.
      warnFriendly: skill.resolution === "attack" && (skill.filter === "all" || skill.filter === "allies"),
    };
    // Область предпросмотра зависит от состояния боя — ревизия служит
    // триггером пересчёта (0.21.11); выбор/наведение остаются явными.
  }, [
    battleRevision,
    action,
    selectedId,
    selected,
    skillTargetPos,
    skills,
    paused,
    base.busy,
    usesNetSnapshot,
    session,
    hit,
  ]);

  // Этап 4.8: карточка прицеливания подтягивается к цели (доли экрана).
  const [aimCardPos, setAimCardPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (aimId === null || !hit) {
      setAimCardPos(null);
      return;
    }
    const position = rendererRef.current?.getEntityScreenPosition?.(aimId) ?? null;
    if (!position) {
      setAimCardPos(null);
      return;
    }
    // Удержание в пределах экрана; карточка не перекрывает саму цель —
    // смещается вправо-вниз от точки прицеливания.
    setAimCardPos({
      x: Math.min(88, Math.max(14, position.x * 100 + 9)),
      y: Math.min(66, Math.max(12, position.y * 100 + 8)),
    });
  }, [aimId, hit, snapshot, rendererRef]);

  return {
    hit,
    aimBreakCell,
    hoverCell,
    areaPreview,
    aimCardPos,
    setAimCardPos,
  };
}

export type BattleAimPreviewModel = ReturnType<typeof useBattleAimPreview>;
