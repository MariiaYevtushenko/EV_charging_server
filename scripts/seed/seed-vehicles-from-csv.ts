/**
 * Сид таблиці `vehicle` з data/electric_vehicles_spec_*.csv після того, як у БД вже є `ev_user`
 *
 * Usage (з каталогу server/):
 *   npx tsx scripts/seed/seed-vehicles-from-csv.ts
 *
 * Requires DATABASE_URL in .env
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parse } from "csv-parse/sync";
import "dotenv/config";

import type {
  CsvVehicleRow,
  SeedVehiclesFromCsvResult,
} from "./types/vehicleSpecCsv.js";
import { TruncateStr } from "./utils/stringUtils.js";
import { resolveDataFile as resolveDataFileFromDirs } from "./resolveDataFile.js";
import {
  createSeedMarkTimer,
  seedError,
  seedLog,
  seedNowIso,
  seedWarn,
} from "./seedLog.js";

export type { SeedVehiclesFromCsvResult } from "./types/vehicleSpecCsv.js";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..", "..");

const VEHICLE_SPEC_CSV_BASE_NAMES = [
  "electric_vehicles_spec_2025.csv",
  "electric_vehicles_spec_2025.csv.csv",
];

const UA_PLATE_LETTERS = Array.from("АВЕІКМНОРСТУХ");

/** Випадковий номер у стилі українського реєстраційного знака (8 символів). */
/** @returns {string} */
export function GenerateLicensePlate(): string {
  const pick = () =>
    UA_PLATE_LETTERS[Math.floor(Math.random() * UA_PLATE_LETTERS.length)]!;

  const digits = String(Math.floor(Math.random() * 10000)).padStart(4, "0");

  return `${pick()}${pick()}${digits}${pick()}${pick()}`;
}

/** Згенерувати номер, якого ще немає в `vehicle.license_plate`. */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
/** @param {number} [maxAttempts] - максимальна кількість спроб */
/** @returns {Promise<string>} */
async function RandomUkrainePlate(
  client: pg.Client,
  maxAttempts = 10,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const plate = GenerateLicensePlate();

    const r = await client.query(
      `SELECT 1
      FROM vehicle
      WHERE license_plate = $1
      LIMIT 1`,
      [plate],
    );
    if (r.rows.length === 0) return plate;
  }
  throw new Error(
    "[ERROR] uniqueRandomUkrainePlate: не вдалося згенерувати унікальний номер за кількість спроб",
  );
}

/** Згенерувати випадкову ємність батареї від 10 до 120 кВт·год. */
/** @returns {number} */
function GetRandomBatteryCapacity(): number {
  return 10 + Math.floor(Math.random() * 110);
}

function ResolveDataFile(baseNames: readonly string[]): string {
  return resolveDataFileFromDirs(SERVER_ROOT, baseNames);
}

/** Прочитати CSV файл. */
/** @param {string} filePath - шлях до файлу CSV */
/** @returns {CsvVehicleRow[]} */
function ReadCsv(filePath: string): CsvVehicleRow[] {
  const buf = fs.readFileSync(filePath, "utf8");

  const raw = parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as CsvVehicleRow[];

  return raw;
}

