#!/usr/bin/env node
/**
 * Проверка зависимостей на известные уязвимости (устойчивая к сети).
 *
 * `pnpm audit` ходит в реестр npm, и его отказ неотличим от находки:
 * и обрыв связи (ERR_SOCKET_TIMEOUT, 5xx, DNS), и настоящая уязвимость
 * дают одинаковый ненулевой код выхода. Из-за этого сборка падала на
 * недоступности registry.npmjs.org, хотя с зависимостями всё в порядке.
 *
 * Скрипт разделяет два случая:
 *
 *   - разбираем машинный отчёт `pnpm audit --json`; сборку роняют только
 *     реальные находки уровня high и critical (moderate — нет, как и прежде);
 *   - сетевой отказ — не находка: попытка повторяется с возрастающей
 *     паузой, а если реестр так и не ответил, шаг завершается успешно
 *     с явным предупреждением. Аудит — сторожевой сигнал, а не источник
 *     ложных падений ветки.
 *
 * Использование: node scripts/audit-deps.mjs [--audit-level=high]
 */
import { spawn } from "node:child_process";
import process from "node:process";

/** Уровни серьёзности по возрастанию — порог сравнивается по индексу. */
const LEVELS = ["info", "low", "moderate", "high", "critical"];

const levelArg = process.argv.find((arg) => arg.startsWith("--audit-level="));
const threshold = levelArg?.split("=")[1] ?? "high";
const thresholdIndex = LEVELS.indexOf(threshold);
if (thresholdIndex < 0) {
  console.error(`audit-deps: неизвестный уровень «${threshold}»; ожидались ${LEVELS.join(", ")}`);
  process.exit(2);
}

const ATTEMPTS = 3;
const BACKOFF_MS = [5000, 20000];

/** Признаки сетевого отказа, а не находки аудита. */
const NETWORK_HINTS = [
  "ERR_SOCKET_TIMEOUT",
  "ERR_PNPM_REGISTRIES_MISMATCH",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "socket timeout",
  "network",
  "getaddrinfo",
  "request to https://",
  "502 Bad Gateway",
  "503 Service Unavailable",
  "504 Gateway Time-out",
];

const isNetworkFailure = (text) => {
  const haystack = text.toLowerCase();
  return NETWORK_HINTS.some((hint) => haystack.includes(hint.toLowerCase()));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Запускает pnpm audit --json и возвращает код выхода вместе с потоками. */
function runAudit() {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["audit", "--json"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Достаёт из отчёта число находок по уровням. Формат pnpm повторяет npm:
 * { metadata: { vulnerabilities: { critical: 0, high: 1, ... } } }.
 */
function parseReport(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    const report = JSON.parse(stdout.slice(start));
    const counts = report?.metadata?.vulnerabilities;
    if (!counts || typeof counts !== "object") return null;
    return counts;
  } catch {
    return null;
  }
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const { code, stdout, stderr } = await runAudit();
  const counts = parseReport(stdout);

  if (counts) {
    const blocking = LEVELS.slice(thresholdIndex).filter((level) => (counts[level] ?? 0) > 0);
    const summary = LEVELS.map((level) => `${level}: ${counts[level] ?? 0}`).join(", ");
    if (blocking.length === 0) {
      console.log(`audit-deps: находок уровня ${threshold}+ нет (${summary}).`);
      process.exit(0);
    }
    console.error(`audit-deps: найдены уязвимости уровня ${blocking.join(", ")} (${summary}).`);
    console.error("Подробности: pnpm audit");
    process.exit(1);
  }

  // Отчёта нет: либо сеть, либо неожиданная поломка самого аудита.
  const noise = `${stdout}\n${stderr}`;
  if (!isNetworkFailure(noise)) {
    console.error(`audit-deps: аудит завершился с кодом ${code}, а отчёт не разобран.`);
    console.error(noise.trim());
    process.exit(1);
  }

  if (attempt < ATTEMPTS) {
    const wait = BACKOFF_MS[attempt - 1] ?? 20000;
    console.warn(`audit-deps: реестр недоступен (попытка ${attempt}/${ATTEMPTS}); повтор через ${wait / 1000} с.`);
    await sleep(wait);
    continue;
  }

  // Реестр так и не ответил: это отказ инфраструктуры, а не находка.
  console.warn(`audit-deps: реестр npm недоступен после ${ATTEMPTS} попыток — проверка пропущена.`);
  console.warn(noise.trim().split("\n").slice(-3).join("\n"));
  process.exit(0);
}
