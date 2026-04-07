/**
 * Заповнює таблицю `tariff` на **останні** TARIFF_SEED_DAYS календарних днів (за замовчуванням 60),
 * включно з сьогоднішнім днём (`anchor: end`).
 * Денний період: 07:00–23:00, нічний: 23:00–07:00 (узгоджено з bookingPricingService через NIGHT_TARIFF_*).
 *
 * Usage (з каталогу server/):
 *   npx tsx scripts/seed-tariffs-from-api.ts
 *   npx tsx scripts/seed-tariffs-from-api.ts 30
 *
 * Env: DATABASE_URL, опціонально TARIFF_API_URL, TARIFF_DAY_PRICE, TARIFF_NIGHT_PRICE,
 * TARIFF_SEED_DAYS, TARIFF_API_PER_DAY=true
 */
import "dotenv/config";
import { seedTariffsFromApiForDays } from "../src/services/forecast/tariffIngestService.js";

const arg = process.argv[2];
const fromEnv = process.env["TARIFF_SEED_DAYS"];
const days = arg != null && arg !== "" ? Number(arg) : Number(fromEnv ?? 60);

if (!Number.isFinite(days) || days < 1 || days > 366) {
  console.error("Days must be between 1 and 366.");
  process.exit(1);
}

seedTariffsFromApiForDays(days, new Date(), { anchor: "end" })
  .then((r) => {
    console.log(`Tariff seed: wrote ${r.daysWritten} calendar day(s) (DAY + NIGHT rows each, last ${days} days).`);
    process.exit(0);
  })
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
