#!/usr/bin/env node
/** Ensures the release version has one source of truth across the workspace. */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function packageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await packageFiles(file));
    else if (entry.name === "package.json") files.push(file);
  }
  return files;
}

const packageJsonFiles = await packageFiles(root);
const rootManifest = path.join(root, "package.json");
const expected = JSON.parse(await readFile(rootManifest, "utf8")).version;
const failures = [];

for (const file of packageJsonFiles) {
  const version = JSON.parse(await readFile(file, "utf8")).version;
  if (version !== expected) failures.push(`${path.relative(root, file)}: ${version ?? "no version"}`);
}

const constants = [
  ["packages/session/src/index.ts", "APP_VERSION"],
  ["packages/core/src/kernel.ts", "CORE_VERSION"],
  ["packages/replay/src/index.ts", "REPLAY_VERSION"],
];
for (const [relativeFile, constant] of constants) {
  const source = await readFile(path.join(root, relativeFile), "utf8");
  const match = source.match(new RegExp(`export const ${constant} = ["']([^"']+)["']`));
  if (!match || match[1] !== expected) {
    failures.push(`${relativeFile}: ${constant} = ${match?.[1] ?? "not found"}`);
  }
}

if (failures.length > 0) {
  console.error(`Version consistency check failed; expected ${expected}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Version consistency check passed: ${expected}`);
}
