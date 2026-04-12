/**
 * SEED_ALL_DATA — порядок повного демо-сиду:
 *
 *   1. SQL: CALL SeedMassiveUsers()   — ev_user (db/Seed_procedures.sql)
 *   2. TS: scripts/seed/seed-vehicles-from-csv.ts — vehicle з electric_vehicles_spec CSV (1–5 на USER)
 *   3. TS: scripts/seed/seed-from-csv.ts           — location, station, port, connector_type (ev_stations CSV)
 *   4. TS: scripts/seed/seed-tariffs-from-api.ts   — тарифи за останні 60 днів
 *   5. SQL: CALL RandomizeAfterCsv()  — db/Randomize_after_csv_seed.sql
 *
 * При --truncate на початку одноразово очищуються таблиці демо-даних (без затиску користувачів/авто
 * між кроками 1–3: truncate виконується до кроку 1).
*/
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

/** Порядок кроків для документації / логів */
export const SEED_ALL_DATA_STEPS = [
  "0_optional_truncate",
  "1_sql_seed_massive_users",
  "2_seed_vehicles_from_csv",
  "3_seed_from_csv_stations",
  "4_seed_tariffs_api",
  "5_sql_randomize_after_csv",
];

/** Повне очищення перед повторним сидом (опція --truncate у seed-all-data). */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
async function TruncateAllDemoTables(client) {
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

/** @param {string} cmd - команда для запуску */
/** @param {string[]} args - аргументи для команди */
/** @returns {Promise<void>} */
function RunNode(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: SERVER_ROOT,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) 
        resolve();
      else 
      reject(new Error(`Command failed with exit code ${code}`));

    });
  });
}

/**
 * Повний пайплайн: користувачі → авто → станції/порти → тарифи → рандомізація.
 * @param {{ truncate?: boolean }} opts - опції для сиду
 */
export async function SeedAllData(opts = {}) {
  const truncate = Boolean(opts.truncate);

  const tsxCli = path.join(SERVER_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxCli)) {
    throw new Error("[ERROR] tsx not found. Run: npm install (in server/)");
  }

  const csvScript = path.join(SERVER_ROOT, "scripts", "seed", "seed-from-csv.ts");
  const vehiclesScript = path.join(
    SERVER_ROOT,
    "scripts",
    "seed",
    "seed-vehicles-from-csv.ts",
  );
  const tariffScript = path.join(
    SERVER_ROOT,
    "scripts",
    "seed",
    "seed-tariffs-from-api.ts",
  );

  console.log(`\n[SEED_ALL_DATA] [LOG] старт (${SEED_ALL_DATA_STEPS.join(" → ")})\n`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[SEED_ALL_DATA] Потрібен DATABASE_URL у .env");
    throw new Error("Missing DATABASE_URL");
  }

  const { Client } = pg;
  const sqlClient = new Client({ connectionString: databaseUrl });
  await sqlClient.connect();

  try {
    if (truncate) {
      await TruncateAllDemoTables(sqlClient);
    }

    const rawCount = process.env.SEED_MASSIVE_USER_COUNT ?? "1000";
    const massiveCount = Number.parseInt(String(rawCount), 10);
    const userBulk =
      Number.isFinite(massiveCount) && massiveCount >= 0 ? massiveCount : 1000;

    console.log(
      `[SEED_ALL_DATA:1] SQL SeedMassiveUsers(${userBulk}) — ev_user (db/Seed_procedures.sql)`,
    );
    try {
      await sqlClient.query("CALL SeedMassiveUsers($1)", [userBulk]);
    } catch (e) {
      const err = /** @type {{ code?: string; message?: string }} */ (e);
      const msg = String(err?.message ?? "");
      const missing =
        err?.code === "42883" ||
        (/SeedMassiveUsers/i.test(msg) &&
          (/does not exist/i.test(msg) || /не існує/i.test(msg)));
      if (missing) {
        console.warn(
          "[WARN] Procedure SeedMassiveUsers() missing — apply db/Seed_procedures.sql to the database.",
        );
      } else {
        throw e;
      }
    }

    await sqlClient.query(`
      SELECT setval(
        pg_get_serial_sequence('public.ev_user', 'id'),
        (SELECT COALESCE(MAX(id), 1) FROM public.ev_user),
        true
      )
    `);
  } finally {
    await sqlClient.end().catch(() => {});
  }

  console.log("[SEED_ALL_DATA:2] TS — vehicle з CSV (electric_vehicles_spec)");
  await RunNode(process.execPath, [tsxCli, vehiclesScript]);

  console.log("[SEED_ALL_DATA:3] TS — location, station, port, connector_type (ev_stations CSV)");
  await RunNode(process.execPath, [tsxCli, csvScript]);

  console.log("[SEED_ALL_DATA:4] Тарифи (останні 60 днів)");
  await RunNode(process.execPath, [tsxCli, tariffScript]);

  const sqlClient2 = new Client({ connectionString: databaseUrl });
  await sqlClient2.connect();
  try {
    console.log(
      "[SEED_ALL_DATA:5] SQL RandomizeAfterCsv — station/port/vehicle/ev_user",
    );
    try {
      await sqlClient2.query("CALL RandomizeAfterCsv()");
    } catch (e) {
      const err = /** @type {{ code?: string; message?: string }} */ (e);
      const msg = String(err?.message ?? "");
      const missing =
        err?.code === "42883" ||
        (/RandomizeAfterCsv/i.test(msg) &&
          (/does not exist/i.test(msg) || /не існує/i.test(msg)));
      if (missing) {
        console.warn(
          "[WARN] Procedure RandomizeAfterCsv() missing — apply db/Randomize_after_csv_seed.sql to the database.",
        );
      } else {
        throw e;
      }
    }
  } finally {
    await sqlClient2.end();
  }

  console.log("[SEED_ALL_DATA] готово.\n");
}

/** @type {typeof SeedAllData} */
export const SEED_ALL_DATA = SeedAllData;

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`[LOG] Usage: node scripts/seed-all-data.mjs [--truncate]
[LOG] Env: DATABASE_URL, SEED_MASSIVE_USER_COUNT (default 1000)`);
    process.exit(0);
  }

  SeedAllData({ truncate: argv.includes("--truncate") }).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
