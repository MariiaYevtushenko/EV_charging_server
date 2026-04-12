/**
 * Заповнює таблицю `tariff` на **останні** TARIFF_SEED_DAYS календарних днів (за замовчуванням 60),
 * включно з сьогоднішнім днём (`anchor: end`).
 *
 * Після успішного запуску результат також пишеться в `SeedTariffsFromApi.txt` (поруч зі скриптом).
 *
 * Usage (з каталогу server/):
 *   npx tsx scripts/seed/seed-tariffs-from-api.ts
 *   npx tsx scripts/seed/seed-tariffs-from-api.ts 30
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import {
  SeedTariffsFromApi,
  type SeedTariffsFromApiResult,
} from "../../src/services/forecast/tariffIngestService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_FILE = path.join(__dirname, "SeedTariffsFromApi.txt");

const arg = process.argv[2];
const fromEnv = process.env["TARIFF_SEED_DAYS"];
const days = arg != null && arg !== "" ? Number(arg) : Number(fromEnv ?? 60);

if (!Number.isFinite(days) || days < 1 || days > 366) {
  console.error("Days must be between 1 and 366.");
  process.exit(1);
}

function writeSeedReport(result: SeedTariffsFromApiResult): void {
  const lines = [
    `SeedTariffsFromApi — ${new Date().toISOString()}`,
    `anchor: end (останні ${days} календарних днів до сьогодні)`,
    "",
    "Результат (об'єкт повернення SeedTariffsFromApi):",
    JSON.stringify(result, null, 2),
    "",
    "mode: no_api — без TARIFF_API_URL, ціни з TARIFF_DAY_PRICE / TARIFF_NIGHT_PRICE;",
    "      api_single — один запит API, одна пара день/ніч на всі дні;",
    "      api_series — API з масивом по датах;",
    "      api_per_day — TARIFF_API_PER_DAY=true, запит на кожну дату.",
    "",
    "Контекст env (без значення URL):",
    `  TARIFF_API_URL: ${process.env["TARIFF_API_URL"] ? "задано" : "не задано"}`,
    `  TARIFF_API_PER_DAY: ${process.env["TARIFF_API_PER_DAY"] ?? "—"}`,
    `  TARIFF_DAY_PRICE: ${process.env["TARIFF_DAY_PRICE"] ?? "—"}`,
    `  TARIFF_NIGHT_PRICE: ${process.env["TARIFF_NIGHT_PRICE"] ?? "—"}`,
    `  TARIFF_SEED_DAYS (env): ${fromEnv ?? "—"}`,
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
