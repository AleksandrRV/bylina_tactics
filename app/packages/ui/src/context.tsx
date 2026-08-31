import { createContext, useContext } from "react";
import type { ContentBundle } from "@bylina/content";
import type { I18nApi } from "@bylina/i18n";
import type { SessionApi } from "@bylina/session";
import type { SettingsApi } from "@bylina/settings";

export interface InstallController {
  canInstall: boolean;
  installed: boolean;
  prompt: () => Promise<void>;
}

/**
 * Управление веткой кампании из главного меню (0.20.15): сохранение былины
 * не загружается при запуске — меню предлагает «Продолжить», а «Новая
 * былина» предупреждает о потере прогресса. Приложение-хост поставляет
 * контроллер; без него меню работает как прежде.
 */
interface CampaignFlowController {
  /** Есть несчитанное сохранение былины: меню показывает «Продолжить». */
  canContinue: boolean;
  /** Есть прогресс (несчитанное сохранение либо текущая былина): «Новая былина» предупреждает о потере. */
  hasProgress: boolean;
  /** Загрузить сохранённую былину и вернуться к сохранённому экрану ветки кампании. */
  continueCampaign(): void;
  /** Отказаться от текущего прогресса и начать новую былину (без повторного вопроса). */
  startNewCampaign(): void;
}

export interface AppServices {
  i18n: I18nApi;
  settings: SettingsApi;
  session: SessionApi;
  content: ContentBundle;
  version: string;
  install: InstallController;
  /** Отладочный режим (адрес с параметром ?debug=1): включает средства QA (0.20.1). */
  debug: boolean;
  /** Ветка кампании из меню (0.20.15); поставляется приложением-хостом. */
  campaignFlow?: CampaignFlowController;
}

const ServicesContext = createContext<AppServices | null>(null);

export const ServicesProvider = ServicesContext.Provider;

export function useServices(): AppServices {
  const value = useContext(ServicesContext);
  if (!value) {
    throw new Error("ServicesProvider is missing");
  }
  return value;
}

export function useT(): I18nApi["t"] {
  return useServices().i18n.t;
}
