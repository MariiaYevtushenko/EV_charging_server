/**
 * Seed PostgreSQL from CSV files in ./server/data/
 *
 * Usage (from server/):
 *   node scripts/seed-from-csv.mjs
 *   node scripts/seed-from-csv.mjs --truncate   # TRUNCATE seed tables first (destructive)
 * CSV + тарифи за 60 днів лише з кнопки в UI (ALLOW_DEV_SEED) або явно: npm run seed:all
 *
 * Requires DATABASE_URL in .env (same as Prisma).
 *
 * Що наповнюється з CSV:
 *   - location, station, port — з data/ev_stations_2025.csv (id станції як у датасеті)
 *   - ev_user — унікальні User ID з data/ev_charging_patterns.csv (функція seedEvUsersFromPatterns)
 *   - vehicle — ті ж користувачі + data/electric_vehicles_spec_2025.csv (див. seedVehiclesFromPatternUsers)
 *
 * Довідник connector_type (коди конекторів) вставляється тут, бо port посилається на нього — не з CSV.
 * Тарифи з API — не через npm run seed; див. npm run seed:all або кнопку демо. Бронювання, сесії, рахунки — окремо (SQL).
 *
 * ---------------------------------------------------------------------------
 * Reference schema (from DB_script.MD / Prisma) — create tables before seeding:
 * ---------------------------------------------------------------------------
 *
 * CREATE TYPE user_role AS ENUM ('ADMIN', 'STATION_ADMIN', 'USER');
 * ...
 * -- + tables: ev_user, location, station, connector_type, port, vehicle, tariff,
 * --   booking, session, bill, ... (see prisma/schema.prisma or DB_script.MD)
 *
 * ---------------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { parse } from "csv-parse/sync";
import "dotenv/config";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(SERVER_ROOT, "data");

const PLACEHOLDER_HASH =
  "$2b$10$seed.placeholder.hash.for.demo.only.not.a.real.bcrypt.12";

function truncateStr(s, max) {
  if (s == null) return "";
  const t = String(s).trim();
  return t.length <= max ? t : t.slice(0, max);
}

/** Same idea as client splitStreetHouse */
function splitStreetHouse(address) {
  const t = String(address ?? "").trim() || "—";
  const m = t.match(/^(.+?)\s+(\d+[a-zA-Zа-яА-ЯіІїЇєЄ/\-]*)$/u);
  if (m) return { street: truncateStr(m[1].trim(), 100), houseNumber: truncateStr(m[2], 10) };
  return { street: truncateStr(t, 100), houseNumber: "1" };
}

function mapStationConnectorToken(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "TYPE_2";
  if (/ccs\s*\(\s*type\s*2\s*\)/i.test(s) || /^ccs\s*\(type\s*2\)$/i.test(s)) return "CCS_2";
  if (/type\s*2\s*\(\s*socket/i.test(s) || /socket\s*only/i.test(s)) return "TYPE_2";
  if (/^type\s*2$/i.test(s)) return "TYPE_2";
  if (/chademo/i.test(s)) return "CHADEMO";
  if (/tesla/i.test(s)) return "TESLA_SUPERCHARGER";
  if (/ccs/i.test(s)) return "CCS_2";
  return "TYPE_2";
}

function parseUserNumericId(cell) {
  const s = String(cell ?? "").trim();
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function findVehicleSpec(rows, vehicleModelStr) {
  const norm = String(vehicleModelStr ?? "").trim().toLowerCase();
  if (!norm) return null;
  for (const row of rows) {
    const model = String(row.model ?? "").trim().toLowerCase();
    const brand = String(row.brand ?? "").trim().toLowerCase();
    const full = `${brand} ${model}`.trim();
    if (norm === full || norm === model) return row;
  }
  for (const row of rows) {
    const model = String(row.model ?? "").trim().toLowerCase();
    if (norm.includes(model) || model.includes(norm)) return row;
  }
  return null;
}

function readCsv(filePath) {
  const buf = fs.readFileSync(filePath, "utf8");
  return parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });
}

