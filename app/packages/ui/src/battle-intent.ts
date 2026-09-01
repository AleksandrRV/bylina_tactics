/**
 * Намерение игрока на экране боя — один объект вместо семи useState
 * (0.21.15, день 16, P1-2 часть 1).
 *
 * Прежде экран держал выбор и прицеливание в семи отдельных состояниях:
 * `selectedId`, `action`, `aimId`, `skillTargetPos`, `charge`,
 * `chargeArmed`, `preview`. Любая правка обработчиков меняла их по
 * отдельности, и запрещённые сочетания («прицеливание без выбранного
 * бойца», «заряженный рывок без плана») ничем не охранялись — их можно
 * было собрать неудачной последовательностью вызовов сеттеров.
 *
 * Здесь намерение — размеченное объединение, где недостижимые сочетания
 * не выразимы в типах, а переходы между фазами считает чистая
 * `nextIntent(intent, event)`: тот же приём, что в `battle-selection.ts` и
 * `battle-cell-click.ts` — логика проверяется без React и без поля.
 *
 * Экран (день 17) хранит один `useState<Intent>` и читает прежние семь
 * значений производными; этот день модуль самодостаточен.
 */

import type { CellPos } from "@bylina/core";
import type { SelectableAction } from "./action-shortcuts.js";
import type { ChargePlan } from "./charge-attack.js";

/**
 * Замысел игрока в текущий момент.
 *
 * Фазы соответствуют тому, что игрок реально может делать:
 */
export type Intent =
  /** Ничего не выбрано: панель бойца закрыта, прицела нет. */
  | { kind: "idle" }
  /** Боец выбран, но действие (оружие/умение/стойка) не выбрано. */
  | { kind: "selected"; actorId: number }
  /**
   * Выбран боец и действие; цель ещё не названа (для умения по площади
   * цель может быть клеткой, а не бойцом).
   */
  | {
      kind: "aiming";
      actorId: number;
      action: SelectableAction;
      /** Прицеленная цель-боец; для умения по клетке её может не быть. */
      targetId: number | null;
      /** Клетка постановки умения по площади; иначе `null`. */
      targetPos: CellPos | null;
      /**
       * Предпросмотр шага: ключ достижимой клетки (`"x,y"`), путь к
       * которой показан наведением или первым нажатием на сенсоре.
       */
      preview: string | null;
    }
  /**
   * Рывок: цель названа и показан план подхода с ударом (0.20.50).
   * План есть всегда — «заряженный рывок без плана» невыразим;
   * `armed` различает наведение (показано мышью, снимается уводом) и
   * подтверждение первым нажатием (следующее нажатие исполняет).
   */
  | {
      kind: "charging";
      actorId: number;
      action: SelectableAction;
      targetId: number;
      plan: ChargePlan;
      /** Наведение мыши (`false`) — предварительно; нажатие (`true`) —
       * подтверждено, следующее нажатие по цели исполняет рывок. */
      armed: boolean;
    }
  /**
   * Выбран боец, действие не выбрано, но показан предпросмотр шага на
   * достижимую клетку (наведение мыши на клетке без оружия).
   */
  | { kind: "placing"; actorId: number; preview: string };

/** События ввода, переводящие намерение из фазы в фазу. */
export type IntentEvent =
  | { type: "reset" }
  /** Выбрать бойца (клик по своему бойцу, Tab, начало хода). */
  | { type: "select"; actorId: number }
  /** Снять выбор (гибель выбранного, смена хода без выбора). */
  | { type: "clearSelection" }
  /**
   * Вооружиться действием (авто-оружие по врагу): цель может быть уже
   * названа, а может прийти позже событием aim — тогда `targetId: null`.
   */
  | { type: "armAction"; action: SelectableAction; targetId: number | null }
  /** Включить или выключить действие без цели (панель оружия/умений/стойки). */
  | { type: "toggleAction"; actorId: number; action: SelectableAction | null }
  /**
   * Прицелиться: цель-боец названа; при рывке `plan` несёт подход с
   * ударом, `armed` — подтверждено ли нажатием (мышиное наведение
   * приходит с `armed: false`).
   */
  | {
      type: "aim";
      targetId: number;
      chargePlan: ChargePlan | null;
      armed: boolean;
      /** Клетка постановки умения по площади; сбрасывается, если действие —
       * не умение с переносом (экран решает, что передать). */
      targetPos: CellPos | null;
    }
  /** Поставить умение по площади на клетку. */
  | { type: "positionSkill"; pos: CellPos }
  /** Показать предпросмотр шага на достижимую клетку (наведение/тап). */
  | { type: "previewMove"; key: string }
  /** Снять прицел и предпросмотр (нажатие «отмена», уход мыши с клетки). */
  | { type: "cancel" }
  /** Увести мышь: неподтверждённый (наведённый) рывок снимается. */
  | { type: "hoverLeave" };

