/**
 * Карта клавиш боевого экрана (0.20.59; намерения — 0.20.65).
 *
 * Прежде решения по клавишам жили внутри эффекта экрана боя — сто тридцать
 * строк посреди компонента на три тысячи. Здесь осталась только логика
 * «какая клавиша что значит»; состояние по-прежнему принадлежит экрану.
 *
 * Форма та же, что у разбора нажатия по полю и у канала команд: чистая
 * функция отдаёт намерение, экран его исполняет. Благодаря этому карта
 * проверяется без React: тест передаёт состояние боя и сравнивает намерение.
 */

import type { EntityState, MatchState, SkillStats } from "@bylina/core";
import { ACTION_SHORTCUTS, selectableActions, type SelectableAction } from "./action-shortcuts.js";
import { nextFighterId, type BattleSide } from "./battle-selection.js";
import type { TrainingActionKind, TrainingDirective } from "./training-scenario.js";

/** Состояние боя, нужное карте клавиш. */
export interface BattleKeyContext {
  paused: boolean;
  /** Идёт анимация событий: ввод закрыт. */
  busy: boolean;
  /** Показывается итог боя: ввод закрыт. */
  outcomePending: boolean;
  cutscenePlaying: boolean;
  isTraining: boolean;
  /** Исполнитель текущего указания обучения: перебор бойцов запрещён. */
  trainingActorId: number | null;
  trainingDirective: TrainingDirective | null;
  trainingAllows: (action: TrainingActionKind) => boolean;
  selectedId: number | null;
  selected: EntityState | null;
  action: SelectableAction | null;
  skills: Record<string, SkillStats>;
  snapshot: MatchState;
  viewOwner: number;
  /** С чьей стороны смотрит экран: по ней считаются свои бойцы. */
  side: BattleSide;
}

/** Что значит нажатие клавиши. */
export type BattleKeyIntent =
  /** Клавиша не принадлежит экрану боя. */
  | { kind: "none" }
  /** Отпустить кадр сцены (campaign.md §1.8). */
  | { kind: "skipCutscene" }
  /** Поставить или снять паузу. */
  | { kind: "togglePause" }
  /** Выбрать бойца; прицеливание снимается, обзор клетки — нет. */
  | { kind: "select"; id: number }
  /** Защитная стойка выбранным бойцом. */
  | { kind: "defend"; actorId: number }
  /** Дозор выбранным бойцом. */
  | { kind: "overwatch"; actorId: number }
  /** Применить умение на себя. */
  | { kind: "applySelfSkill"; skillId: string }
  /** Подсветить круговое умение: первый тап готовит, второй применяет. */
  | { kind: "armSkill"; entry: SelectableAction }
  /** Выбрать или снять действие (оружие, умение по цели). */
  | { kind: "toggleAction"; entry: SelectableAction }
  /** Прокрутить поле. */
  | { kind: "pan"; dx: number; dy: number };

/** Шаг прокрутки поля стрелками и WASD, в пикселях. */
const PAN_STEP = 28;

/**
 * Разобрать нажатие. Порядок проверок прежний: пропуск сцены раньше прочих
 * клавиш, затем пауза, затем перебор бойцов, стойки и действия по цифрам.
 * Клавиши, у которых есть действие по умолчанию в обозревателе (пробел,
 * ввод, Tab), помечаются подавлением.
 */
