
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import "dotenv/config";

import { SeedTariffsFromApi } from "../src/services/forecast/tariffIngestService.js";
import { loadDefaultEvStationCsvRows, SeedEvStationsFromCsv, SyncLocationStationSequences } from "./seed/seed-from-csv.js";
import { SeedVehiclesFromCsv, SyncVehicleSequence } from "./seed/seed-vehicles-from-csv.js";
import { upsertTariffDayNightForCalendarDayPg } from "./seed/tariffUpsertPg.js";
import {
  calendarDayFromDateKeyLocal,
  readTariffSeedSnapshotFile,
  resolveTariffSeedSnapshotPathForIO,
} from "./seed/tariffSeedSnapshot.js";
import {
  getSeedDemoBookingsCount,
  getSeedDemoBookingsDaysBack,
  getSeedDemoSessionsCount,
  getSeedMassiveUserCount,
  getSeedSessionFromBookingShare,
  getTariffSeedDays,
  isSeedOptionalSqlProcedures,
  SEED_ENV,
  SEED_ENV_DEFAULTS,
} from "./seed/seedEnvConfig.js";
import {
  createSeedMarkTimer,
  formatSeedPgError,
  logSeedFailureForDevelopers,
  seedError,
  seedLog,
  seedNowIso,
  seedWarn,
} from "./seed/seedLog.js";
import { exportTariffSeedSnapshotFromDbAfterSeed } from "./seed/exportTariffSeedSnapshotFromDb.js";

const { Client } = pg;

function safeDatabaseUrlHint(url: string): string {
  try {
    const u = new URL(url);
    const port = u.port || (u.protocol === "postgresql:" ? "5432" : "");
    return `${u.protocol}//${u.hostname}${port ? `:${port}` : ""}${u.pathname}`;
  } catch {
    return "(не вдалося розібрати DATABASE_URL)";
  }
}

const __filename = fileURLToPath(import.meta.url);

export const SEED_ALL_DATA_STEPS = [
  "0_optional_truncate",
  "1_seed_tariffs_api",
  "2_sql_seed_massive_users",
  "3_seed_vehicles_from_csv",
  "4_seed_from_csv_stations",
  "5_sql_demo_bookings_sessions_bills",
] as const;

