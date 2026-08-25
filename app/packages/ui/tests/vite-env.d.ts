/// <reference types="vite/client" />

/**
 * Служебные объявления для проверки типов тестов, монтирующих приложение
 * целиком (boot-smoke, boot-saved, training-battle-dom): они импортируют
 * исходники `apps/game-pwa`, а объявление события установки живёт в
 * `apps/game-pwa/src/vite-env.d.ts` и не видно из этого пакета.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