export function resolveBattleKey(event: KeyboardEvent, ctx: BattleKeyContext): BattleKeyIntent {
  // Пропуск сцены — раньше прочих обработчиков (campaign.md §1.8):
  // во время сцены ввод игрока закрыт, но кадр всегда можно отпустить.
  if (ctx.cutscenePlaying && (event.key === "Escape" || event.key === " " || event.key === "Enter")) {
    event.preventDefault();
    return { kind: "skipCutscene" };
  }
  if (event.key === "Escape") return { kind: "togglePause" };
  if (ctx.paused || ctx.busy || ctx.outcomePending) return { kind: "none" };

  const selected = ctx.selected;
  const actorId = ctx.selectedId;
  const ownTurn = ctx.snapshot.activeOwner === ctx.viewOwner;
  // Обучение: действие допустимо, только если его предписал сценарий этому
  // исполнителю (строгий сценарий, 0.20.13).
  const actorAllowed = !ctx.isTraining || ctx.trainingActorId === actorId;

  if (event.key === "Tab") {
    event.preventDefault();
    // Обучение: перебор бойцов запрещён — действует исполнитель указания.
    if (ctx.isTraining && ctx.trainingActorId !== null) return { kind: "none" };
    // Порядок перебора — в battle-selection: сначала бойцы с очками
    // действия, затем остальные свои.
    const next = nextFighterId(ctx.snapshot.entities, ctx.side, ctx.selectedId);
    return next === null ? { kind: "none" } : { kind: "select", id: next };
  }

  // Стойки: боец выбран, способен действовать и не чужой ход.
  const canAct = actorId !== null && selected !== null && selected.ap > 0 && ownTurn;
  if ((event.key === "9" || event.key === "0") && canAct && actorAllowed) {
    if (event.key === "9" && ctx.trainingAllows("defend")) return { kind: "defend", actorId };
    if (ctx.trainingAllows("overwatch")) return { kind: "overwatch", actorId };
  }

  if (ACTION_SHORTCUTS.includes(event.key as (typeof ACTION_SHORTCUTS)[number]) && selected) {
    const index = Number(event.key) - 1;
    const chosen = selectableActions(selected)[index];
    // Обучение: клавиша допустима, только если её действие предписано
    // указанием — точное совпадение оружия или умения.
    if (ctx.isTraining) {
      const directive = ctx.trainingDirective;
      const allowed =
        directive !== null &&
        ((chosen?.type === "weapon" &&
          directive.kind === "attack" &&
          directive.actorId === ctx.selectedId &&
          directive.weaponId === chosen.id) ||
          (chosen?.type === "skill" &&
            directive.kind === "skill" &&
            directive.actorId === ctx.selectedId &&
            directive.skillId === chosen.id));
      if (!allowed) return { kind: "none" };
    }
    if (!chosen) return { kind: "none" };
    if (chosen.type === "skill") {
      const skill = ctx.skills[chosen.id];
      const cooldown = selected.skillCooldowns?.[chosen.id] ?? 0;
      const uses = selected.skillUses?.[chosen.id] ?? 0;
      if (cooldown > 0 || (skill?.maxUsesPerBattle !== undefined && uses >= skill.maxUsesPerBattle)) {
        return { kind: "none" };
      }
    }
    if (chosen.type === "skill" && ctx.skills[chosen.id]?.category === "self") {
      // Self-умение с областью (круговой взмах) на хоткей работает как
      // кнопка: первый тап подсвечивает, второй применяет.
      const hotkeySkill = ctx.skills[chosen.id];
      const armed = ctx.action?.type === "skill" && ctx.action.id === chosen.id;
      if ((hotkeySkill?.radius ?? 0) > 0 && armed) return { kind: "applySelfSkill", skillId: chosen.id };
      if ((hotkeySkill?.radius ?? 0) > 0) return { kind: "armSkill", entry: chosen };
      return { kind: "applySelfSkill", skillId: chosen.id };
    }
    return { kind: "toggleAction", entry: chosen };
  }

  if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") return { kind: "pan", dx: PAN_STEP, dy: 0 };
  if (event.key === "ArrowRight" || event.key === "d" || event.key === "D")
    return { kind: "pan", dx: -PAN_STEP, dy: 0 };
  if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") return { kind: "pan", dx: 0, dy: PAN_STEP };
  if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") return { kind: "pan", dx: 0, dy: -PAN_STEP };
  return { kind: "none" };
}
