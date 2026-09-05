/** Портреты бойцов лежат в public приложения (apps/game-pwa/public/portraits). */

const PORTRAIT_FILES: Record<string, string> = {
  bogatyr: "bogatyr.jpg",
  strelets: "strelets.jpg",
  znaharka: "znaharka.jpg",
  volkhv: "volkhv.jpg",
  recruit: "recruit.jpg",
  upyr: "upyr.jpg",
  leshy: "leshy.jpg",
  kikimora: "kikimora.jpg",
  idol: "idol.jpg",
  captive: "captive.jpg",
  mikula_peasant: "recruit.jpg",
  // Федот — крестьянин, а не княжна: тот же образ, что у рекрута (0.20.43).
  fedot_stranded: "recruit.jpg",
  // Крыса Нави получила собственный портрет: прежде в полосе противников
  // вместо неё стоял упырь (0.20.43).
  forest_rat: "forest_rat.jpg",
  // Слизень тракта больше не занимает лицо кикиморы.
  slug: "slug.jpg",
  // Состязательные записи рядовых (0.16.0) используют образы исходных типов.
  upyr_pvp: "upyr.jpg",
  leshy_pvp: "leshy.jpg",
  kikimora_pvp: "kikimora.jpg",
  // Генералы (0.18.0).
  baba_yaga: "baba_yaga.jpg",
  solovey: "solovey.jpg",
  // Наставник-летописец (нарративная рамка обучения, roadmap 0.19.0).
  chronicler: "chronicler.jpg",
  // Кузнец — персонаж туториалов Кузни (0.20.0).
  kuznets: "kuznets.jpg",
};

/**
 * Портреты персонажей корабля для туториалов «первого раза» (0.20.0):
 * знахарка, кузнец, волхв, летописец.
 */
const PERSONA_FILES: Record<string, string> = {
  znaharka: "znaharka.jpg",
  kuznets: "kuznets.jpg",
  volkhv: "volkhv.jpg",
  chronicler: "chronicler.jpg",
};

/** Абсолютный URL портрета персонажа (аналогично unitPortrait). */
export function personaPortrait(persona: string): string | undefined {
  const file = PERSONA_FILES[persona];
  if (!file) return undefined;
  if (typeof document === "undefined") return `portraits/${file}`;
  return new URL(`portraits/${file}`, document.baseURI).href;
}

/** Абсолютный URL от baseURI документа — устойчиво к нестандартному base приложения. */
export function unitPortrait(configId: string): string | undefined {
  const file = PORTRAIT_FILES[configId];
  if (!file) return undefined;
  if (typeof document === "undefined") return `portraits/${file}`;
  return new URL(`portraits/${file}`, document.baseURI).href;
}
