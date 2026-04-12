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

export type { SeedVehiclesFromCsvResult } from "./types/vehicleSpecCsv.js";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(SERVER_ROOT, "data");

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

/** Розв'язати шлях до файлу даних. */
/** @param {readonly string[]} baseNames - масив імен файлів */
/** @returns {string} */
function ResolveDataFile(baseNames: readonly string[]): string {
  for (const name of baseNames) {
    const p = path.join(DATA_DIR, name);

    if (fs.existsSync(p)) return p;
  }
  throw new Error(`None of ${baseNames.join(", ")} found in ${DATA_DIR}`);
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
async function SyncVehicleSequence(client: pg.Client): Promise<void> {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('public.vehicle', 'id'),
      (SELECT COALESCE(MAX(id), 1) 
      FROM public.vehicle),
      true
    )
  `);
}

/** Сид таблиці `vehicle` з data/electric_vehicles_spec_*.csv після того, як у БД вже є `ev_user`. */
/** @returns {Promise<SeedVehiclesFromCsvResult>} */
export async function SeedVehiclesFromCsv(): Promise<SeedVehiclesFromCsvResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("[ERROR] Missing DATABASE_URL in environment (.env)");
  }

  const vehiclesPath = ResolveDataFile(VEHICLE_SPEC_CSV_BASE_NAMES);

  const rows = ReadCsv(vehiclesPath);

  if (rows.length === 0) {
    console.warn("seed-vehicles-from-csv: CSV порожній, пропуск.");
    return { inserted: 0, skippedUsers: 0, specRows: 0 };
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

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

    await client.query("BEGIN");
    try {
      let specIdx = 0;

      for (const uid of userIds) {
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
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {
        console.error("[ERROR] ROLLBACK failed");
      });
      throw e;
    }

    await SyncVehicleSequence(client);
    console.log(
      `[INFO] seed-vehicles-from-csv: ${inserted} авто з ${path.basename(vehiclesPath)}; користувачів з уже наявним авто (пропуск): ${skippedUsers}.`,
    );
    return { inserted, skippedUsers, specRows: n };
  } finally {
    await client.end();
  }
}

const argv1 = process.argv[1];
const isMain =
  argv1 !== undefined && path.resolve(argv1) === path.resolve(__filename);

if (isMain) {
  SeedVehiclesFromCsv().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
