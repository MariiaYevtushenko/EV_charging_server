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
  stationStatusForCsvSeed,
  UpsertConnectorTypesAndLoadIdMap,
} from "./stationSeedInserts.js";
import { SplitStreetHouse, TruncateStr } from "./utils/stringUtils.js";
import { getDataSearchDirs, resolveDataFile as resolveDataFileFromDirs } from "./resolveDataFile.js";
import {
  createSeedMarkTimer,
  seedError,
  seedLog,
  seedNowIso,
  seedWarn,
} from "./seedLog.js";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..", "..");

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

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) 
    return null;

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

function ResolveDataFile(baseNames: readonly string[]): string {
  return resolveDataFileFromDirs(SERVER_ROOT, baseNames);
}

/** Синхронізація sequence для таблиці. */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
/** @param {SeqTable} table - назва таблиці */
/** @returns {Promise<void>} */
export async function SyncLocationStationSequences(client: pg.Client): Promise<void> {
  await SyncSequence(client, "location");
  await SyncSequence(client, "station");
}

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

/** Рядки CSV за шляхом за замовчуванням (ev_stations_2025.csv у server/data або server/CSV_data). */
export function loadDefaultEvStationCsvRows(): {
  rows: EvStationCsvRow[];
  filePath: string;
} {
  const stationsPath = ResolveDataFile(STATIONS_CSV_BASE_NAMES);
  const stationRows = ReadFileCsv(stationsPath);
  return { rows: stationRows, filePath: stationsPath };
}

/**
 * Вставка location / station / port / connector_type з уже прочитаного CSV.
 * Без BEGIN/COMMIT — викликати всередині транзакції батька.
 */
export type SeedEvStationsFromCsvResult = {
  stationDone: number;
  skippedInvalidCsvRow: number;
  skippedInsertLocationFailed: number;
  portsInserted: number;
  csvRowCount: number;
  uniqueConnectorCodes: number;
};

