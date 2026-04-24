/**
 * Заповнює таблицю `tariff`: на кожен календарний день **два** рядки — TariffPeriod **DAY** і **NIGHT**
 * (денний 07:00–23:00 та нічний 23:00–07:00 у логіці застосунку).
 *
 * Діапазон: останні **TARIFF_SEED_DAYS** днів (за замовчуванням **1200** з `seedEnvConfig`), `anchor: end` — включно з сьогодні.
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
import {
  createSeedMarkTimer,
  seedError,
  seedLog,
  seedNowIso,
} from "./seedLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_FILE = path.join(__dirname, "SeedTariffsFromApi.txt");

const arg = process.argv[2];
const fromEnv = process.env["TARIFF_SEED_DAYS"];
const days = arg != null && arg !== "" ? Number(arg) : Number(fromEnv ?? 1200);

if (!Number.isFinite(days) || days < 1 || days > 1200) {
  console.error("Days must be between 1 and 1200.");
  process.exit(1);
}

function EnvValue(key: string): string {
  const v = process.env[key];
  if (v == null || String(v).trim() === "") 
    return "не задано";

  return String(v).trim();
}

function WriteSeedReport(result: SeedTariffsFromApiResult): void {
  const daysFrom =
    arg != null && arg !== ""
      ? `аргумент CLI (${arg})`
      : fromEnv != null && String(fromEnv).trim() !== ""
        ? `TARIFF_SEED_DAYS у .env (${String(fromEnv).trim()})`
        : "не задано TARIFF_SEED_DAYS → у скрипті береться 1200";

  const lines = [
    `SeedTariffsFromApi — ${new Date().toISOString()}`,
    `anchor: end (останні ${days} календарних днів до сьогодні)`,
    `скільки днів: ${days} — ${daysFrom}`,
    "",
    "Результат (об'єкт повернення SeedTariffsFromApi):",
    JSON.stringify(result, null, 2),
    "",
    "Довідка mode: no_api | entsoe | api_single | api_series | api_per_day | snapshot | snapshot_loose.",
    "На кожен день: 2 записи в tariff — DAY (денний тариф) і NIGHT (нічний), pricePerKwh у валюті схеми.",
    "",
    "Контекст env (URL токенів не показуємо):",
    `  TARIFF_API_URL: ${process.env["TARIFF_API_URL"] ? "задано" : "не задано"}`,
    ...(result.mode === "entsoe"
      ? [
          "  Примітка: entsoe = ENTSO-E XML A44; за замовчуванням кілька паралельних запитів (TARIFF_SEED_FETCH_CONCURRENCY).",
          "  TARIFF_API_PER_DAY не перемикає цей режим (потрібен лише для власного JSON API з ?date=).",
          `  TARIFF_API_PER_DAY у .env: ${EnvValue("TARIFF_API_PER_DAY")}`,
        ]
      : result.mode === "snapshot" || result.mode === "snapshot_loose"
        ? [
            "  Примітка: snapshot / snapshot_loose — дані з tariff_seed_snapshot.json (за замовч. TARIFF_SEED_USE_SNAPSHOT_FIRST), без запитів до API.",
          ]
        : [`  TARIFF_API_PER_DAY: ${EnvValue("TARIFF_API_PER_DAY")}`]),
    `  TARIFF_DAY_PRICE: ${EnvValue("TARIFF_DAY_PRICE")}`,
    `  TARIFF_NIGHT_PRICE: ${EnvValue("TARIFF_NIGHT_PRICE")}`,
    "",
  ];
  fs.writeFileSync(REPORT_FILE, lines.join("\n"), "utf8");
}

async function main(): Promise<void> {
  const timer = createSeedMarkTimer("SEED_TARIFFS_API");
  seedLog("SEED_TARIFFS_API", "старт окремого скрипта (запис через saveHistoricalTariff / репозиторій, не транзакція seed:all)", {
    days,
    days_source:
      arg != null && arg !== ""
        ? "cli_arg"
        : fromEnv != null && String(fromEnv).trim() !== ""
          ? "env_TARIFF_SEED_DAYS"
          : "default_1200",
    TARIFF_API_URL_set: Boolean(process.env["TARIFF_API_URL"]?.trim()),
    anchor: "end",
  });
  try {
    const r = await SeedTariffsFromApi(days, new Date(), { anchor: "end" });
    timer.mark("SeedTariffsFromApi завершено");
    seedLog("SEED_TARIFFS_API", "результат", {
      days_written: r.daysWritten,
      mode: r.mode,
      calendar_days_requested: days,
      note: "на кожен день — 2 рядки tariff (DAY + NIGHT)",
      total_ms: timer.elapsedMs(),
      finished_at: seedNowIso(),
    });
    WriteSeedReport(r);
    seedLog("SEED_TARIFFS_API", "звіт записано на диск", { file: REPORT_FILE });
    process.exit(0);
  } catch (e: unknown) {
    seedError("SEED_TARIFFS_API", "помилка сиду тарифів", e, {
      total_ms: timer.elapsedMs(),
    });
    process.exit(1);
  }
}

void main();
