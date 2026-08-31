/**
 * Содержимое окна информации о действии (0.20.46).
 *
 * Окно открывается долгим нажатием кнопки и отвечает на четыре вопроса:
 * что это, что делает, чем это стоит и заканчивает ли ход. Название и
 * нарративная строка приходят из словарей, числа — из боевых данных:
 * правила игры лежат в ядре, а не в тексте интерфейса, и правка
 * урона или стоимости не требует перевода.
 */

import type { SkillStats, WeaponStats } from "@bylina/core";
import { actionArt } from "./action-art.js";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Строка параметров: подпись и значение. */
interface ActionInfoRow {
  label: string;
  value: string;
}

export interface ActionInfo {
  /** Идентификатор оружия, умения или служебного действия. */
  id: string;
  name: string;
  /** Образ действия: крупнее, чем на кнопке. */
  art: string | undefined;
  /** Нарративная строка: приглушённый курсив под названием. */
  flavor: string;
  rows: ActionInfoRow[];
}

/** Пустая строка, если ключа в словаре нет: `t` отдаёт сам ключ. */
function lookup(t: Translate, key: string): string {
  const value = t(key);
  return value === key ? "" : value;
}

/** Имя существа из словаря; без словарной записи — сам идентификатор. */
function nameOf(t: Translate, id: string): string {
  const key = `unit.${id}.name`;
  const value = t(key);
  return value === key ? id : value;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Дальность в клетках: «1 кл.» — единица измерения, а не число. */
function cells(range: number, t: Translate): string {
  return `${range} ${t("action.info.cell")}`;
}

/** Стоимость и конец хода — две строки, обязательные для любого действия. */
function pushCost(rows: ActionInfoRow[], apCost: number, endsTurn: boolean, t: Translate): void {
  rows.push({ label: t("action.info.apCost"), value: String(apCost) });
  rows.push({ label: t("action.info.endsTurn"), value: t(endsTurn ? "action.info.yes" : "action.info.no") });
}

/** Окно информации об оружии: тип, дальность, урон, крит, стоимость. */
export function weaponActionInfo(id: string, weapon: WeaponStats, t: Translate): ActionInfo {
  const rows: ActionInfoRow[] = [
    {
      label: t("action.info.kind"),
      value: t(weapon.category === "melee" ? "action.info.kindMelee" : "action.info.kindRanged"),
    },
    { label: t("action.info.range"), value: cells(weapon.range, t) },
    { label: t("action.info.damage"), value: `${weapon.minDmg}–${weapon.maxDmg}` },
  ];
  if (weapon.crit > 0) {
    rows.push({ label: t("action.info.crit"), value: `${weapon.crit}% ${signed(weapon.critBonus)}` });
  }
  if (weapon.aimMod !== 0) {
    rows.push({ label: t("action.info.aim"), value: signed(weapon.aimMod) });
  }
  if ((weapon.envDmg ?? 0) >= 1) {
    rows.push({ label: t("action.info.destroyCover"), value: t("action.info.yes") });
  }
  pushCost(rows, weapon.apCost, weapon.endsTurn, t);
  return {
    id,
    name: t(`weapon.${id}.name`),
    art: actionArt(id),
    flavor: lookup(t, `weapon.${id}.flavor`),
    rows,
  };
}

/** Строка по следствию умения: урон, лечение, состояние, призыв. */
function effectRows(effect: SkillStats["effects"][number], t: Translate): ActionInfoRow[] {
  switch (effect.type) {
    case "damage": {
      const rows: ActionInfoRow[] = [{ label: t("action.info.damage"), value: `${effect.minDmg}–${effect.maxDmg}` }];
      if ((effect.crit ?? 0) > 0) {
        rows.push({ label: t("action.info.crit"), value: `${effect.crit}% ${signed(effect.critBonus ?? 0)}` });
      }
      return rows;
    }
    case "heal":
      return [{ label: t("action.info.heal"), value: String(effect.amount) }];
    case "applyStatus":
      return [
        {
          label: t("action.info.status"),
          value: `${t(`action.status.${effect.status}`)} · ${effect.duration}`,
        },
      ];
    case "removeStatus":
      return [{ label: t("action.info.removeStatus"), value: t(`action.status.${effect.status}`) }];
    case "knockback":
      return [{ label: t("action.info.knockback"), value: t("action.info.yes") }];
    case "destroyCover":
      return [{ label: t("action.info.destroyCover"), value: t("action.info.yes") }];
    case "spawn":
      return [{ label: t("action.info.summon"), value: nameOf(t, effect.unitId) }];
    case "displace":
      return [{ label: t("action.info.displace"), value: t("action.info.yes") }];
    case "flee":
      return [{ label: t("action.info.flee"), value: t("action.info.yes") }];
    case "reveal":
      return [{ label: t("action.info.reveal"), value: t("action.info.yes") }];
    default:
      return [];
  }
}

/** Окно информации об умении: цель, область, следствия, ресурсы. */
export function skillActionInfo(id: string, skill: SkillStats, t: Translate): ActionInfo {
  const rows: ActionInfoRow[] = [
    {
      label: t("action.info.kind"),
      value: t(
        skill.category === "melee"
          ? "action.info.kindMelee"
          : skill.category === "ranged"
            ? "action.info.kindRanged"
            : "action.info.kindSelf",
      ),
    },
  ];
  if (skill.category !== "self") {
    rows.push({ label: t("action.info.range"), value: cells(skill.range, t) });
  }
  if ((skill.radius ?? 0) > 0) {
    rows.push({ label: t("action.info.radius"), value: cells(skill.radius!, t) });
  }
  if (skill.filter) {
    rows.push({
      label: t("action.info.target"),
      value: t(
        skill.filter === "enemies"
          ? "action.info.targetEnemies"
          : skill.filter === "allies"
            ? "action.info.targetAllies"
            : skill.filter === "cover"
              ? "action.info.targetCover"
              : "action.info.targetAll",
      ),
    });
  }
  for (const effect of skill.effects) {
    rows.push(...effectRows(effect, t));
  }
  if (skill.extract) {
    rows.push({ label: t("action.info.flee"), value: t("action.info.yes") });
  }
  if (skill.cooldownTurns) {
    // Значение — число ходов: подпись уже названа, единица не нужна.
    rows.push({ label: t("action.info.cooldown"), value: String(skill.cooldownTurns) });
  }
  if (skill.maxUsesPerBattle !== undefined) {
    rows.push({ label: t("action.info.uses"), value: String(skill.maxUsesPerBattle) });
  }
  pushCost(rows, skill.apCost, skill.endsTurn, t);
  return {
    id,
    name: t(`skill.${id}.name`),
    art: actionArt(id),
    flavor: lookup(t, `skill.${id}.flavor`),
    rows,
  };
}

/**
 * Окно информации о служебном действии: стойка и дозор не лежат в
 * бестиарии, поэтому описаны здесь — но теми же строками, что и урок
 * «защитная стойка» (game-rules §15.8).
 */
export function stanceActionInfo(kind: "defend" | "overwatch", t: Translate): ActionInfo {
  const rows: ActionInfoRow[] =
    kind === "defend"
      ? [
          { label: t("action.info.kind"), value: t("action.info.kindSelf") },
          { label: t("action.info.defendEffect"), value: t("action.info.defendEffectValue") },
        ]
      : [
          { label: t("action.info.kind"), value: t("action.info.kindSelf") },
          { label: t("action.info.overwatchEffect"), value: t("action.info.yes") },
        ];
  pushCost(rows, 1, true, t);
  return {
    id: kind,
    name: t(kind === "defend" ? "battle.defend" : "battle.overwatch"),
    art: actionArt(kind),
    flavor: lookup(t, kind === "defend" ? "battle.defendFlavor" : "battle.overwatchFlavor"),
    rows,
  };
}
