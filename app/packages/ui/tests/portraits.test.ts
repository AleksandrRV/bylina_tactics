import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unitPortrait } from "../src/portraits.js";

/** Каталог портретов приложения (public не входит в сборку пакета). */
const PORTRAIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/game-pwa/public/portraits");

/** Записи, у которых обязан быть портрет: дружина, Навь, пролог, генералы. */
const PORTRAITED = [
  "bogatyr",
  "strelets",
  "znaharka",
  "volkhv",
  "recruit",
  "upyr",
  "leshy",
  "kikimora",
  "idol",
  "captive",
  "baba_yaga",
  "solovey",
  "mikula_peasant",
  "fedot_stranded",
  "forest_rat",
  "slug",
  "upyr_pvp",
  "leshy_pvp",
  "kikimora_pvp",
  "chronicler",
  "kuznets",
];

/**
 * Портреты (0.20.43): каждая запись ссылается на существующий файл, а
 * прологовая бестиария не берёт чужие лица — крестьянин не княжна, крыса не
 * упырь. Прежде так и было: Федот стоял портретом captive, лесная крыса —
 * портретом upyr.
 */
describe("unit portraits (0.20.43)", () => {
  it("points every record at an existing file", () => {
    for (const configId of PORTRAITED) {
      const url = unitPortrait(configId);
      expect(url, `нет портрета для ${configId}`).toBeTruthy();
      const file = String(url).split("/").pop()!;
      expect(existsSync(join(PORTRAIT_DIR, file)), `нет файла ${file} для ${configId}`).toBe(true);
    }
  });

  it("dresses the stranded peasant as a recruit", () => {
    expect(unitPortrait("fedot_stranded")).toBe(unitPortrait("recruit"));
  });

  it("gives the forest rat its own face", () => {
    expect(unitPortrait("forest_rat")?.endsWith("forest_rat.jpg")).toBe(true);
    expect(unitPortrait("forest_rat")).not.toBe(unitPortrait("upyr"));
  });
});
