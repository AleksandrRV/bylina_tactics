/**
 * Поставка ретранслятора для Windows (roadmap 0.17.0): esbuild-бандл уже
 * собран в dist/signaling-server.cjs. Если доступен pkg — собирается
 * исполняемый файл bylina-relay.exe; иначе создаётся запускающий
 * bylina-relay.cmd (требует установленного Node.js).
 */
const { execSync } = require("node:child_process");
const { existsSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const dist = join(root, "dist");
const bundle = join(dist, "signaling-server.cjs");

if (!existsSync(bundle)) {
  console.error("dist/signaling-server.cjs missing — run esbuild bundle first");
  process.exit(1);
}

try {
  execSync("npx --no-install pkg --version", { stdio: "ignore" });
  execSync(`npx --no-install pkg ${JSON.stringify(bundle)} --targets node18-win-x64 --output ${JSON.stringify(join(dist, "bylina-relay.exe"))}`, { stdio: "inherit" });
  console.log("bylina-relay.exe built");
} catch {
  const cmd = join(dist, "bylina-relay.cmd");
  writeFileSync(cmd, "@echo off\r\nnode \"%~dp0signaling-server.cjs\" %*\r\n");
  console.log(`pkg unavailable; created launcher ${cmd}`);
}
