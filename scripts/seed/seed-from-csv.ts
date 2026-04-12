import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parse } from "csv-parse/sync";
import "dotenv/config";
import type {
  ConnectorCode,
  EvStationCsvRow,
  StationLocationDataFromRow,
} from "./types/evStationsCsv.js";
import {
  InsertLocation,
  InsertPortsForStation,
  InsertStation,
  UpsertConnectorTypesAndLoadIdMap,
} from "./stationSeedInserts.js";
import { SplitStreetHouse, TruncateStr } from "./utils/stringUtils.js";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(SERVER_ROOT, "data");

const STATIONS_CSV_BASE_NAMES = ["ev_stations_2025.csv"] as const;

const SEQ_TABLES = ["location", "station"] as const;
type SeqTable = (typeof SEQ_TABLES)[number];

/** @param {unknown} raw - рядок для мапінгу */
/** @returns {ConnectorCode} */
function MapStationConnectorToken(raw: unknown): ConnectorCode {
  const s = String(raw ?? "").trim();

  if (!s) return "TYPE_2";
  if (/ccs\s*\(\s*type\s*2\s*\)/i.test(s) || /^ccs\s*\(type\s*2\)$/i.test(s))
    return "CCS_2";
  if (/type\s*2\s*\(\s*socket/i.test(s) || /socket\s*only/i.test(s)) 
    return "TYPE_2";
  if (/^type\s*2$/i.test(s)) 
    return "TYPE_2";
  if (/chademo/i.test(s)) 
    return "CHADEMO";
  if (/tesla/i.test(s)) 
    return "TESLA_SUPERCHARGER";
  if (/ccs/i.test(s)) 
    return "CCS_2";

  return "TYPE_2";
}

/** Коди конекторів для одного рядка CSV (колонка 
 * `connector_types`, той самий розбір, що й для портів). */
/** @param {EvStationCsvRow} row - рядок CSV */
/** @returns {ConnectorCode[]} */
function GetConnectorCodes(row: EvStationCsvRow): ConnectorCode[] {
  const typeStr = String(row.connector_types ?? "");
  const tokens = typeStr
    ? typeStr
        .split("|")
        .map((t) => t.trim())
        .filter(Boolean)
    : ["Type 2"];
  return tokens.map(MapStationConnectorToken);
}

/** Унікальні коди `connector_type.name` з колонки `connector_types` 
 * усіх рядків CSV. */
/** @param {EvStationCsvRow[]} rows - рядки CSV */
/** @returns {ConnectorCode[]} - унікальні коди `connector_type.name` з колонки `connector_types` усіх рядків CSV.*/
function CollectConnectorCodes(rows: EvStationCsvRow[]): ConnectorCode[] {
  const set = new Set<ConnectorCode>();
  for (const row of rows) {
    for (const code of GetConnectorCodes(row)) {
      set.add(code);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Розбір id, назви, координат, адреси для `location`/`station`.
 * Повертає `null`, якщо рядок пропускаємо (невалідний id або координати).
 */
function GetLocationDataFromRow( row: EvStationCsvRow,): StationLocationDataFromRow | null {
  const extId = parseInt(String(row.id ?? "").trim(), 10);
  if (!Number.isFinite(extId)) return null;
  const title = TruncateStr(row.title ?? "Station", 100);
  const town = TruncateStr(row.town ?? "Unknown", 100);
  const address = String(row.address ?? row.town ?? "—").trim() || "—";
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const { street, houseNumber } = SplitStreetHouse(address);
  const country = TruncateStr(row.country ?? "UA", 100);

  return {
    extId,
    title,
    town,
    lat,
    lon,
    street,
    houseNumber,
    country,
  };
}

/** Прочитати CSV файл. */
/** @param {string} filePath - шлях до файлу CSV */
/** @returns {EvStationCsvRow[]} */
function ReadFileCsv(filePath: string): EvStationCsvRow[] {
  const buf = fs.readFileSync(filePath, "utf8");
  return parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as EvStationCsvRow[];
}

/** Розв'язати шлях до файлу даних. */
/** @param {readonly string[]} baseNames - масив імен файлів */
/** @returns {string} */
function ResolveDataFile(baseNames: readonly string[]): string {
  for (const name of baseNames) {
    const p = path.join(DATA_DIR, name);
    if (fs.existsSync(p)) 
      return p;
  }
  throw new Error(`None of ${baseNames.join(", ")} found in ${DATA_DIR}`);
}

/** Синхронізація sequence для таблиці. */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
/** @param {SeqTable} table - назва таблиці */
/** @returns {Promise<void>} */
async function SyncSequence(client: pg.Client, table: SeqTable): Promise<void> {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('public.${table}', 'id'),
      (SELECT COALESCE(MAX(id), 1)
      FROM public.${table}),
      true
    )
  `);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[ERROR] Missing DATABASE_URL in environment (.env)");
    process.exit(1);
  }

  const stationsPath = ResolveDataFile(STATIONS_CSV_BASE_NAMES);

  console.log("[LOG] Data directory:", DATA_DIR);
  console.log("  stations:", path.basename(stationsPath));

  const stationRows = ReadFileCsv(stationsPath);

  console.log(`[LOG] Loaded ${stationRows.length} station rows.`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Отримати унікальні коди `connector_type.name` з колонки `connector_types` усіх рядків CSV
    const connectorCodes = CollectConnectorCodes(stationRows);
    if (connectorCodes.length === 0) {
      throw new Error(
        "connector_type: немає жодного коду з ev_stations CSV (connector_types).",
      );
    }

    // Вставити унікальні коди `connector_type.name` в таблицю `connector_type`
    const connectorIdByCode =
      await UpsertConnectorTypesAndLoadIdMap(client, connectorCodes);

    console.log(
      "connector_type (з унікальних значень connector_types у CSV → коди):",
      Object.keys(connectorIdByCode).join(", "),
    );

    let stationDone = 0;

    await client.query("BEGIN");
    for (const row of stationRows) {
      const loc = GetLocationDataFromRow(row);
      if (loc == null) continue;

      const locationId = await InsertLocation(client, {
        lon: loc.lon,
        lat: loc.lat,
        country: loc.country,
        city: loc.town,
        street: loc.street,
        houseNumber: loc.houseNumber,
      });
      if (locationId == null) continue;

      await InsertStation(client, {
        stationId: loc.extId,
        locationId,
        name: loc.title,
      });

      const numPorts = Math.max(
        1,
        parseInt(String(row.num_connectors ?? "1"), 10) || 1,
      );
      const rowConnectorCodes = GetConnectorCodes(row);

      await InsertPortsForStation(client, {
        stationId: loc.extId,
        numPorts,
        connectorCodes: rowConnectorCodes,
        connectorIdByCode,
      });

      stationDone++;
      if (stationDone % 500 === 0) {
        console.log(`  Stations seeded: ${stationDone}/${stationRows.length}`);
      }
    }
    await client.query("COMMIT");
    await SyncSequence(client, "location");
    await SyncSequence(client, "station");
    console.log(
      `Stations seeded: ${stationDone}/${stationRows.length} (ports created per num_connectors).`,
    );

    console.log(
      "Done. Повний порядок користувачів/авто — npm run seed:all (seed-all-data.mjs).",
    );
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
