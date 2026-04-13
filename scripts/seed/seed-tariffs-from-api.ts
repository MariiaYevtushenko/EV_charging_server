/**
 * Заповнює таблицю `tariff`: на кожен календарний день **два** рядки — TariffPeriod **DAY** і **NIGHT**
 * (денний 07:00–23:00 та нічний 23:00–07:00 у логіці застосунку).
 *
 * Діапазон: останні **TARIFF_SEED_DAYS** днів (за замовчуванням **90**), `anchor: end` — включно з сьогодні.
 * Кількість днів: env `TARIFF_SEED_DAYS` або аргумент CLI.
 *
 * Після запуску — звіт у `SeedTariffsFromApi.txt` (поруч зі скриптом).
 *
 * Usage (з каталогу server/):
 *   npx tsx scripts/seed/seed-tariffs-from-api.ts
 *   npx tsx scripts/seed/seed-tariffs-from-api.ts 30
 */
import "./loadServerEnv.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SeedTariffsFromApi,
  type SeedTariffsFromApiResult,
} from "../../src/services/forecast/tariffIngestService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_FILE = path.join(__dirname, "SeedTariffsFromApi.txt");

const arg = process.argv[2];
const fromEnv = process.env["TARIFF_SEED_DAYS"];
const days = arg != null && arg !== "" ? Number(arg) : Number(fromEnv ?? 90);

if (!Number.isFinite(days) || days < 1 || days > 366) {
  console.error("Days must be between 1 and 366.");
  process.exit(1);
}

function EnvValue(key: string): string {
  const v = process.env[key];
  if (v == null || String(v).trim() === "") return "не задано";
  return String(v).trim();
}

function writeSeedReport(result: SeedTariffsFromApiResult): void {
  const daysFrom =
    arg != null && arg !== ""
      ? `аргумент CLI (${arg})`
      : fromEnv != null && String(fromEnv).trim() !== ""
        ? `TARIFF_SEED_DAYS у .env (${String(fromEnv).trim()})`
        : "не задано TARIFF_SEED_DAYS → у скрипті береться 90";

  const lines = [
    `SeedTariffsFromApi — ${new Date().toISOString()}`,
    `anchor: end (останні ${days} календарних днів до сьогодні)`,
    `скільки днів: ${days} — ${daysFrom}`,
    "",
    "Результат (об'єкт повернення SeedTariffsFromApi):",
    JSON.stringify(result, null, 2),
    "",
    "Довідка mode: no_api | entsoe | api_single | api_series | api_per_day (лише JSON-API).",
    "На кожен день: 2 записи в tariff — DAY (денний тариф) і NIGHT (нічний), pricePerKwh у валюті схеми.",
    "",
    "Контекст env (URL токенів не показуємо):",
    `  TARIFF_API_URL: ${process.env["TARIFF_API_URL"] ? "задано" : "не задано"}`,
    ...(result.mode === "entsoe"
      ? [
          "  Примітка: entsoe = ENTSO-E XML A44, один HTTP-запит на кожен календарний день.",
          "  TARIFF_API_PER_DAY не перемикає цей режим (потрібен лише для власного JSON API з ?date=).",
          `  TARIFF_API_PER_DAY у .env: ${EnvValue("TARIFF_API_PER_DAY")}`,
        ]
      : [`  TARIFF_API_PER_DAY: ${EnvValue("TARIFF_API_PER_DAY")}`]),
    `  TARIFF_DAY_PRICE: ${EnvValue("TARIFF_DAY_PRICE")}`,
    `  TARIFF_NIGHT_PRICE: ${EnvValue("TARIFF_NIGHT_PRICE")}`,
    "",
  ];
  fs.writeFileSync(REPORT_FILE, lines.join("\n"), "utf8");
}

async function main(): Promise<void> {
  try {
    const r = await SeedTariffsFromApi(days, new Date(), { anchor: "end" });
    console.log(
      `Tariff seed: wrote ${r.daysWritten} calendar day(s) (DAY + NIGHT rows each, last ${days} days), mode=${r.mode}.`,
    );
    writeSeedReport(r);
    console.log(`Звіт: ${REPORT_FILE}`);
    process.exit(0);
  } catch (e: unknown) {
    console.error(e);
    process.exit(1);
  }
}

void main();
