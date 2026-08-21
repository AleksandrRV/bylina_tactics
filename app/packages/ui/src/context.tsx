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

export interface AppServices {
  i18n: I18nApi;
  settings: SettingsApi;
  session: SessionApi;
  content: ContentBundle;
  version: string;
  install: InstallController;
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
