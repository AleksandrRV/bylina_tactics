/**
 * Содержимое окна информации о бойце (0.20.53).
 *
 * Окно открывается долгим нажатием портрета в верхней панели — своего
 * бойца или видимого противника — и отвечает на четыре вопроса: кто это,
 * в каком он сейчас состоянии, на что способен и чем вооружён. Описание
 * приходит из словаря, числа — из снимка боя и записей контента: правила
 * игры лежат в ядре, а не в тексте интерфейса, поэтому правка здоровья
 * или урона видна в окне без правки переводов.
 */

import type { EntityState, SkillStats, WeaponStats } from "@bylina/core";
import type { Translate } from "./action-info.js";
import { unitPortrait } from "./portraits.js";

/** Строка параметров: подпись и значение. */
interface UnitInfoRow {
  label: string;
  value: string;
}

/** Запись экипировки или умения: название и краткая сводка. */
interface UnitInfoItem {
  id: string;
  name: string;
  /** Краткая сводка: урон и дальность для оружия, цена и ресурсы для умения. */
  note: string;
  /** Оружие сейчас в руках: у бойца их может быть несколько. */
  current?: boolean;
}

interface UnitInfoSection {
  id: "equipment" | "skills";
  title: string;
  items: UnitInfoItem[];
}

export interface UnitInfo {
  /** Идентификатор сущности в снимке боя. */
  id: number;
  configId: string;
  name: string;
  /** Сторона: «Дружина» либо «Навь». */
  side: string;
  /** Портрет крупнее, чем в панели. */
  portrait: string | undefined;
  /** Описание из словаря; без словарной записи — пусто. */
  flavor: string;
  /** Боец пал: карточка помечена, но остаётся доступной для осмотра. */
  dead: boolean;
  /** Параметры: здоровье, очки действия, подвижность, меткость, защита… */
  rows: UnitInfoRow[];
  /** Текущие состояния: стойка, дозор, яд, паника, срок призыва. */
  states: string[];
  /** Экипировка и умения; пустые разделы не отдаются вовсе. */
  sections: UnitInfoSection[];
}

interface UnitInfoSource {
  weapons: Record<string, WeaponStats>;
  skills: Record<string, SkillStats>;
  /** Свой боец или противник: от этого зависит подпись стороны. */
  side: "ally" | "enemy";
}

/** Пустая строка, если ключа в словаре нет: `t` отдаёт сам ключ. */
function lookup(t: Translate, key: string): string {
  const value = t(key);
  return value === key ? "" : value;
}

/** Дальность в клетках: «1 кл.» — единица измерения, а не число. */
function cells(range: number, t: Translate): string {
  return `${range} ${t("action.info.cell")}`;
}

/** Оружие бойца: текущее первым, прочие — в порядке записи. */
function weaponItems(entity: EntityState, source: UnitInfoSource, t: Translate): UnitInfoItem[] {
  const ids = entity.weaponIds?.length ? entity.weaponIds : [entity.weaponId];
  const items: UnitInfoItem[] = [];
  for (const id of ids) {
    const weapon = source.weapons[id];
    if (!weapon) continue;
    items.push({
      id,
      name: t(`weapon.${id}.name`),
      note: `${t("action.info.damage")} ${weapon.minDmg}–${weapon.maxDmg} · ${cells(weapon.range, t)}`,
      // Отметка только у оружия в руках: у остальных её нет вовсе.
      ...(id === entity.weaponId ? { current: true } : {}),
    });
  }
  // В руках — первым: так карточка отвечает на вопрос «чем он бьёт сейчас».
  return items.sort((left, right) => Number(right.current ?? false) - Number(left.current ?? false));
}

/** Умения бойца: цена в очках действия, перезарядка и предел применений. */
function skillItems(entity: EntityState, source: UnitInfoSource, t: Translate): UnitInfoItem[] {
  const items: UnitInfoItem[] = [];
  for (const id of entity.skillIds ?? []) {
    const skill = source.skills[id];
    if (!skill) continue;
    const parts = [`${skill.apCost} ${t("battle.apLeft")}`];
    const cooldown = entity.skillCooldowns?.[id] ?? 0;
    if (cooldown > 0) parts.push(t("battle.cooldownShort", { turns: cooldown }));
    const used = entity.skillUses?.[id] ?? 0;
    if (skill.maxUsesPerBattle !== undefined) {
      parts.push(t("battle.usesShort", { uses: Math.max(0, skill.maxUsesPerBattle - used) }));
    }
    items.push({ id, name: t(`skill.${id}.name`), note: parts.join(" · ") });
  }
  return items;
}

/** Состояния бойца: то, что наложено или включено прямо сейчас. */
function stateList(entity: EntityState, t: Translate): string[] {
  const states: string[] = [];
  if (entity.dead) states.push(t("unit.info.fallen"));
  if (entity.defending) states.push(t("unit.info.stateDefend"));
  if (entity.overwatch) states.push(t("unit.info.stateOverwatch"));
  if (entity.hidden) states.push(t("unit.info.stateHidden"));
  if (entity.flying) states.push(t("unit.info.stateFlying"));
  if ((entity.immobileTurns ?? 0) > 0) {
    states.push(t("unit.info.stateImmobile", { turns: entity.immobileTurns! }));
  }
  if (entity.poison && entity.poison.turnsLeft > 0) {
    states.push(t("unit.info.statePoison", { turns: entity.poison.turnsLeft }));
  }
  if (entity.panic && entity.panic.turnsLeft > 0) {
    states.push(t("unit.info.statePanic", { turns: entity.panic.turnsLeft }));
  }
  if ((entity.timedLife ?? 0) > 0) {
    states.push(t("unit.info.stateTimed", { turns: entity.timedLife! }));
  }
  return states;
}

/**
 * Собрать окно информации о бойце.
 *
 * Числа берутся из снимка боя: раненый боец показывает текущее здоровье,
 * а не предел из записи контента, потраченные очки действия видны сразу.
 */
export function buildUnitInfo(entity: EntityState, source: UnitInfoSource, t: Translate): UnitInfo {
  const rows: UnitInfoRow[] = [
    { label: t("unit.info.hp"), value: `${entity.hp} / ${entity.maxHp}` },
    { label: t("action.info.apCost"), value: `${entity.ap} / ${entity.maxAp}` },
    { label: t("unit.info.mobility"), value: cells(entity.mobility, t) },
    { label: t("unit.info.aim"), value: String(entity.aim) },
    { label: t("unit.info.defense"), value: String(entity.defense) },
  ];
  // Воля есть не у всех записей (объекты и мороки воюют без неё).
  if (entity.will !== undefined) rows.push({ label: t("unit.info.will"), value: String(entity.will) });
  rows.push({ label: t("unit.info.vision"), value: cells(entity.vision, t) });

  const sections: UnitInfoSection[] = [];
  const equipment = weaponItems(entity, source, t);
  if (equipment.length > 0) {
    sections.push({ id: "equipment", title: t("unit.info.equipment"), items: equipment });
  }
  const skills = skillItems(entity, source, t);
  if (skills.length > 0) {
    sections.push({ id: "skills", title: t("unit.info.skills"), items: skills });
  }

  return {
    id: entity.id,
    configId: entity.configId,
    name: t(`unit.${entity.configId}.name`),
    side: t(source.side === "ally" ? "field.sidePlayer" : "field.sideEnemy"),
    portrait: unitPortrait(entity.configId),
    flavor: lookup(t, `unit.${entity.configId}.desc`),
    dead: entity.dead,
    rows,
    states: stateList(entity, t),
    sections,
  };
}
