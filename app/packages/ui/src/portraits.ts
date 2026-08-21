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
};

/** Абсолютный URL от baseURI документа — устойчиво к нестандартному base приложения. */
export function unitPortrait(configId: string): string | undefined {
  const file = PORTRAIT_FILES[configId];
  if (!file) return undefined;
  if (typeof document === "undefined") return `portraits/${file}`;
  return new URL(`portraits/${file}`, document.baseURI).href;
}
