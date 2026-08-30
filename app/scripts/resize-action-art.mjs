#!/usr/bin/env node
/**
 * Приведение образов действий к кадру 512×512 (0.20.48).
 *
 * Генератор отдаёт иллюстрации 1024×1024, а кнопке-миниатюре нужен
 * ровный квадрат 512×512: лишнее дешевле убрать в каталоге, чем
 * отдавать обозревателю. Скрипт проходит по `apps/game-pwa/public/actions`,
 * читает размер кадра из маркера JPEG (сторонние библиотеки не нужны)
 * и пережимает всё, что больше нормы, внешним `convert` (ImageMagick).
 *
 * Запуск из каталога `app`: `node scripts/resize-action-art.mjs`.
 * Без установленного ImageMagick скрипт честно сообщает список лишних
 * кадров и завершается с кодом 1 — тихо оставить каталог тяжёлым хуже.
 */

import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "apps/game-pwa/public/actions");
const SIZE = 512;
const QUALITY = "84";

/** Размер кадра JPEG из маркера SOF: [ширина, высота] либо null. */
function jpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return [buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5)];
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

async function main() {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jpg")).sort();
  if (files.length === 0) {
    console.error("каталог образов пуст:", dir);
    process.exit(1);
  }
  try {
    await run("convert", ["-version"]);
  } catch {
    console.error("ImageMagick (`convert`) не найден — кадры не приведены к 512×512.");
    process.exit(1);
  }
  let changed = 0;
  for (const file of files) {
    const target = path.join(dir, file);
    const size = jpegSize(await readFile(target));
    if (size && size[0] === SIZE && size[1] === SIZE) continue;
    const temporary = path.join("/tmp", `action-${file}`);
    await run("convert", [
      target,
      "-resize",
      `${SIZE}x${SIZE}!`,
      "-quality",
      QUALITY,
      "-strip",
      temporary,
    ]);
    await writeFile(target, await readFile(temporary));
    await rename(temporary, target);
    changed += 1;
    console.log(`${file}: ${size ? size.join("×") : "?"} → ${SIZE}×${SIZE}`);
  }
  console.log(
    changed === 0
      ? `Все ${files.length} образов уже ${SIZE}×${SIZE}.`
      : `Приведено к ${SIZE}×${SIZE}: ${changed} из ${files.length}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
