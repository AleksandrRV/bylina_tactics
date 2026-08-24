/**
 * Логика туториалов «первого раза» кампании (0.20.0, roadmap §7.3).
 *
 * Чистый модуль: вычисление «желаемых» туториалов по условиям экрана,
 * персонажи-рассказчики и их портреты. Каждый туториал показывается один раз
 * (отметка в session.campaignHintsDone), отключается настройкой showHints.
 */
import type { MissionConfig } from "@bylina/content";

export type CampaignHintId =
  | "darkness" // Тьма и миссия «Игла» — летописец, карта корабля
  | "scan" // сканирование карты — летописец, карта корабля
  | "wound" // ранение и Горница — знахарка, карта корабля
  | "roster" // дружина и умения — волхв, вкладка «Дружина»
  | "forge" // Кузня и снаряжение — кузнец, вкладка «Кузня»
  | "deploy" // формирование высадки — летописец, экран высадки
  | "evacuation" // эвакуация — летописец, высадка в миссии спасения/разведки
  | "general" // появление генерала — волхв, бой с генералом
  // Доводка 0.20.1 (roadmap 7.3.1): ввод боя и типов противников.
  | "first_battle" // первый бой кампании — летописец
  | "first_leshy" // первый леший — волхв (дистанция, корни)
  | "first_kikimora"; // первая кикимора — знахарка (яд, воскрешение)

export type PersonaId = "znaharka" | "kuznets" | "volkhv" | "chronicler";

/** Кто подаёт каждый туториал (game-design §3.1: знахарка — лечение и ранения,
 *  кузнец — снаряжение, волхв — умения, летописец — Тьму и миссию «Игла»). */
export const CAMPAIGN_HINT_PERSONAS: Record<CampaignHintId, PersonaId> = {
  darkness: "chronicler",
  scan: "chronicler",
  wound: "znaharka",
  roster: "volkhv",
  forge: "kuznets",
  deploy: "chronicler",
  evacuation: "chronicler",
  general: "volkhv",
  first_battle: "chronicler",
  first_leshy: "volkhv",
  first_kikimora: "znaharka",
};

export interface CampaignHintsContext {
  /** Настройка «показывать подсказки» (по умолчанию включена). */
  showHints: boolean;
  /** Уже показанные туториалы (session.campaignHintsDone). */
  done: readonly string[];
  /** Активна вкладка карты корабля. */
  onCampaignMap: boolean;
  /** Число закрытых точек карты (сканирование). */
  lockedCount: number;
  /** В дружине есть раненые (Горница). */
  hasWounded: boolean;
  /** Активна вкладка «Дружина». */
  rosterTabActive: boolean;
  /** Активна вкладка «Кузня». */
  forgeTabActive: boolean;
  /** Открыт экран формирования высадки. */
  onDeployment: boolean;
  /** Тип начатой миссии (для эвакуации). */
  missionType?: MissionConfig["type"];
  /** Идёт бой миссии с генералом. */
  onBattleWithGeneral: boolean;
  /** Идёт бой миссии кампании (0.20.1). */
  onBattle: boolean;
  /** Записи противников миссии (0.20.1): туториалы «первый тип противника». */
  enemyTypes: readonly string[];
}

/**
 * Туториалы, которые требуется показать сейчас, в порядке приоритета.
 * Показываются только непоказанные; при showHints = false список пуст —
 * прохождение кампании от подсказок не зависит (0.20.0).
 */
export function pendingCampaignHints(context: CampaignHintsContext): CampaignHintId[] {
  if (!context.showHints) return [];
  const result: CampaignHintId[] = [];
  const push = (id: CampaignHintId, on: boolean): void => {
    if (on && !context.done.includes(id)) result.push(id);
  };
  push("darkness", context.onCampaignMap);
  push("scan", context.onCampaignMap && context.lockedCount > 0);
  push("wound", context.onCampaignMap && context.hasWounded);
  push("roster", context.rosterTabActive);
  push("forge", context.forgeTabActive);
  push("deploy", context.onDeployment);
  push("evacuation", context.onDeployment && (context.missionType === "rescue" || context.missionType === "recon"));
  // Боевые туториалы (0.20.1): первый бой — раньше типов противников.
  push("first_battle", context.onBattle);
  push("first_leshy", context.onBattle && context.enemyTypes.includes("leshy"));
  push("first_kikimora", context.onBattle && context.enemyTypes.includes("kikimora"));
  push("general", context.onBattleWithGeneral);
  return result;
}
