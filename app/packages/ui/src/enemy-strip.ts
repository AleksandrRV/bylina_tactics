import type { EntityState } from "@bylina/core";

/**
 * Полоса противников в верхней панели боя (0.20.42).
 *
 * Снимок стороны отдаёт только тех чужих бойцов, которых дружина видит
 * сейчас (math §8.3): противник, вышедший из поля зрения, просто исчезает.
 * Игрок из-за этого теряет счёт врагам — «вроде было шесть крыс, а в полосе
 * две». Полоса запоминает всех, кто попадался: видимый сейчас противник
 * ярок и ведёт камеру кликом, ушедший из вида — приглушён и не кликается.
 *
 * Логика вынесена из компонента: её можно покрыть тестом без jsdom.
 */

interface EnemyStripEntry {
  id: number;
  configId: string;
  /** Противник погиб (портрет остаётся в полосе зачёркнутым). */
  dead: boolean;
  /** Противник в поле зрения дружины прямо сейчас. */
  seen: boolean;
}

/** Что запомнили о противнике, когда он был виден. */
export interface RememberedEnemy {
  configId: string;
  dead: boolean;
}

/** Запомнить противников, видимых сейчас: id → запись. */
export function rememberEnemies(
  known: readonly EntityState[],
  into: Map<number, RememberedEnemy>,
): Map<number, RememberedEnemy> {
  for (const entity of known) into.set(entity.id, { configId: entity.configId, dead: entity.dead });
  return into;
}

/**
 * Собрать полосу: запомненные противники, помеченные видимостью.
 * Погибший остаётся погибшим, даже если его клетка уже не наблюдается.
 */
export function buildEnemyStrip(
  remembered: ReadonlyMap<number, RememberedEnemy>,
  known: readonly EntityState[],
): EnemyStripEntry[] {
  const visible = new Set<number>();
  const dead = new Set<number>();
  for (const entity of known) {
    visible.add(entity.id);
    if (entity.dead) dead.add(entity.id);
  }
  const items: EnemyStripEntry[] = [];
  for (const [id, record] of remembered) {
    items.push({
      id,
      configId: record.configId,
      dead: record.dead || dead.has(id),
      seen: visible.has(id),
    });
  }
  return items;
}