function resolveDataFile(baseNames) {
  for (const name of baseNames) {
    const p = path.join(DATA_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`None of ${baseNames.join(", ")} found in ${DATA_DIR}`);
}

function uniqueUserKeysToVehicleModelFromPatterns(patterns) {
  const userKeyToModel = new Map();
  for (const row of patterns) {
    const uid = String(row["User ID"] ?? row["User_ID"] ?? "").trim();
    if (!uid || /^user\s*id$/i.test(uid)) continue;
    const model = String(row["Vehicle Model"] ?? "").trim();
    if (!userKeyToModel.has(uid)) userKeyToModel.set(uid, model);
  }
  return userKeyToModel;
}

const SEQ_TABLES = ["location", "station", "ev_user", "vehicle"];

async function syncSequence(client, table) {
  if (!SEQ_TABLES.includes(table)) return;
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('public.${table}', 'id'),
      (SELECT COALESCE(MAX(id), 1) FROM public.${table}),
      true
    )
  `);
}

/**
 * Створює рядки `ev_user` для унікальних ключів з `ev_charging_patterns.csv`
 * (демо email / телефон за номером з User ID).
 *
 * @param {import("pg").Client} client
 * @param {Map<string, string>} userKeyToModel — User ID → Vehicle Model (потрібен лише набір ключів)
 * @returns {Promise<Map<string, number>>} userKey → ev_user.id
 */
async function seedEvUsersFromPatterns(client, userKeyToModel) {
  const userKeyToEvUserId = new Map();
  await client.query("BEGIN");
  try {
    for (const [userKey] of userKeyToModel) {
      const num = parseUserNumericId(userKey);
      const email = `user_${num}@seed.local`;
      const phone = `+38000${String(num).padStart(6, "0").slice(-6)}`;

      const ins = await client.query(
        `
        INSERT INTO ev_user (name, surname, email, phone_number, password_hash, role)
        VALUES ($1, $2, $3, $4, $5, 'USER'::user_role)
        ON CONFLICT (email) DO UPDATE SET
          surname = EXCLUDED.surname,
          phone_number = EXCLUDED.phone_number
        RETURNING id
      `,
        ["User", String(num), email, phone, PLACEHOLDER_HASH]
      );
      userKeyToEvUserId.set(userKey, ins.rows[0].id);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
  await syncSequence(client, "ev_user");
  return userKeyToEvUserId;
}

/**
 * Створює `vehicle` для користувачів із патернів; батарея/потужність з electric_vehicles_spec
 * або з колонки патерну.
 *
 * @param {import("pg").Client} client
 * @param {Map<string, number>} userKeyToEvUserId
 * @param {Map<string, string>} userKeyToModel
 * @param {Record<string, string>[]} patterns
 * @param {Record<string, unknown>[]} vehicleSpecs
 * @returns {Promise<Map<string, { evUserId: number, vehicleId: number, vehicleModel: string, brand: string, model: string, plate: string }>>}
 */
async function seedVehiclesFromPatternUsers(
  client,
  userKeyToEvUserId,
  userKeyToModel,
  patterns,
  vehicleSpecs
) {
  const userIdMap = new Map();
  await client.query("BEGIN");
  try {
    for (const [userKey, vehicleModel] of userKeyToModel) {
      const evUserId = userKeyToEvUserId.get(userKey);
      if (evUserId == null) continue;

      const num = parseUserNumericId(userKey);
      const spec = findVehicleSpec(vehicleSpecs, vehicleModel);
      const firstPatternRow = patterns.find(
        (r) => String(r["User ID"] ?? "").trim() === userKey
      );
      const battery = spec
        ? Number(spec.battery_capacity_kWh ?? spec.battery_capacity_kwh ?? 50)
        : Number(firstPatternRow?.["Battery Capacity (kWh)"] ?? 50);
      const power = spec
        ? Number(spec.fast_charging_power_kw_dc ?? spec.fast_charging_power_kw ?? 11)
        : 11;
      const parts = String(vehicleModel).trim().split(/\s+/);
      const brand = truncateStr(parts[0] ?? "Unknown", 50);
      const model = truncateStr(parts.slice(1).join(" ") || parts[0] || "EV", 50);
      const plate = truncateStr(`S${String(num).padStart(5, "0")}UA`, 20);

      const vIns = await client.query(
        `
        INSERT INTO vehicle (user_id, license_plate, brand, model, battery_capacity, power_rate)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (license_plate) DO UPDATE SET
          model = EXCLUDED.model,
          battery_capacity = EXCLUDED.battery_capacity,
          power_rate = EXCLUDED.power_rate
        RETURNING id
      `,
        [evUserId, plate, brand, model, battery, power]
      );
      const vehicleId = vIns.rows[0].id;

      userIdMap.set(userKey, { evUserId, vehicleId, vehicleModel, brand, model, plate });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
  await syncSequence(client, "vehicle");
  return userIdMap;
}

async function main() {
  const args = process.argv.slice(2);
  const doTruncate = args.includes("--truncate");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL in environment (.env)");
    process.exit(1);
  }

  const vehiclesPath = resolveDataFile([
    "electric_vehicles_spec_2025.csv",
    "electric_vehicles_spec_2025.csv.csv",
  ]);
  const patternsPath = resolveDataFile(["ev_charging_patterns.csv"]);
  const stationsPath = resolveDataFile(["ev_stations_2025.csv"]);

  console.log("Data directory:", DATA_DIR);
  console.log("  vehicles:", path.basename(vehiclesPath));
  console.log("  patterns:", path.basename(patternsPath));
  console.log("  stations:", path.basename(stationsPath));

  const vehicleSpecs = readCsv(vehiclesPath);
  const patterns = readCsv(patternsPath);
  const stationRows = readCsv(stationsPath);

  console.log(
    `Loaded ${vehicleSpecs.length} vehicle spec rows, ${patterns.length} charging patterns, ${stationRows.length} stations.`
  );

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    if (doTruncate) {
      console.log("Truncating seed tables (CASCADE)...");
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
      console.log("Truncate done.");
    }

    // --- connector_type (FK для port; не з CSV) ---
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO connector_type (name) VALUES
        ('TYPE_2'),
        ('CCS_2'),
        ('CHADEMO'),
        ('TESLA_SUPERCHARGER')
      ON CONFLICT (name) DO NOTHING;
    `);
    const ctRes = await client.query(
      `SELECT id, name FROM connector_type ORDER BY id`
    );
    const connectorIdByCode = Object.fromEntries(ctRes.rows.map((r) => [r.name, r.id]));
    await client.query("COMMIT");
    console.log("connector_type ready:", Object.keys(connectorIdByCode).join(", "));

    // --- stations + locations + ports (ev_stations_2025.csv) ---
    let stationDone = 0;

    await client.query("BEGIN");
    for (const row of stationRows) {
      const extId = parseInt(String(row.id ?? "").trim(), 10);
      if (!Number.isFinite(extId)) continue;
      const title = truncateStr(row.title ?? "Station", 100);
      const town = truncateStr(row.town ?? "Unknown", 100);
      const address = String(row.address ?? row.town ?? "—").trim() || "—";
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const { street, houseNumber } = splitStreetHouse(address);

      const locIns = await client.query(
        `
        INSERT INTO location (coordinates, city, street, house_number)
        VALUES (point($1::double precision, $2::double precision), $3, $4, $5)
        RETURNING id
      `,
        [lon, lat, town, street, houseNumber]
      );
      const locationId = locIns.rows[0].id;

      await client.query(
        `
        INSERT INTO station (id, location_id, name, status)
        VALUES ($1, $2, $3, 'WORK'::station_status)
      `,
        [extId, locationId, title]
      );

      const numPorts = Math.max(1, parseInt(String(row.num_connectors ?? "1"), 10) || 1);
      const typeStr = String(row.connector_types ?? "");
      const tokens = typeStr
        ? typeStr.split("|").map((t) => t.trim()).filter(Boolean)
        : ["Type 2"];
      const mapped = tokens.map(mapStationConnectorToken);

      for (let p = 1; p <= numPorts; p++) {
        const cat = mapped[(p - 1) % mapped.length];
        const ctId = connectorIdByCode[cat] ?? connectorIdByCode.TYPE_2;
        await client.query(
          `
          INSERT INTO port (station_id, port_number, max_power, connector_type_id, status)
          VALUES ($1, $2, $3, $4, 'FREE'::port_status)
        `,
          [extId, p, 22.0, ctId]
        );
      }

      stationDone++;
      if (stationDone % 500 === 0) {
        console.log(`  Stations seeded: ${stationDone}/${stationRows.length}`);
      }
    }
    await client.query("COMMIT");
    await syncSequence(client, "location");
    await syncSequence(client, "station");
    console.log(`Stations seeded: ${stationDone}/${stationRows.length} (ports created per num_connectors).`);

    const userKeyToModel = uniqueUserKeysToVehicleModelFromPatterns(patterns);

    const userKeyToEvUserId = await seedEvUsersFromPatterns(client, userKeyToModel);
    console.log(`seedEvUsersFromPatterns: ${userKeyToEvUserId.size} users.`);

    const userIdMap = await seedVehiclesFromPatternUsers(
      client,
      userKeyToEvUserId,
      userKeyToModel,
      patterns,
      vehicleSpecs
    );
    console.log(`seedVehiclesFromPatternUsers: ${userIdMap.size} vehicles.`);

    console.log("Done.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
