/**
 * Разбор нажатия по полю боя (0.20.63).
 *
 * Прежде намерение нажатия жило внутри обработчика экрана: сто сорок строк,
 * где перемешаны ознакомительный шаг обучения, автоматическое включение
 * оружия по врагу, прицеливание, рывок, умения по клетке и подтверждение
 * шага пальцем. Здесь остался ответ на вопрос «что значит это нажатие», а
 * исполнение — за экраном: он держит состояние и команды. Разбор стал
 * проверяемым без React и без поля — тест передаёт состояние боя и читает
 * намерение.
 */

import type { EntityState, ReachableCell, SkillStats } from "@bylina/core";
import { cellKey, interactiveEntityAt, primaryAttackForEnemy } from "./cell-interaction.js";
import type { SelectableAction } from "./action-shortcuts.js";
import type { ChargePlan } from "./charge-attack.js";
import type { TrainingActionKind, TrainingDirective } from "./training-scenario.js";

/** Состояние боя, нужное для разбора нажатия. */
export interface CellClickContext {
  paused: boolean;
  /** Идёт анимация событий: ввод закрыт. */
  busy: boolean;
  /** Показывается итог боя: ввод закрыт. */
  outcomePending: boolean;
  /** Ход принадлежит стороне экрана. */
  ownTurn: boolean;
  isTraining: boolean;
  /** Ознакомительный шаг обучения: нажатие подтверждает понимание (0.20.1). */
  trainingNoopStep: boolean;
  /** Исполнитель текущего указания обучения. */
  trainingActorId: number | null;
  trainingDirective: TrainingDirective | null;
  selectedId: number | null;
  selected: EntityState | null;
  action: SelectableAction | null;
  skills: Record<string, SkillStats>;
  entities: readonly EntityState[];
  /** Плитки поля: по ним берётся высота клетки постановки. */
  tiles: readonly { x: number; y: number; z: number }[];
  viewOwner: number;
  /** Клетка под нажатием, если она достижима. */
  reach: ReachableCell | undefined;
  aimId: number | null;
  /** Доступен ли удар по прицеленной цели — ответ предпросмотра ядра. */
  hitAvailable: boolean;
  /** Показанный план рывка к цели (0.20.50). */
  charge: ChargePlan | null;
  /** Игрок подтвердил рывок первым нажатием. */
  chargeArmed: boolean;
  /** Ключ клетки, на которую уже показан предпросмотр шага. */
  preview: string | null;
  /** Крупный жест (палец): шаг подтверждается вторым нажатием. */
  coarse: boolean;
}

/** Что значит нажатие по клетке. */
export type CellIntent =
  /** Ввод закрыт либо нажатие ни к чему не ведёт. */
  | { kind: "ignore" }
  /** Ознакомительный шаг обучения: нажатие продвигает подсказку. */
  | { kind: "advanceNoopStep" }
  /** Круговое умение на себя: цель не нужна, область уже подсвечена. */
  | { kind: "selfArea"; skillId: string }
  /** Выбрать своего бойца. */
  | { kind: "select"; id: number }
  /** Обучение: выбрать можно только исполнителя указания (0.20.13). */
  | { kind: "denyActor" }
  /** Враг без выбранного действия: включить основное оружие. */
  | { kind: "armAttack"; entry: SelectableAction; targetId: number | null }
  /** Обучение: оружие или цель не предписаны указанием. */
  | { kind: "denyTarget"; action: TrainingActionKind }
  /** Прицелиться по бойцу: первое нажатие. */
  | { kind: "aim"; id: number }
  /** Удар по прицеленной доступной цели: повторное нажатие. */
  | { kind: "attack"; id: number }
  /** Рывок к прицеленной дальней цели: повторное нажатие (0.20.50). */
  | { kind: "charge"; id: number }
  /** Умение, требующее клетки: призыв или перенос. */
  | { kind: "positionSkill"; cell: { x: number; y: number; z: number } }
  /** Крупный жест: показать шаг, не совершая его. */
  | { kind: "previewMove"; key: string }
  /** Переместиться в клетку. */
  | { kind: "move"; cell: ReachableCell }
  /** Снять прицеливание и предпросмотр. */
  | { kind: "cancel" };

/**
 * Разобрать нажатие по клетке `(x, y)`. Порядок проверок повторяет прежний
 * обработчик: закрытый ввод, ознакомительный шаг, умение на себя, выбор
 * своего бойца, автоматическое оружие по врагу, прицеливание и удар, умение
 * по клетке, шаг.
 */