/** Начальное намерение экрана. */
export const IDLE_INTENT: Intent = { kind: "idle" };

/**
 * Следующее намерение по событию ввода. Чистая функция: ни React, ни
 * боевого состояния — только фазы намерения. Запрещённые сочетания
 * невозможны по построению: цель без бойца и зарядка без плана в типах
 * не существуют.
 */
export function nextIntent(intent: Intent, event: IntentEvent): Intent {
  switch (event.type) {
    case "reset":
    case "clearSelection":
      return IDLE_INTENT;

    case "select":
      return { kind: "selected", actorId: event.actorId };

    case "toggleAction":
      if (event.action === null) {
        // Действие выключено: остаётся выбранный боец (или покой).
        return intent.kind === "idle" ? intent : { kind: "selected", actorId: intentActorId(intent) };
      }
      // Включить действие можно только при выбранном бойце.
      if (intent.kind === "idle") return intent;
      return {
        kind: "aiming",
        actorId: intentActorId(intent),
        action: event.action,
        targetId: null,
        targetPos: null,
        preview: null,
      };

    case "armAction":
      if (intent.kind === "idle") return intent;
      return {
        kind: "aiming",
        actorId: intentActorId(intent),
        action: event.action,
        targetId: event.targetId,
        targetPos: null,
        preview: null,
      };

    case "aim": {
      if (intent.kind === "idle") return intent;
      const actorId = intentActorId(intent);
      // Рывок: план обязателен, фаза заряда хранит и прицел, и подход.
      if (event.chargePlan) {
        return {
          kind: "charging",
          actorId,
          action: aimAction(intent),
          targetId: event.targetId,
          plan: event.chargePlan,
          armed: event.armed,
        };
      }
      // Обычное прицеливание: действие сохраняется (авто-оружие ставит
      // его в armAction; сюда цель приходит уже при действии).
      const action = aimAction(intent);
      return {
        kind: "aiming",
        actorId,
        action,
        targetId: event.targetId,
        targetPos: event.targetPos,
        preview: null,
      };
    }

    case "positionSkill":
      // Клетку постановки имеет смысл запоминать только в фазе прицела.
      if (intent.kind !== "aiming") return intent;
      return { ...intent, targetPos: event.pos, preview: null };

    case "previewMove":
      if (intent.kind === "idle") return intent;
      // Предпросмотр шага живёт в placing без действия либо в aiming с
      // ещё не названной целью; при заряженном рывке тап по клетке не
      // сбивает подтверждённый замысел.
      if (intent.kind === "charging") return intent;
      if (intent.kind === "selected" || intent.kind === "placing") {
        return { kind: "placing", actorId: intent.actorId, preview: event.key };
      }
      return { ...intent, preview: event.key, targetId: null };

    case "cancel":
      // Отмена снимает прицел и предпросмотр, но не выбор бойца:
      // боец остаётся выбранным без действия.
      if (intent.kind === "idle") return intent;
      return { kind: "selected", actorId: intentActorId(intent) };

    case "hoverLeave":
      // Увод мыши снимает только неподтверждённый рывок, показанный
      // самим наведением; цель, выбранную нажатием, наведение не трогает.
      if (intent.kind === "charging" && !intent.armed) {
        return {
          kind: "aiming",
          actorId: intent.actorId,
          action: intent.action,
          targetId: intent.targetId,
          targetPos: null,
          preview: null,
        };
      }
      return intent;
  }
}

/** Выбранный боец для любой не-idle фазы. */
function intentActorId(intent: Exclude<Intent, { kind: "idle" }>): number {
  return intent.actorId;
}

/** Действие фазы прицеливания/рывка; вне прицела — то, что вооружили. */
function aimAction(intent: Intent): SelectableAction {
  if (intent.kind === "aiming" || intent.kind === "charging") return intent.action;
  // До оружия прицелиться нельзя: событие aim приходит после armAction
  // либо от рывка с уже выбранным действием. Запасное значение
  // недостижимо в легальных переходах — его страхует экран (он не шлёт
  // aim без действия), но тип требует полноты.
  return { type: "weapon", id: "" };
}
