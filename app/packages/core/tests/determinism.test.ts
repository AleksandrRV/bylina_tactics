/**
 * День 10 (0.21.9, P1-4 часть 2): системная защита детерминизма ядра
 * (Critical-2).
 *
 * Снимок партии и журнал команд обязаны полностью воспроизводить бой:
 * одинаковые начальное состояние и seed при одной и той же последовательности
 * команд дают идентичный конечный снимок — включая состояние ГПСЧ,
 * позицию/уроны/перезарядки. Property-based тест гоняет случайную политику
 * ходов через ядро, записывает только реально принятые команды, а затем
 * воспроизводит их на свежем ядре с тем же seed и сверяет снимок после каждой
 * команды. Любой недетерминированный источник (Date.now, Math.random вне
 * ГПСЧ, порядок ключей) рассинхронизировал бы снимки.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createTacticsKernel, type TacticsKernel } from "../src/kernel.js";
import { createQuickMatch } from "../src/match.js";
import type { Command, MatchState } from "../src/types.js";

/** Mulberry32 на сервисном seed политики — отдельный от боевого ГПСЧ. */
function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Один случайный ход из легальных вариантов текущего активного владельца. */
function pickCommand(kernel: TacticsKernel, rand: () => number): Command | null {
  const snap = kernel.getSnapshot();
  const active = snap.entities.filter(
    (entity) => entity.owner === snap.activeOwner && !entity.dead && entity.coverType === 0,
  );
  const options: Command[] = [];
  for (const unit of active) {
    // Перемещения в достижимые клетки — заведомо легальны.
    for (const cell of kernel.getReachable(unit.id)) {
      options.push({ type: "MOVE", actorId: unit.id, to: { x: cell.x, y: cell.y, z: cell.z } });
    }
    // Атаки: применимость (дальность/ЛОС) проверит ядро при apply.
    const weapons = unit.weaponIds ?? [unit.weaponId];
    const enemies = snap.entities.filter((entity) => entity.owner !== unit.owner && !entity.dead);
    for (const weapon of weapons) {
      for (const target of enemies) {
        options.push({ type: "ATTACK", actorId: unit.id, targetId: target.id, weaponId: weapon });
      }
    }
    options.push({ type: "DEFEND", actorId: unit.id });
  }
  options.push({ type: "END_TURN", playerId: String(snap.activeOwner) });
  if (options.length === 0) return null;
  return options[Math.floor(rand() * options.length)] ?? null;
}

/** Прогнать случайную политику; вернуть принятые команды и снимки после них.
 * Непринятые команды перевыбираются (до 8 попыток за ход), чтобы накопить
 * достаточно реальных действий; END_TURN всегда легален и двигает партию. */
function runPolicy(
  matchSeed: number,
  policySeed: number,
  steps: number,
): { commands: Command[]; snapshots: MatchState[] } {
  const initial = createQuickMatch({ enemyCount: 2, seed: matchSeed });
  const kernel = createTacticsKernel({ initial, seed: matchSeed });
  const rand = makeRand(policySeed);
  const commands: Command[] = [];
  const snapshots: MatchState[] = [];
  for (let i = 0; i < steps; i++) {
    let accepted = false;
    for (let attempt = 0; attempt < 8 && !accepted; attempt++) {
      const command = pickCommand(kernel, rand);
      if (!command) break;
      const result = kernel.apply(command);
      if (!result.ok) continue;
      commands.push(command);
      snapshots.push(structuredClone(kernel.getSnapshot()));
      accepted = true;
    }
  }
  return { commands, snapshots };
}

describe("детерминизм ядра (property-based)", () => {
  it("одинаковые seed и последовательность команд дают идентичные снимки", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 31 - 1 }),
        fc.integer({ min: 1, max: 2 ** 31 - 1 }),
        fc.integer({ min: 1, max: 30 }),
        (matchSeed, policySeed, steps) => {
          const { commands, snapshots } = runPolicy(matchSeed, policySeed, steps);
          // Воспроизведение на совершенно свежем ядре с тем же seed.
          const initial = createQuickMatch({ enemyCount: 2, seed: matchSeed });
          const replay = createTacticsKernel({ initial, seed: matchSeed });
          expect(commands.length).toBe(snapshots.length);
          commands.forEach((command, index) => {
            const result = replay.apply(command);
            expect(result.ok, `команда ${index} (${command.type}) должна быть принята при воспроизведении`).toBe(true);
            expect(replay.getSnapshot(), `снимок разошёлся после команды ${index} (${command.type})`).toEqual(
              snapshots[index],
            );
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  it("два независимых прогона случайной политики идентичны", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 31 - 1 }),
        fc.integer({ min: 1, max: 2 ** 31 - 1 }),
        fc.integer({ min: 1, max: 20 }),
        (matchSeed, policySeed, steps) => {
          const first = runPolicy(matchSeed, policySeed, steps);
          const second = runPolicy(matchSeed, policySeed, steps);
          expect(second.commands).toEqual(first.commands);
          expect(second.snapshots).toEqual(first.snapshots);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("контрольный прогон на фиксированных seed воспроизводится до конца боя", () => {
    const { commands, snapshots } = runPolicy(20260901, 777, 40);
    expect(commands.length).toBeGreaterThan(10);
    const initial = createQuickMatch({ enemyCount: 2, seed: 20260901 });
    const replay = createTacticsKernel({ initial, seed: 20260901 });
    for (const command of commands) {
      const result = replay.apply(command);
      expect(result.ok).toBe(true);
    }
    expect(replay.getSnapshot()).toEqual(snapshots[snapshots.length - 1]);
  });
});
