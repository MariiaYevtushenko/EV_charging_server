/**
 * SEED_ALL_DATA — один BEGIN … COMMIT: при будь-якій помилці ROLLBACK усіх змін.
 *
 * Порядок: SeedMassiveUsers → vehicle CSV → станції CSV → тарифи → SeedBookingsSessionsBills.
 * Демо-логіни не вставляються (окремо / вручну).
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

/**
 * Повний пайплайн у **одній** транзакції PostgreSQL.
 */
export async function SeedAllData(opts: SeedAllDataOptions = {}): Promise<void> {
  const truncate = Boolean(opts.truncate);

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

    const rawCount = process.env.SEED_MASSIVE_USER_COUNT ?? "1000";
    const massiveCount = Number.parseInt(String(rawCount), 10);
    const userBulk =
      Number.isFinite(massiveCount) && massiveCount >= 0 ? massiveCount : 1000;

    console.log(
      `[SEED_ALL_DATA:1] SQL SeedMassiveUsers(${userBulk}) — випадкові ev_user (db/SEED_users.sql)`,
    );
    // SAVEPOINT: помилка CALL інакше «вбиває» всю зовнішню транзакцію (25P02 на наступних query).
    await client.query("SAVEPOINT seed_sp_massive_users");
    try {
      await client.query("CALL SeedMassiveUsers($1)", [userBulk]);
      await client.query("RELEASE SAVEPOINT seed_sp_massive_users");
    } catch (e: unknown) {
      await client.query("ROLLBACK TO SAVEPOINT seed_sp_massive_users");
      const err = e as { code?: string; message?: string };
      const msg = String(err?.message ?? "");
      const missing =
        err?.code === "42883" ||
        (/SeedMassiveUsers/i.test(msg) &&
          (/does not exist/i.test(msg) || /не існує/i.test(msg)));
      if (missing) {
        console.warn(
          "[WARN] Procedure SeedMassiveUsers() missing — apply db/SEED_users.sql to the database.",
        );
      } else {
        throw e;
      }
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

    const rawDays = process.env.TARIFF_SEED_DAYS ?? "90";
    const tariffDays = Number.parseInt(String(rawDays), 10);
    const days =
      Number.isFinite(tariffDays) && tariffDays >= 1 && tariffDays <= 366
        ? tariffDays
        : 90;

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

    const rawDemoBookings = process.env.SEED_DEMO_BOOKINGS_COUNT ?? "120";
    const demoBookings = Number.parseInt(String(rawDemoBookings), 10);
    const bookingCount =
      Number.isFinite(demoBookings) && demoBookings >= 1 ? demoBookings : 120;

    console.log(
      `[SEED_ALL_DATA:5] SQL SeedBookingsSessionsBills(${bookingCount}) — booking/session/bill`,
    );
    await client.query("SAVEPOINT seed_sp_demo_bookings");
    try {
      await client.query("CALL SeedBookingsSessionsBills($1)", [bookingCount]);
      await client.query("RELEASE SAVEPOINT seed_sp_demo_bookings");
    } catch (e: unknown) {
      await client.query("ROLLBACK TO SAVEPOINT seed_sp_demo_bookings");
      const err = e as { code?: string; message?: string };
      const msg = String(err?.message ?? "");
      const missing =
        err?.code === "42883" ||
        (/SeedBookingsSessionsBills/i.test(msg) &&
          (/does not exist/i.test(msg) || /не існує/i.test(msg)));
      if (missing) {
        console.warn(
          "[WARN] Procedure SeedBookingsSessionsBills() missing — apply db/Seed_demo_bookings_sessions_bills.sql to the database.",
        );
      } else {
        throw e;
      }
    }

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
Env: DATABASE_URL, SEED_MASSIVE_USER_COUNT (default 1000), SEED_DEMO_BOOKINGS_COUNT (default 120), TARIFF_SEED_DAYS (default 90)`);
    process.exit(0);
  }

  SeedAllData({ truncate: argv.includes("--truncate") }).catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