async function truncateAllDemoTables(client: pg.Client): Promise<void> {
  seedLog("SEED_ALL_DATA:0", "TRUNCATE демо-таблиць (CASCADE)…");
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
  seedLog("SEED_ALL_DATA:0", "truncate done.");
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
  const timer = createSeedMarkTimer("SEED_ALL_DATA");

  seedLog(
    "SEED_ALL_DATA",
    `старт (одна транзакція PostgreSQL) — кроки: ${SEED_ALL_DATA_STEPS.join(" → ")}`,
    {
      truncate,
      optional_sql_procedures: optionalSql,
      SEED_OPTIONAL_SQL_PROCEDURES: process.env[SEED_ENV.OPTIONAL_SQL_PROCEDURES] ?? "(unset)",
    },
  );

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    const e = new Error("Missing DATABASE_URL");
    seedError("SEED_ALL_DATA", "Потрібен DATABASE_URL у .env", e);
    logSeedFailureForDevelopers(e, "перевірки конфігурації");
    throw e;
  }

  seedLog("SEED_ALL_DATA", "підключення до БД", {
    database_url_hint: safeDatabaseUrlHint(databaseUrl),
  });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  timer.mark("pg.Client підключено");

  try {
    await client.query("BEGIN");
    timer.mark("BEGIN (транзакція відкрита)");

    if (truncate) {
      await truncateAllDemoTables(client);
      timer.mark("крок 0: truncate завершено");
    }

    const days = getTariffSeedDays();
    /** Одна «якірна» дата для кроку тарифів і для експорту снапшота після COMMIT (узгоджені діапазони). */
    const tariffSeedRangeDate = new Date();

    seedLog("SEED_ALL_DATA:1", "SeedTariffsFromApi + upsert у транзакцію (перший крок після truncate)", {
      anchor: "end",
      tariff_seed_days: days,
      TARIFF_API_URL_set: Boolean(process.env.TARIFF_API_URL?.trim()),
      TARIFF_SEED_USE_SNAPSHOT_FIRST:
        process.env.TARIFF_SEED_USE_SNAPSHOT_FIRST ?? "(unset)",
      TARIFF_SEED_FETCH_CONCURRENCY:
        process.env.TARIFF_SEED_FETCH_CONCURRENCY ?? "(default 6)",
    });
    const tariffResult = await SeedTariffsFromApi(days, tariffSeedRangeDate, {
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
    const tariffCounts = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM public.tariff`,
    );
    timer.mark("крок 1 завершено (тарифи)", {
      days_written: tariffResult.daysWritten,
      mode: tariffResult.mode,
      tariff_rows_total: Number(tariffCounts.rows[0]?.c ?? 0),
    });

    const userBulk = getSeedMassiveUserCount();

    seedLog("SEED_ALL_DATA:2", `CALL SeedMassiveUsers(${userBulk})`, {
      sql_file: "db/SEED_users.sql",
    });
    if (optionalSql) {
      await client.query("SAVEPOINT seed_sp_massive_users");
      try {
        await client.query("CALL SeedMassiveUsers($1)", [userBulk]);
        await client.query("RELEASE SAVEPOINT seed_sp_massive_users");
        seedLog("SEED_ALL_DATA:2", "SeedMassiveUsers OK (savepoint released)");
      } catch (e: unknown) {
        await client.query("ROLLBACK TO SAVEPOINT seed_sp_massive_users");
        if (isMissingSqlProcedureError(e, "SeedMassiveUsers")) {
          seedWarn(
            "SEED_ALL_DATA:2",
            "Процедура SeedMassiveUsers() відсутня — застосуйте db/SEED_users.sql; крок пропущено (ROLLBACK TO SAVEPOINT).",
            formatSeedPgError(e),
          );
        } else {
          throw e;
        }
      }
    } else {
      await client.query("CALL SeedMassiveUsers($1)", [userBulk]);
      seedLog("SEED_ALL_DATA:2", "SeedMassiveUsers OK");
    }

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('public.ev_user', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM public.ev_user),
        true
      )
    `);
    const evUserCount = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM public.ev_user`,
    );
    timer.mark("крок 2 завершено (ev_user)", {
      ev_user_total: Number(evUserCount.rows[0]?.c ?? 0),
    });

    seedLog("SEED_ALL_DATA:3", "SeedVehiclesFromCsv (electric_vehicles_spec CSV)");
    const vehiclesResult = await SeedVehiclesFromCsv({ client });
    timer.mark("крок 3 завершено (vehicle)", {
      vehicles_inserted: vehiclesResult.inserted,
      vehicles_skipped_users: vehiclesResult.skippedUsers,
      vehicle_spec_rows: vehiclesResult.specRows,
    });

    seedLog("SEED_ALL_DATA:4", "SeedEvStationsFromCsv (ev_stations CSV)");
    const { rows: stationRows, filePath: stationsCsvPath } =
      loadDefaultEvStationCsvRows();
    seedLog("SEED_ALL_DATA:4", "файл станцій", {
      file: path.basename(stationsCsvPath),
      csv_rows: stationRows.length,
    });
    const stationSeed = await SeedEvStationsFromCsv(client, stationRows);
    const locStPort = await client.query<{
      locations: string;
      stations: string;
      ports: string;
      connectors: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM public.location) AS locations,
        (SELECT COUNT(*)::text FROM public.station) AS stations,
        (SELECT COUNT(*)::text FROM public.port) AS ports,
        (SELECT COUNT(*)::text FROM public.connector_type) AS connectors
    `);
    const row = locStPort.rows[0];
    timer.mark("крок 4 завершено (станції)", {
      stations_seeded_this_run: stationSeed.stationDone,
      ports_inserted_this_run: stationSeed.portsInserted,
      csv_skipped_invalid: stationSeed.skippedInvalidCsvRow,
      csv_skipped_location: stationSeed.skippedInsertLocationFailed,
      location_total: Number(row?.locations ?? 0),
      station_total: Number(row?.stations ?? 0),
      port_total: Number(row?.ports ?? 0),
      connector_type_total: Number(row?.connectors ?? 0),
    });

    const bookingCount = getSeedDemoBookingsCount();
    const sessionTarget = getSeedDemoSessionsCount();
    const sessionFromBookingShare = getSeedSessionFromBookingShare();
    const bookingsDaysBack = getSeedDemoBookingsDaysBack();

    const { rows: tariffCountRows } = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM public.tariff`,
    );
    const tariffRowCount = Number(tariffCountRows[0]?.c ?? 0);
    const minTariffRowsForDemo =
      2 * Math.min(getSeedDemoBookingsDaysBack(), getTariffSeedDays()) + 4;
    let tariffRowsUpsertedFromSnapshot = 0;
    if (tariffRowCount < minTariffRowsForDemo) {
      const snapPath = resolveTariffSeedSnapshotPathForIO();
      const doc = await readTariffSeedSnapshotFile(snapPath);
      const rows =
        doc != null && typeof doc === "object" && "rows" in doc
          ? (doc as { rows: unknown }).rows
          : null;
      if (Array.isArray(rows) && rows.length > 0) {
        seedLog(
          "SEED_ALL_DATA:5",
          "перед демо-SQL: upsert тарифів з tariff_seed_snapshot.json у public.tariff (pg, мало рядків)",
          {
            tariff_rows_before: tariffRowCount,
            min_expected_about: minTariffRowsForDemo,
            snapshot_rows: rows.length,
            snapshot_path: snapPath,
          },
        );
        for (const item of rows) {
          if (item == null || typeof item !== "object") continue;
          const r = item as Record<string, unknown>;
          const dateKey = r["date"];
          const dayRaw = r["day"];
          const nightRaw = r["night"];
          if (typeof dateKey !== "string") continue;
          const day = typeof dayRaw === "number" ? dayRaw : Number(dayRaw);
          const night = typeof nightRaw === "number" ? nightRaw : Number(nightRaw);
          if (!Number.isFinite(day) || !Number.isFinite(night)) continue;
          const cal = calendarDayFromDateKeyLocal(dateKey);
          await upsertTariffDayNightForCalendarDayPg(client, cal, day, night);
          tariffRowsUpsertedFromSnapshot += 1;
        }
      }
    }

    seedLog("SEED_ALL_DATA:5", "CALL SeedBookingsSessionsBills", {
      bookings: bookingCount,
      sessions: sessionTarget,
      from_booking_share: sessionFromBookingShare,
      bookings_days_back: bookingsDaysBack,
      sql_file: "db/Seed_demo_bookings_sessions_bills.sql",
      tariff_calendar_days_upserted_from_snapshot: tariffRowsUpsertedFromSnapshot,
    });
    /** Без savepoint/«опційного пропуску»: інакше при помилці процедури транзакція все одно дійшла б до COMMIT з уже вставленими станціями. */
    await client.query(
      "CALL SeedBookingsSessionsBills($1::int, $2::int, $3::numeric, $4::int)",
      [bookingCount, sessionTarget, sessionFromBookingShare, bookingsDaysBack],
    );
    const demoCounts = await client.query<{
      b: string;
      s: string;
      bi: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM public.booking) AS b,
        (SELECT COUNT(*)::text FROM public.session) AS s,
        (SELECT COUNT(*)::text FROM public.bill) AS bi
    `);
    const d = demoCounts.rows[0];
    timer.mark("крок 5 завершено", {
      booking_total: Number(d?.b ?? 0),
      session_total: Number(d?.s ?? 0),
      bill_total: Number(d?.bi ?? 0),
    });

    seedLog("SEED_ALL_DATA", "синхронізація sequences (vehicle, location, station)");
    await SyncVehicleSequence(client);
    await SyncLocationStationSequences(client);
    timer.mark("setval для sequences виконано");

    await client.query("COMMIT");
    seedLog("SEED_ALL_DATA", "COMMIT — усі кроки успішно зафіксовані в БД", {
      total_ms: timer.elapsedMs(),
      finished_at: seedNowIso(),
    });

    try {
      const snap = await exportTariffSeedSnapshotFromDbAfterSeed(client, {
        days,
        anchor: "end",
        rangeDate: tariffSeedRangeDate,
      });
      seedLog("SEED_ALL_DATA", "tariff_seed_snapshot.json оновлено з таблиці tariff", {
        path: snap.path,
        rows: snap.rows,
      });
    } catch (e) {
      seedWarn("SEED_ALL_DATA", "Не вдалося записати tariff_seed_snapshot.json після COMMIT (БД уже збережена).", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    seedError(
      "SEED_ALL_DATA",
      "ROLLBACK через помилку (зміни на цьому з’єднанні скасовано).",
      e,
    );
    logSeedFailureForDevelopers(e, "повного сиду (seed-all-data)");
    throw e;
  } finally {
    await client.end().catch(() => {});
    seedLog("SEED_ALL_DATA", "pg.Client закрито");
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
  ${SEED_ENV.TARIFF_SEED_DAYS} (default ${SEED_ENV_DEFAULTS.TARIFF_SEED_DAYS}, range 1–1200; тарифи з API)
  TARIFF_SEED_FETCH_CONCURRENCY — паралельні HTTP для ENTSO-E / TARIFF_API_PER_DAY (деф. 6)
  ENTSOE_SEED_SEQUENTIAL=true — старий послідовний ENTSO-E + ENTSOE_SEED_DELAY_MS
  TARIFF_SEED_USE_SNAPSHOT_FIRST=false — примусово з API; за замовчуванням (змінна не задана) спочатку JSON (strict або loose по датах)
  TARIFF_SEED_SNAPSHOT_PATH — шлях до JSON (інакше scripts/seed/data/tariff_seed_snapshot.json)
  TARIFF_SEED_WRITE_SNAPSHOT=false — не перезаписувати снапшот під час збору з API (після COMMIT seed-all-data снапшот усе одно оновлюється з БД)
  ${SEED_ENV.OPTIONAL_SQL_PROCEDURES}=true — лише для SeedMassiveUsers: пропуск, якщо процедури немає. Помилка SeedBookingsSessionsBills завжди скасовує весь сид (ROLLBACK).`);
    process.exit(0);
  }

  SeedAllData({ truncate: argv.includes("--truncate") }).catch(() => {
    /* Деталі вже в stderr у catch SeedAllData (logSeedFailureForDevelopers) */
    process.exitCode = 1;
  });
}
