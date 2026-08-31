/**
 * Карта клавиш боевого экрана (0.20.59).
 *
 * Прежде решения по клавишам жили внутри эффекта экрана боя — сто тридцать
 * строк посреди компонента на три тысячи. Здесь осталась только логика
 * «какая клавиша что значит»; состояние по-прежнему принадлежит экрану и
 * приходит через `BattleKeyActions`. Благодаря этому карта проверяется
 * без монтирования React: тест передаёт контекст и смотрит, какие действия
 * вызваны.
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

/** Что карта клавиш может сделать с экраном боя. */
export interface BattleKeyActions {
  /** Отпустить кадр сцены. */
  skipCutscene: () => void;
  togglePause: () => void;
  /** Выбрать бойца; прицеливание и маршрут снимаются, обзор клетки — нет. */
  select: (id: number) => void;
  defend: () => void;
  overwatch: () => void;
  /** Применить умение на себя. */
  applySelfSkill: (skillId: string) => void;
  /** Подсветить круговое умение: первый тап готовит, второй применяет. */
  armSkill: (entry: SelectableAction) => void;
  /** Выбрать или снять действие (оружие, умение по цели). */
  toggleAction: (entry: SelectableAction) => void;
  /** Снять прицеливание, маршрут пути и рывок. */
  cancel: () => void;
  pan: (dx: number, dy: number) => void;
}

/** Шаг прокрутки поля стрелками и WASD, в пикселях. */
const PAN_STEP = 28;

/**
 * Разобрать нажатие. Возвращает `true`, если клавиша обработана и её
 * действие по умолчанию подавлено.
 */
export function handleBattleKey(event: KeyboardEvent, ctx: BattleKeyContext, actions: BattleKeyActions): boolean {
  // Пропуск сцены — раньше прочих обработчиков (campaign.md §1.8):
  // во время сцены ввод игрока закрыт, но кадр всегда можно отпустить.
  if (ctx.cutscenePlaying && (event.key === "Escape" || event.key === " " || event.key === "Enter")) {
    event.preventDefault();
    actions.skipCutscene();
    return true;
  }
  if (event.key === "Escape") {
    actions.togglePause();
    return true;
  }
  if (ctx.paused || ctx.busy || ctx.outcomePending) return false;

  const selected = ctx.selected;
  const ownTurn = ctx.snapshot.activeOwner === ctx.viewOwner;
  const canAct = ctx.selectedId !== null && selected !== null && selected.ap > 0 && ownTurn;
  // Обучение: действие допустимо, только если его предписал сценарий этому
  // исполнителю (строгий сценарий, 0.20.13).
  const actorAllowed = !ctx.isTraining || ctx.trainingActorId === ctx.selectedId;

  if (event.key === "Tab") {
    event.preventDefault();
    // Обучение: перебор бойцов запрещён — действует исполнитель указания.
    if (ctx.isTraining && ctx.trainingActorId !== null) return true;
    // Порядок перебора — в battle-selection: сначала бойцы с очками
    // действия, затем остальные свои.
    const next = nextFighterId(ctx.snapshot.entities, ctx.side, ctx.selectedId);
    if (next !== null) actions.select(next);
    return true;
  }

  if (event.key === "9" && canAct && ctx.trainingAllows("defend") && actorAllowed) {
    actions.defend();
    return true;
  }
  if (event.key === "0" && canAct && ctx.trainingAllows("overwatch") && actorAllowed) {
    actions.overwatch();
    return true;
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
      if (!allowed) return true;
    }
    if (!chosen) return true;
    if (chosen.type === "skill") {
      const skill = ctx.skills[chosen.id];
      const cooldown = selected.skillCooldowns?.[chosen.id] ?? 0;
      const uses = selected.skillUses?.[chosen.id] ?? 0;
      if (cooldown > 0 || (skill?.maxUsesPerBattle !== undefined && uses >= skill.maxUsesPerBattle)) return true;
    }
    if (chosen.type === "skill" && ctx.skills[chosen.id]?.category === "self") {
      // Self-умение с областью (круговой взмах) на хоткей работает как
      // кнопка: первый тап подсвечивает, второй применяет.
      const hotkeySkill = ctx.skills[chosen.id];
      const armed = ctx.action?.type === "skill" && ctx.action.id === chosen.id;
      if ((hotkeySkill?.radius ?? 0) > 0 && armed) {
        actions.applySelfSkill(chosen.id);
      } else if ((hotkeySkill?.radius ?? 0) > 0) {
        actions.armSkill(chosen);
      } else {
        actions.applySelfSkill(chosen.id);
      }
      return true;
    }
    actions.toggleAction(chosen);
    return true;
  }

  if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") actions.pan(PAN_STEP, 0);
  if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") actions.pan(-PAN_STEP, 0);
  if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") actions.pan(0, PAN_STEP);
  if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") actions.pan(0, -PAN_STEP);
  return false;
}