export async function SeedEvStationsFromCsv(
  client: pg.Client,
  stationRows: EvStationCsvRow[],
): Promise<SeedEvStationsFromCsvResult> {
  const csvRowCount = stationRows.length;
  const timer = createSeedMarkTimer("SEED_STATIONS_CSV");
  seedLog("SEED_STATIONS_CSV", "старт SeedEvStationsFromCsv", {
    csv_rows: csvRowCount,
  });

  const connectorCodes = CollectConnectorCodes(stationRows);
  if (connectorCodes.length === 0) {
    throw new Error(
      "connector_type: немає жодного коду з ev_stations CSV (connector_types).",
    );
  }

  const connectorIdByCode =
    await UpsertConnectorTypesAndLoadIdMap(client, connectorCodes);
  timer.mark("UpsertConnectorTypesAndLoadIdMap");

  seedLog("SEED_STATIONS_CSV", "connector_type з CSV (унікальні коди)", {
    codes: Object.keys(connectorIdByCode).join(", "),
    count: connectorCodes.length,
  });

  let stationDone = 0;
  let skippedInvalidCsvRow = 0;
  let skippedInsertLocationFailed = 0;
  let portsInserted = 0;

  for (const row of stationRows) {
    const loc = GetLocationDataFromRow(row);

    if (loc == null) {
      skippedInvalidCsvRow++;
      continue;
    }

    const locationId = await InsertLocation(client, {
      lon: loc.lon,
      lat: loc.lat,
      country: loc.country,
      city: loc.town,
      street: loc.street,
      houseNumber: loc.houseNumber,
    });

    if (locationId == null) {
      skippedInsertLocationFailed++;
      continue;
    }

    await InsertStation(client, {
      stationId: loc.extId,
      locationId,
      name: loc.title,
      status: stationStatusForCsvSeed(loc.extId),
    });

    const numPorts = Math.max(1, parseInt(String(row.num_connectors ?? "1"), 10) || 1);
    const rowConnectorCodes = GetConnectorCodes(row);

    await InsertPortsForStation(client, {
      stationId: loc.extId,
      numPorts,
      connectorCodes: rowConnectorCodes,
      connectorIdByCode,
    });
    portsInserted += numPorts;

    stationDone++;
    if (stationDone % 500 === 0) {
      seedLog("SEED_STATIONS_CSV", "прогрес вставки станцій", {
        stationDone,
        csv_rows: csvRowCount,
        ports_so_far: portsInserted,
      });
    }
  }

  timer.mark("цикл CSV завершено");
  seedLog("SEED_STATIONS_CSV", "підсумок SeedEvStationsFromCsv", {
    stations_inserted: stationDone,
    csv_rows: csvRowCount,
    skipped_invalid_row: skippedInvalidCsvRow,
    skipped_location_insert: skippedInsertLocationFailed,
    ports_inserted: portsInserted,
    unique_connector_codes: connectorCodes.length,
    ms: timer.elapsedMs(),
  });

  if (skippedInvalidCsvRow > 0) {
    seedWarn("SEED_STATIONS_CSV", "рядки CSV пропущено (невалідний id/lat/lon)", {
      skipped_invalid_row: skippedInvalidCsvRow,
    });
  }
  if (skippedInsertLocationFailed > 0) {
    seedWarn("SEED_STATIONS_CSV", "рядки пропущено після InsertLocation (locationId=null)", {
      skipped_location_insert: skippedInsertLocationFailed,
    });
  }

  return {
    stationDone,
    skippedInvalidCsvRow,
    skippedInsertLocationFailed,
    portsInserted,
    csvRowCount,
    uniqueConnectorCodes: connectorCodes.length,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    seedError("SEED_FROM_CSV", "Missing DATABASE_URL in environment (.env)");
    process.exit(1);
  }

  const timer = createSeedMarkTimer("SEED_FROM_CSV");
  seedLog("SEED_FROM_CSV", "старт npm run seed (лише станції з CSV)", {
    database_hint: (() => {
      try {
        const u = new URL(databaseUrl);
        const port = u.port || (u.protocol === "postgresql:" ? "5432" : "");
        return `${u.protocol}//${u.hostname}${port ? `:${port}` : ""}${u.pathname}`;
      } catch {
        return "(parse error)";
      }
    })(),
  });

  const { rows: stationRows, filePath: stationsPath } = loadDefaultEvStationCsvRows();

  seedLog("SEED_FROM_CSV", "джерело даних", {
    csv_path: stationsPath,
    search_dirs: getDataSearchDirs(SERVER_ROOT).join(" | "),
    loaded_rows: stationRows.length,
  });
  timer.mark("CSV прочитано з диска");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  timer.mark("PostgreSQL підключено");

  try {
    seedLog("SEED_FROM_CSV", "BEGIN (одна транзакція: станції + setval sequences)");
    await client.query("BEGIN");
    const summary = await SeedEvStationsFromCsv(client, stationRows);
    timer.mark("SeedEvStationsFromCsv завершено", {
      stations_inserted: summary.stationDone,
      ports_inserted: summary.portsInserted,
    });

    seedLog("SEED_FROM_CSV", "SyncLocationStationSequences (location, station)");
    await SyncLocationStationSequences(client);
    timer.mark("sequences синхронізовано");

    await client.query("COMMIT");
    seedLog(
      "SEED_FROM_CSV",
      "COMMIT — дані зафіксовано. Для повного пайплайну (користувачі, авто, тарифи, демо-транзакції) використовуйте npm run seed:all.",
      { total_ms: timer.elapsedMs(), finished_at: seedNowIso() },
    );
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    seedError(
      "SEED_FROM_CSV",
      "ROLLBACK через помилку (станції в цій транзакції не збережені).",
      e,
    );
    process.exitCode = 1;
  } finally {
    await client.end();
    seedLog("SEED_FROM_CSV", "pg.Client закрито");
  }
}

/** Лише при прямому `tsx scripts/seed/seed-from-csv.ts` / `npm run seed` — не при імпорті з `seed-all-data.ts`. */
const argv1 = process.argv[1];
const isMainSeedFromCsv =
  argv1 !== undefined && path.resolve(argv1) === path.resolve(__filename);

if (isMainSeedFromCsv) {
  void main();
}
