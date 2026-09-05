/**
 * Отбор бойцов экрана боя (0.20.60): кого считать своим, кого выбрать
 * следующим по Tab, кого — на начало хода. Правила прежде жили в двух
 * местах (карта клавиш и эффект хода) и нигде не проверялись напрямую.
 */

import { describe, expect, it } from "vitest";
import type { EntityState } from "@bylina/core";
import {
  cyclableFighters,
  firstFighterId,
  firstFighterWithAp,
  isOwnFighter,
  nextFighterId,
  type BattleSide,
  type FirstFighterOptions,
} from "../src/battle-selection.js";

const side: BattleSide = { viewOwner: 1, isSpectator: false, isReplay: false };
/** Обычный бой: указания обучения нет, исполнитель не закреплён. */
const plain: FirstFighterOptions = { ...side, isTraining: false, trainingActorId: null };

/** Боец: ровно те поля, которые читает отбор. */
function fighter(id: number, overrides: Record<string, unknown> = {}): EntityState {
  return {
    id,
    owner: 1,
    ap: 2,
    maxAp: 2,
    dead: false,
    coverType: 0,
    ...overrides,
  } as unknown as EntityState;
}

describe("battle selection (0.20.60)", () => {
  it("counts a fighter as own only when he is alive, ours and able to move", () => {
    expect(isOwnFighter(fighter(1), side), "обычный боец").toBe(true);
    expect(isOwnFighter(fighter(1, { dead: true }), side), "мёртвый").toBe(false);
    expect(isOwnFighter(fighter(1, { coverType: 1 }), side), "укрытие, а не боец").toBe(false);
    expect(isOwnFighter(fighter(1, { owner: 2 }), side), "чужой").toBe(false);
    expect(isOwnFighter(fighter(1, { maxAp: 0 }), side), "неподвижный (Федот в трясине)").toBe(false);

    const spectator: BattleSide = { ...side, isSpectator: true };
    expect(isOwnFighter(fighter(1), spectator), "наблюдатель управлять не может").toBe(false);
    const replay: BattleSide = { ...side, isReplay: true };
    expect(isOwnFighter(fighter(1), replay), "повтор управлять не может").toBe(false);
  });

  it("cycles fighters with action points first", () => {
    const fresh = fighter(1, { ap: 2 });
    const spent = fighter(2, { ap: 0 });
    const foe = fighter(3, { owner: 2 });
    expect(cyclableFighters([fresh, spent, foe], side).map((entity) => entity.id)).toEqual([1]);

    // Отошедшие остаются в переборе, если способных действовать не осталось.
    const allSpent = [fighter(1, { ap: 0 }), fighter(2, { ap: 0 }), foe];
    expect(cyclableFighters(allSpent, side).map((entity) => entity.id)).toEqual([1, 2]);
  });

  it("moves the selection in a circle", () => {
    const pool = [fighter(1), fighter(2), fighter(3, { ap: 0 })];
    expect(nextFighterId(pool, side, 1), "вперёд").toBe(2);
    expect(nextFighterId(pool, side, 2), "с последнего на первый").toBe(1);
    expect(nextFighterId([fighter(1)], side, 1), "один боец — он же").toBe(1);
    expect(nextFighterId([fighter(1)], side, 9), "чужой выбор — первый свой").toBe(1);
    expect(nextFighterId([fighter(1, { owner: 2 })], side, 1), "своих нет").toBeNull();
  });

  it("picks the training actor at the start of a turn", () => {
    const hero = fighter(1);
    const second = fighter(2);
    // Обучение: выбран исполнитель указания, а не первый по списку (0.20.13).
    expect(firstFighterId([hero, second], { ...side, isTraining: true, trainingActorId: 2 })).toBe(2);
    expect(firstFighterId([hero, second], { ...side, isTraining: true, trainingActorId: null })).toBe(1);
    // Исполнитель ушёл с поля — урок не должен остаться без выбранного бойца.
    expect(firstFighterId([hero], { ...side, isTraining: true, trainingActorId: 7 })).toBe(1);
    // Обычный бой: первый свой, чужие и укрытия пропускаются.
    expect(firstFighterId([fighter(3, { coverType: 2 }), fighter(4, { owner: 2 }), hero], plain)).toBe(1);
    expect(firstFighterId([fighter(1, { owner: 2 })], plain), "своих нет").toBeNull();
  });

  it("picks the nearest fighter with remaining AP when ending the turn is cancelled", () => {
    const spent = fighter(1, { ap: 0 });
    const ready = fighter(2, { ap: 1 });
    const later = fighter(3, { ap: 2 });
    expect(firstFighterWithAp([spent, ready, later], side, 1), "с отходившего — на ближайшего с ОД").toBe(2);
    expect(firstFighterWithAp([spent, ready, later], side, 2), "выбранный уже с ОД").toBe(2);
    expect(firstFighterWithAp([spent], side, 1), "ни у кого нет ОД").toBeNull();
  });
});
