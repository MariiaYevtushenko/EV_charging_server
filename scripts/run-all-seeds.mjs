/**
 * Підряд: seed-from-csv.mjs → seed-tariffs-from-api.ts → CALL seed_sql_randomize_after_csv()
 * (останні 60 днів тарифів; SQL-рандомізація station/port/vehicle/ev_user — див. db/Randomize_after_csv_seed.sql).
 * Викликається з кнопки «Демо» в UI (POST /api/dev/seed-from-csv) або вручну: npm run seed:all
 * (щоб npm run seed не тягнув тарифи/API без явного наміру).
 *
 * Usage (з каталогу server/):
 *   node scripts/run-all-seeds.mjs
 *   node scripts/run-all-seeds.mjs --truncate
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: SERVER_ROOT,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with exit code ${code}`));
    });
  });
}

const argv = process.argv.slice(2);
const truncate = argv.includes("--truncate");

const tsxCli = path.join(SERVER_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
if (!fs.existsSync(tsxCli)) {
  console.error("tsx not found. Run: npm install (in server/)");
  process.exit(1);
}

const csvScript = path.join(SERVER_ROOT, "scripts", "seed-from-csv.mjs");
const tariffScript = path.join(SERVER_ROOT, "scripts", "seed-tariffs-from-api.ts");

try {
  console.log("--- CSV seed (location, station, port, ev_user, vehicle) ---");
  await run(process.execPath, truncate ? [csvScript, "--truncate"] : [csvScript]);

  console.log("--- Tariff seed (last 60 calendar days) ---");
  await run(process.execPath, [tsxCli, tariffScript]);

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const { Client } = pg;
    const sqlClient = new Client({ connectionString: databaseUrl });
    await sqlClient.connect();
    try {
      console.log("--- SQL randomize after CSV (ev_user, station, port, vehicle) ---");
      await sqlClient.query("CALL seed_sql_randomize_after_csv()");
    } catch (e) {
      const err = /** @type {{ code?: string; message?: string }} */ (e);
      const msg = String(err?.message ?? "");
      const missing =
        err?.code === "42883" ||
        (/seed_sql_randomize_after_csv/i.test(msg) &&
          (/does not exist/i.test(msg) || /не існує/i.test(msg)));
      if (missing) {
        console.warn(
          "Procedure seed_sql_randomize_after_csv() missing — apply db/Randomize_after_csv_seed.sql to the database."
        );
      } else {
        throw e;
      }
    } finally {
      await sqlClient.end();
    }
  } else {
    console.warn("DATABASE_URL not set — skipped SQL randomize step.");
  }

  console.log("All seeds finished.");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
