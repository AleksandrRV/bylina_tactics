/**
 * День 11 (0.21.10, P1-1 часть 1): ревизия боевого состояния через сессию.
 *
 * Сессия отдаёт монотонный номер боя (`getBattleRevision`), отражающий
 * ревизию ведущего ядра: растёт при зафиксированных изменениях и не двигается
 * на запросах предпросмотра (architecture §3.7). `subscribeBattle` уведомляет
 * подписчика об изменении.
 */
import { describe, expect, it } from "vitest";
import { createTacticsKernel, type EntityState, type MatchState, type WeaponStats } from "@bylina/core";
import { createSession } from "../src/index.js";

const sword: WeaponStats = {
  id: "sword",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 20,
  maxDmg: 20,
  crit: 0,
  critBonus: 0,
  envDmg: 0,
};

function unit(id: number, owner: number, x: number): EntityState {
  return {
    id,
    configId: "bogatyr",
    owner,
    x,
    y: 2,
    z: 1,
    dir: owner === 1 ? 1 : 3,
    ap: 2,
    maxAp: 2,
    mobility: 5,
    hp: 12,
    maxHp: 12,
    aim: 100,
    defense: 0,
    will: 40,
    vision: 12,
    weaponId: "sword",
    weaponIds: ["sword"],
    skillIds: [],
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
  };
}

function battleSession() {
  const match: MatchState = {
    turnNumber: 1,
    activeOwner: 1,
    grid: {
      width: 8,
      height: 6,
      tiles: Array.from({ length: 48 }, (_, i) => ({
        x: i % 8,
        y: Math.floor(i / 8),
        z: 1,
        pit: false,
        blockLOS: false,
      })),
    },
    entities: [unit(1, 1, 3), unit(11, 2, 4)],
  };
  const session = createSession("menu");
  // applyBattleCommand принимает команды только на боевом экране; переходим
  // в бой так же, как это делает приложение после привязки ведущего.
  session.goTo("battle");
  const host = createTacticsKernel({ initial: match, weapons: { sword }, skills: {}, seed: 123 });
  session.bindTacticsHost(host);
  return { session, host };
}

describe("getBattleRevision / subscribeBattle", () => {
  it("до привязки боя ревизия равна 0", () => {
    const session = createSession("menu");
    expect(session.getBattleRevision()).toBe(0);
  });

  it("отражает ревизию ядра и растёт на успешной команде", () => {
    const { session } = battleSession();
    expect(session.getBattleRevision()).toBe(session.getBattleRevision());
    const before = session.getBattleRevision();
    expect(session.applyBattleCommand({ type: "END_TURN", playerId: "1" }).ok).toBe(true);
    expect(session.getBattleRevision()).toBe(before + 1);
  });

  it("не растёт на запросах предпросмотра", () => {
    const { session } = battleSession();
    const before = session.getBattleRevision();
    session.getBattleHitPreview(1, 11, "sword");
    session.getBattleReachable(1);
    session.getBattlePath(1, { x: 3, y: 3, z: 1 });
    session.getBattleSnapshot(1);
    session.getBattleVisible(1);
    session.getBattleExplored(1);
    expect(session.getBattleRevision()).toBe(before);
  });

  it("subscribeBattle уведомляет об изменении и отписывается", () => {
    const { session } = battleSession();
    let ticks = 0;
    const unlisten = session.subscribeBattle(() => {
      ticks += 1;
    });
    session.applyBattleCommand({ type: "DEFEND", actorId: 1 });
    expect(ticks).toBe(1);
    expect(session.getBattleRevision()).toBeGreaterThan(0);
    unlisten();
    session.applyBattleCommand({ type: "END_TURN", playerId: "1" });
    expect(ticks).toBe(1);
  });
});