export function resolveCellClick(x: number, y: number, ctx: CellClickContext): CellIntent {
  if (ctx.paused || ctx.busy || ctx.outcomePending || !ctx.ownTurn) return { kind: "ignore" };
  // Ознакомительный шаг (until "noop", 0.20.1): действие не предполагается,
  // шаг завершается нажатием в любое место поля — иначе подсказка застревала
  // бы до первого действия.
  if (ctx.isTraining && ctx.trainingNoopStep) return { kind: "advanceNoopStep" };

  const reach = ctx.reach;
  const targeting = ctx.action !== null;
  const selectedSkill = ctx.action?.type === "skill" ? ctx.skills[ctx.action.id] : undefined;
  const positionOnlySkill = selectedSkill?.effects.some((effect) => effect.type === "spawn");
  // Умение по союзнику или по всем: нажатие по своему бойцу — это цель
  // умения, а не выбор бойца.
  const allyTargeting = Boolean(
    selectedSkill && !positionOnlySkill && (selectedSkill.filter === "allies" || selectedSkill.filter === "all"),
  );
  // Умение «на себя» с областью (круговой взмах, §2.6): пока оно выбрано,
  // нажатие по любой клетке применяет его — область уже подсвечена.
  const selfAreaTargeting = Boolean(selectedSkill?.category === "self" && (selectedSkill.radius ?? 0) > 0);
  if (selfAreaTargeting && ctx.action?.type === "skill") return { kind: "selfArea", skillId: ctx.action.id };

  const entity = interactiveEntityAt(ctx.entities, x, y, Boolean(reach) && !targeting);
  if (entity?.owner === ctx.viewOwner && entity.coverType === 0 && entity.maxAp > 0 && !allyTargeting) {
    if (ctx.isTraining && ctx.trainingActorId !== null && entity.id !== ctx.trainingActorId) {
      return { kind: "denyActor" };
    }
    return { kind: "select", id: entity.id };
  }

  // Клик по врагу без выбранного действия включает основное оружие и делает
  // врага предварительной целью.
  const automaticAttack = primaryAttackForEnemy(ctx.selected ?? undefined, entity, ctx.viewOwner, targeting);
  if (automaticAttack) {
    const targetId = entity?.id ?? null;
    if (!ctx.isTraining) return { kind: "armAttack", entry: automaticAttack, targetId };
    const directive = ctx.trainingDirective;
    if (directive?.kind === "attack" && targetId === directive.targetId && automaticAttack.id === directive.weaponId) {
      return { kind: "armAttack", entry: automaticAttack, targetId };
    }
    return { kind: "denyTarget", action: "attack" };
  }

  if (entity && ctx.selectedId !== null && targeting) {
    // Обучение: прицеливание допустимо только по цели текущего указания.
    if (ctx.isTraining) {
      const directive = ctx.trainingDirective;
      const isWeapon = ctx.action?.type === "weapon";
      const allowed =
        directive !== null &&
        ((isWeapon && directive.kind === "attack" && directive.targetId === entity.id) ||
          (!isWeapon && directive.kind === "skill" && directive.targetId === entity.id));
      if (!allowed) return { kind: "denyTarget", action: isWeapon ? "attack" : "skill" };
    }
    if (ctx.aimId === entity.id && ctx.hitAvailable) return { kind: "attack", id: entity.id };
    // Рывок к цели ближнего боя (0.20.50): первое нажатие показывает подход
    // и линию удара, повторное по той же цели — подходит и бьёт.
    if (ctx.aimId === entity.id && ctx.charge?.targetId === entity.id && ctx.chargeArmed) {
      return { kind: "charge", id: entity.id };
    }
    return { kind: "aim", id: entity.id };
  }

  const needsPosition = selectedSkill?.effects.some((effect) => effect.type === "spawn" || effect.type === "displace");
  if (needsPosition && ctx.action?.type === "skill") {
    const tile = ctx.tiles.find((candidate) => candidate.x === x && candidate.y === y);
    return tile ? { kind: "positionSkill", cell: { x, y, z: tile.z } } : { kind: "ignore" };
  }

  // Проходимая клетка без выбранного действия всегда означает движение:
  // граневое укрытие в ней не перехватывает выбор как цель атаки.
  if (reach && !targeting) {
    const key = cellKey(x, y);
    // Крупный жест (палец) закрывает клетку: первое нажатие показывает шаг,
    // второе его совершает.
    if (ctx.coarse && ctx.preview !== key) {
      const directive = ctx.trainingDirective;
      if (ctx.isTraining && (directive?.kind !== "move" || directive.cell.x !== x || directive.cell.y !== y)) {
        return { kind: "denyTarget", action: "move" };
      }
      return { kind: "previewMove", key };
    }
    return { kind: "move", cell: reach };
  }

  return { kind: "cancel" };
}
