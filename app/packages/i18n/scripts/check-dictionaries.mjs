import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../locales/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
function flatten(value, prefix = "") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}
function keysFor(language) {
  const dir = new URL(`${language}/`, root);
  return new Set(
    readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) => flatten(JSON.parse(readFileSync(new URL(file, dir), "utf8")))),
  );
}
const reference = keysFor(manifest.fallback);
let failed = false;
for (const { code } of manifest.languages) {
  const keys = keysFor(code);
  const missing = [...reference].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !reference.has(key));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`${code}: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`);
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    `Dictionary completeness check passed for ${manifest.languages.length} locales (${reference.size} keys).`,
  );
