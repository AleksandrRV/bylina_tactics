/**
 * Кого экран боя считает своим бойцом и кого выбирает (0.20.60).
 *
 * Прежде правило «свой боец» было записано дважды: перебор по Tab — внутри
 * карты клавиш, выбор на начало хода — в отдельном эффекте экрана. Две
 * записи одного правила расходятся при первой же правке, поэтому они
 * собраны здесь и проверяются без React.
 *
 * Модуль знает только о данных матча: кому принадлежит боец, жив ли он,
 * есть ли очки действия. Экран решает, когда вызывать, — здесь лишь ответ
 * на вопрос «кого».
 */

import type { EntityState } from "@bylina/core";

/** С чьей стороны смотрит экран боя. */
export interface BattleSide {
  /** Владелец, которым управляет игрок за этим экраном. */
  viewOwner: number;
  /** Наблюдатель сетевого боя: своих бойцов у него нет. */
  isSpectator: boolean;
  /** Повтор: управлять нельзя. */
  isReplay: boolean;
}

/**
 * Боец, которым можно управлять (0.20.45): живой, не декорация поля
 * (укрытие, знамя), наш и подвижный. Увязший в трясине Федот с `maxAp 0`
 * в число своих не входит — управлять им нельзя.
 */
export function isOwnFighter(entity: EntityState, side: BattleSide): boolean {
  return (
    !side.isSpectator &&
    !side.isReplay &&
    !entity.dead &&
    entity.coverType === 0 &&
    entity.owner === side.viewOwner &&
    entity.maxAp > 0
  );
}

/**
 * Бойцы, доступные перебору: сначала те, у кого есть очки действия, затем
 * все остальные — так Tab не застревает на отходившем бойце, пока есть
 * способные действовать.
 */
export function cyclableFighters(entities: EntityState[], side: BattleSide): EntityState[] {
  const own = entities.filter((entity) => isOwnFighter(entity, side));
  const withAp = own.filter((entity) => entity.ap > 0);
  return withAp.length > 0 ? withAp : own;
}

/**
 * Следующий боец по кругу после `selectedId`. Возвращает `null`, если
 * перебирать некого (наблюдатель, повтор, все мертвы) — в этом случае
 * выбор остаётся прежним.
 */
export function nextFighterId(entities: EntityState[], side: BattleSide, selectedId: number | null): number | null {
  const pool = cyclableFighters(entities, side);
  if (pool.length === 0) return null;
  const index = pool.findIndex((entity) => entity.id === selectedId);
  return pool[(index + 1) % pool.length]?.id ?? null;
}

/** Условия выбора на начало хода: сторона плюс обучение. */
export interface FirstFighterOptions extends BattleSide {
  isTraining: boolean;
  /** Исполнитель активного указания обучения, если оно закрепляет бойца. */
  trainingActorId: number | null;
}

/**
 * Кого выбрать на начало хода: в обучении — исполнитель указания (строгий
 * сценарий, 0.20.13), иначе первый свой боец. Если исполнитель указания уже
 * не на поле, выбор падает на первого своего — пустой выбор оставил бы
 * экран без бойца посреди урока.
 */
/**
 * Ближайший в списке свой боец с оставшимися очками действия (0.21.36).
 * Если выбранный уже имеет ОД — он и есть ответ; иначе первый в порядке
 * высадки, у кого ещё есть очки. Нужен кнопке «Нет» в подтверждении конца хода.
 */
export function firstFighterWithAp(
  entities: EntityState[],
  side: BattleSide,
  selectedId: number | null,
): number | null {
  const withAp = entities.filter((entity) => isOwnFighter(entity, side) && entity.ap > 0);
  if (withAp.some((entity) => entity.id === selectedId)) return selectedId;
  return withAp[0]?.id ?? null;
}

export function firstFighterId(entities: EntityState[], options: FirstFighterOptions): number | null {
  if (options.isTraining && options.trainingActorId !== null) {
    const actor = entities.find((entity) => entity.id === options.trainingActorId);
    if (actor) return actor.id;
  }
  return entities.find((entity) => isOwnFighter(entity, options))?.id ?? null;
}
