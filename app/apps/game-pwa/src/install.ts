import { useEffect, useState } from "react";
import type { InstallController } from "@bylina/ui";

export function useInstallPrompt(): InstallController {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches,
  );

  useEffect(() => {
    const onPrompt = (raw: Event) => {
      raw.preventDefault();
      setEvent(raw as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return {
    canInstall: event !== null,
    installed,
    prompt: async () => {
      if (!event) return;
      await event.prompt();
      await event.userChoice;
      setEvent(null);
    },
  };
}
