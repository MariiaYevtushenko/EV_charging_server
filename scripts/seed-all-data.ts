/**
 * SEED_ALL_DATA — одна транзакція PostgreSQL: `BEGIN` на старті, `COMMIT` лише після
 * успішного завершення всіх кроків; при будь-якій помилці — `ROLLBACK` (нічого не лишається наполовину).
 *
 * Порядок: SeedMassiveUsers → vehicle CSV → станції CSV → тарифи → SeedBookingsSessionsBills.
 * Демо-логіни не вставляються (окремо / вручну).
 *
 * Числові параметри сиду — змінні оточення (дефолти в `scripts/seed/seedEnvConfig.ts`),
 * зокрема `SEED_DEMO_SESSIONS_COUNT` та `SEED_SESSION_FROM_BOOKING_SHARE` для демо-сесій.
 *
 * Опційно: `SEED_OPTIONAL_SQL_PROCEDURES=true` — лише для кроку 1 (`SeedMassiveUsers`): якщо
 * процедура відсутня, крок пропускається (savepoint). Крок 5 (`SeedBookingsSessionsBills`) завжди
 * атомарний із рештою пайплайна: будь-яка помилка → `ROLLBACK` усієї транзакції (без часткового коміту станцій).
 *
 * CLI: npx tsx scripts/seed-all-data.ts [--truncate]
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import "dotenv/config";

import { SeedTariffsFromApi } from "../src/services/forecast/tariffIngestService.js";
import { loadDefaultEvStationCsvRows, SeedEvStationsFromCsv, SyncLocationStationSequences } from "./seed/seed-from-csv.js";
import { SeedVehiclesFromCsv, SyncVehicleSequence } from "./seed/seed-vehicles-from-csv.js";
import { upsertTariffDayNightForCalendarDayPg } from "./seed/tariffUpsertPg.js";
import {
  getSeedDemoBookingsCount,
  getSeedDemoSessionsCount,
  getSeedMassiveUserCount,
  getSeedSessionFromBookingShare,
  getTariffSeedDays,
  isSeedOptionalSqlProcedures,
  SEED_ENV,
  SEED_ENV_DEFAULTS,
} from "./seed/seedEnvConfig.js";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);

export const SEED_ALL_DATA_STEPS = [
  "0_optional_truncate",
  "1_sql_seed_massive_users",
  "2_seed_vehicles_from_csv",
  "3_seed_from_csv_stations",
  "4_seed_tariffs_api",
  "5_sql_demo_bookings_sessions_bills",
] as const;

async function truncateAllDemoTables(client: pg.Client): Promise<void> {
  console.log("[SEED_ALL_DATA:0] TRUNCATE демо-таблиць (CASCADE)…");
  await client.query(`
    TRUNCATE TABLE
      bill,
      session,
      booking,
      vehicle,
      port,
      station,
      location,
      ev_user
    RESTART IDENTITY CASCADE;
  `);
  await client.query(`TRUNCATE TABLE connector_type RESTART IDENTITY CASCADE;`);
  await client.query(`
    TRUNCATE TABLE tariff_prediction, tariff
    RESTART IDENTITY CASCADE;
  `);
  console.log("[SEED_ALL_DATA:0] truncate done.");
}

export type SeedAllDataOptions = {
  truncate?: boolean;
};

function isMissingSqlProcedureError(err: unknown, procedureName: string): boolean {
  const e = err as { code?: string; message?: string };
  const msg = String(e?.message ?? "");
  return (
    e?.code === "42883" ||
    (new RegExp(procedureName, "i").test(msg) &&
      (/does not exist/i.test(msg) || /не існує/i.test(msg)))
  );
}


// Функція для запуску повного заповнення даними
export async function SeedAllData(opts: SeedAllDataOptions = {}): Promise<void> {
  const truncate = Boolean(opts.truncate);
  const optionalSql = isSeedOptionalSqlProcedures();

  console.log(`\n[SEED_ALL_DATA] старт (транзакція) — ${SEED_ALL_DATA_STEPS.join(" → ")}\n`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[SEED_ALL_DATA] Потрібен DATABASE_URL у .env");
    throw new Error("Missing DATABASE_URL");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    if (truncate) {
      await truncateAllDemoTables(client);
    }

    const userBulk = getSeedMassiveUserCount();

    console.log(
      `[SEED_ALL_DATA:1] SQL SeedMassiveUsers(${userBulk}) — випадкові ev_user (db/SEED_users.sql)`,
    );
    if (optionalSql) {
      await client.query("SAVEPOINT seed_sp_massive_users");
      try {
        await client.query("CALL SeedMassiveUsers($1)", [userBulk]);
        await client.query("RELEASE SAVEPOINT seed_sp_massive_users");
      } catch (e: unknown) {
        await client.query("ROLLBACK TO SAVEPOINT seed_sp_massive_users");
        if (isMissingSqlProcedureError(e, "SeedMassiveUsers")) {
          console.warn(
            "[WARN] Procedure SeedMassiveUsers() missing — apply db/SEED_users.sql to the database.",
          );
        } else {
          throw e;
        }
      }
    } else {
      await client.query("CALL SeedMassiveUsers($1)", [userBulk]);
    }

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('public.ev_user', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM public.ev_user),
        true
      )
    `);

    console.log("[SEED_ALL_DATA:2] TS — vehicle з CSV (electric_vehicles_spec)");
    await SeedVehiclesFromCsv({ client });

    console.log("[SEED_ALL_DATA:3] TS — location, station, port, connector_type (ev_stations CSV)");
    const { rows: stationRows, filePath: stationsCsvPath } =
      loadDefaultEvStationCsvRows();
    console.log(
      `  stations: ${path.basename(stationsCsvPath)}, рядків: ${stationRows.length}`,
    );
    await SeedEvStationsFromCsv(client, stationRows);

    const days = getTariffSeedDays();

    console.log(
      `[SEED_ALL_DATA:4] Тарифи (DAY+NIGHT, anchor=end, останні ${days} днів)`,
    );
    await SeedTariffsFromApi(days, new Date(), {
      anchor: "end",
      persistDayNight: async (cal, dayPrice, nightPrice) => {
        await upsertTariffDayNightForCalendarDayPg(
          client,
          cal,
          dayPrice,
          nightPrice,
        );
      },
    });

    const bookingCount = getSeedDemoBookingsCount();
    const sessionTarget = getSeedDemoSessionsCount();
    const sessionFromBookingShare = getSeedSessionFromBookingShare();

    console.log(
      `[SEED_ALL_DATA:5] SQL SeedBookingsSessionsBills(bookings=${bookingCount}, sessions=${sessionTarget}, from_booking_share=${sessionFromBookingShare})`,
    );
    /** Без savepoint/«опційного пропуску»: інакше при помилці процедури транзакція все одно дійшла б до COMMIT з уже вставленими станціями. */
    await client.query("CALL SeedBookingsSessionsBills($1, $2, $3)", [
      bookingCount,
      sessionTarget,
      sessionFromBookingShare,
    ]);

    await SyncVehicleSequence(client);
    await SyncLocationStationSequences(client);

    await client.query("COMMIT");
    console.log("[SEED_ALL_DATA] COMMIT — готово.\n");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[SEED_ALL_DATA] ROLLBACK через помилку.");
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