/** Синхронізація sequence для таблиці vehicle для автоматичного збільшення id. */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
/** @returns {Promise<void>} */
export async function SyncVehicleSequence(client: pg.Client): Promise<void> {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('public.vehicle', 'id'),
      (SELECT COALESCE(MAX(id), 1) 
      FROM public.vehicle),
      true
    )
  `);
}

export type SeedVehiclesFromCsvOptions = {
  /**
   * Зовнішній клієнт у відкритій транзакції: не створює з’єднання,
   * не виконує внутрішній BEGIN/COMMIT.
   */
  client?: pg.Client;
};

/** Сид таблиці `vehicle` з data/electric_vehicles_spec_*.csv після того, як у БД вже є `ev_user`. */
/** @returns {Promise<SeedVehiclesFromCsvResult>} */
export async function SeedVehiclesFromCsv(
  options?: SeedVehiclesFromCsvOptions,
): Promise<SeedVehiclesFromCsvResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl && options?.client == null) {
    throw new Error("[ERROR] Missing DATABASE_URL in environment (.env)");
  }

  const vehiclesPath = ResolveDataFile(VEHICLE_SPEC_CSV_BASE_NAMES);
  const timer = createSeedMarkTimer("SEED_VEHICLES_CSV");
  seedLog("SEED_VEHICLES_CSV", "старт SeedVehiclesFromCsv", {
    csv: path.basename(vehiclesPath),
    external_tx: options?.client != null,
  });

  const rows = ReadCsv(vehiclesPath);

  if (rows.length === 0) {
    seedWarn("SEED_VEHICLES_CSV", "CSV порожній — вихід без змін.");
    return { inserted: 0, skippedUsers: 0, specRows: 0 };
  }

  const ownClient = options?.client == null;
  const client =
    options?.client ?? new Client({ connectionString: databaseUrl! });
  if (ownClient) await client.connect();
  timer.mark(ownClient ? "pg.Client підключено" : "використовується зовнішній client");

  let inserted = 0;
  let skippedUsers = 0;

  try {
    const usersRes = await client.query<{ id: number }>(
      `SELECT id
      FROM ev_user
      WHERE role = 'USER'::user_role
      ORDER BY id`,
    );
    const userIds = usersRes.rows.map((r) => r.id);
    const n = rows.length;
    seedLog("SEED_VEHICLES_CSV", "контекст", {
      spec_rows_in_csv: n,
      user_role_USER_count: userIds.length,
    });
    timer.mark("вибірка ev_user (USER) завершена");

    const runInserts = async () => {
      let specIdx = 0;
      let usersProcessed = 0;

      for (const uid of userIds) {
        usersProcessed++;
        if (usersProcessed % 200 === 0) {
          seedLog("SEED_VEHICLES_CSV", "прогрес прив’язки авто до USER", {
            users_processed: usersProcessed,
            of_users: userIds.length,
            inserted_so_far: inserted,
            skipped_users_so_far: skippedUsers,
          });
        }

        const hasVehicle = await client.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c
          FROM vehicle
          WHERE user_id = $1`,
          [uid],
        );

        const existing = hasVehicle.rows[0]?.c ?? 0;

        if (existing > 0) {
          skippedUsers++;
          continue;
        }

        const count = 1 + Math.floor(Math.random() * 5);

        for (let v = 0; v < count; v++) {
          const row = rows[specIdx % n]!;
          specIdx++;

          const brand = TruncateStr(row.brand ?? "Unknown", 50);
          const model = TruncateStr(row.model ?? "EV", 50);
          const battery = Number(
            row.battery_capacity_kWh ??
              row.battery_capacity_kwh ??
              GetRandomBatteryCapacity(),
          );
          const plate = TruncateStr(await RandomUkrainePlate(client), 20);

          await client.query(
            `
          INSERT INTO vehicle (user_id, license_plate, brand, model, battery_capacity)
          VALUES ($1, $2, $3, $4, $5::numeric)
          ON CONFLICT (license_plate) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            brand = EXCLUDED.brand,
            model = EXCLUDED.model,
            battery_capacity = EXCLUDED.battery_capacity
        `,
            [uid, plate, brand, model, Number.isFinite(battery) ? battery : 50],
          );
          inserted++;
        }
      }
    };

    if (ownClient) {
      seedLog("SEED_VEHICLES_CSV", "BEGIN (внутрішня транзакція)");
      await client.query("BEGIN");
      try {
        await runInserts();
        await client.query("COMMIT");
        seedLog("SEED_VEHICLES_CSV", "COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {
          seedError("SEED_VEHICLES_CSV", "ROLLBACK не вдався (критично для цілісності БД).", e);
        });
        throw e;
      }
    } else {
      seedLog("SEED_VEHICLES_CSV", "вставки в межах зовнішньої транзакції (без внутрішнього BEGIN/COMMIT)");
      await runInserts();
    }

    timer.mark("вставки vehicle завершено");
    await SyncVehicleSequence(client);
    timer.mark("SyncVehicleSequence (setval)");
    seedLog("SEED_VEHICLES_CSV", "готово", {
      inserted,
      skipped_users_with_existing_vehicle: skippedUsers,
      csv_file: path.basename(vehiclesPath),
      spec_rows: n,
      total_ms: timer.elapsedMs(),
      finished_at: seedNowIso(),
    });
    return { inserted, skippedUsers, specRows: n };
  } finally {
    if (ownClient) await client.end();
  }
}

const argv1 = process.argv[1];
const isMain =
  argv1 !== undefined && path.resolve(argv1) === path.resolve(__filename);

if (isMain) {
  SeedVehiclesFromCsv(undefined).catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