export const SEED_ALL_DATA = SeedAllData;

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href;

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage: npx tsx scripts/seed-all-data.ts [--truncate]
Env (див. scripts/seed/seedEnvConfig.ts та .env.example):
  DATABASE_URL
  ${SEED_ENV.MASSIVE_USER_COUNT} (default ${SEED_ENV_DEFAULTS.MASSIVE_USER_COUNT})
  ${SEED_ENV.DEMO_BOOKINGS_COUNT} (default ${SEED_ENV_DEFAULTS.DEMO_BOOKINGS_COUNT})
  ${SEED_ENV.DEMO_SESSIONS_COUNT} — optional; якщо порожньо, як кількість броней
  ${SEED_ENV.SESSION_FROM_BOOKING_SHARE} (default ${SEED_ENV_DEFAULTS.SESSION_FROM_BOOKING_SHARE}, range 0–1)
  ${SEED_ENV.TARIFF_SEED_DAYS} (default ${SEED_ENV_DEFAULTS.TARIFF_SEED_DAYS}, range 1–366)
  ${SEED_ENV.OPTIONAL_SQL_PROCEDURES}=true — лише для SeedMassiveUsers: пропуск, якщо процедури немає. Помилка SeedBookingsSessionsBills завжди скасовує весь сид (ROLLBACK).`);
    process.exit(0);
  }

  SeedAllData({ truncate: argv.includes("--truncate") }).catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
