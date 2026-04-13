/**
 * INSERT-операції для сиду станцій: connector_type, location, station, port.
 */
import type { Client } from "pg";

import type { ConnectorCode } from "./types/evStationsCsv.js";

/** Значення `port_status` у БД (db/EV_Charging_DB.sql). */
export type PortStatusDb = "FREE" | "BOOKED" | "USED" | "REPAIRED";

/**
 * Статус порту для сиду CSV: порт 1 і 3+ — FREE; порт 2 — BOOKED / USED / REPAIRED / FREE
 * залежно від `station_id` (детерміновано, без випадковості).
 */
export function portStatusForCsvSeed(
  stationId: number,
  portNumber: number,
): PortStatusDb {
  if (portNumber !== 2) return "FREE";
  switch (Math.abs(stationId) % 4) {
    case 0:
      return "BOOKED";
    case 1:
      return "USED";
    case 2:
      return "REPAIRED";
    default:
      return "FREE";
  }
}

/** `station_status` у db/EV_Charging_DB.sql (узгоджено з Prisma StationStatus без ARCHIVED у чистому DDL). */
export type StationStatusDb = "WORK" | "NO_CONNECTION" | "FIX";

/**
 * Для демо потрібна більшість станцій у WORK (інакше SeedBookings не знайде порти).
 * ~80% WORK, по ~10% NO_CONNECTION та FIX (детерміновано від id).
 */
export function stationStatusForCsvSeed(stationId: number): StationStatusDb {
  const m = Math.abs(stationId) % 10;
  if (m < 8) return "WORK";
  if (m === 8) return "NO_CONNECTION";
  return "FIX";
}

/** Діапазон кВт для випадкового `port.max_power` (узгоджено з DECIMAL(5,2) у схемі). */
export const PORT_MAX_POWER_KW_MIN = 11;
export const PORT_MAX_POWER_KW_MAX = 150;

/** Випадкова потужність порту кВт (два знаки після коми). */
/** @returns {number} */
export function randomPortMaxPowerKw(): number {
  const x =
    PORT_MAX_POWER_KW_MIN +
    Math.random() * (PORT_MAX_POWER_KW_MAX - PORT_MAX_POWER_KW_MIN);
  return Math.round(x * 100) / 100;
}

/**
 * Вставляє унікальні коди в `connector_type`, підвантажує id усіх рядків таблиці (транзакція).
 */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
/** @param {readonly ConnectorCode[]} connectorCodes - коди конекторів */
/** @returns {Promise<Record<string, number>>} */
export async function UpsertConnectorTypesAndLoadIdMap(
  client: Client,
  connectorCodes: readonly ConnectorCode[],
): Promise<Record<string, number>> {
  const placeholders = connectorCodes.map((_, i) => `($${i + 1})`).join(", ");

  await client.query(
    `INSERT INTO connector_type (name)
    VALUES ${placeholders}
    ON CONFLICT (name) DO NOTHING`,
    [...connectorCodes],
  );

  const conectorResult = await client.query<{ id: number; name: string }>(
    `SELECT id, name
    FROM connector_type
    ORDER BY id`,
  );
  const connectorIdByCode: Record<string, number> = Object.fromEntries(
    conectorResult.rows.map((r) => [r.name, r.id]),
  );

  return connectorIdByCode;
}

/** Вставка одного рядка `location`, повертає `id` або `null`. */
/** `point` у тому ж порядку, що й у `stationWriteService.insertLocation`: (lat, lng). */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
/** @param {Object} params - параметри вставки */
/** @param {number} params.lon - довгота */
/** @param {number} params.lat - широта */
/** @param {string} params.country - країна */
/** @param {string} params.city - місто */
/** @param {string} params.street - вулиця */
/** @param {string} params.houseNumber - номер будинку */
/** @returns {Promise<number | null>} */
export async function InsertLocation(
  client: Client,
  params: {
    lon: number;
    lat: number;
    country: string;
    city: string;
    street: string;
    houseNumber: string;
  },
): Promise<number | null> {
  const locIns = await client.query<{ id: number }>(
    `
    INSERT INTO location (coordinates, country, city, street, house_number)
    VALUES (point($1::double precision, $2::double precision), $3, $4, $5, $6)
    RETURNING id
  `,
    [ params.lat, params.lon, params.country, params.city, params.street, params.houseNumber ],
  );
  return locIns.rows[0]?.id ?? null;
}

/** Вставка одного рядка `station` з явним `id` (як у датасеті). */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
/** @param {Object} params - параметри вставки */
/** @param {number} params.stationId - id станції */
/** @param {number} params.locationId - id локації */
/** @param {string} params.name - назва станції */
/** @param {StationStatusDb} params.status - статус станції */
/** @returns {Promise<void>} */
export async function InsertStation(
  client: Client,
  params: { stationId: number; locationId: number; name: string; status: StationStatusDb },
): Promise<void> {
  await client.query(
    `
    INSERT INTO station (id, location_id, name, status)
    VALUES ($1, $2, $3, $4::station_status)
    ON CONFLICT (id) DO UPDATE SET
      location_id = EXCLUDED.location_id,
      name = EXCLUDED.name,
      status = EXCLUDED.status,
      updated_at = now()
  `,
    [params.stationId, params.locationId, params.name, params.status],
  );
}

/** Порти станції: циклічно по `connectorCodes`, `port_number` 1..numPorts; `max_power` — випадковий на кожен порт. */
/** @param {import("pg").Client} client - клієнт PostgreSQL */
/** @param {Object} params - параметри вставки */
/** @param {number} params.stationId - id станції */
/** @param {number} params.numPorts - кількість портів */
/** @param {readonly ConnectorCode[]} params.connectorCodes - коди конекторів */
/** @param {Record<string, number>} params.connectorIdByCode - мапа id конекторів */
/** @returns {Promise<void>} */
export async function InsertPortsForStation(
  client: Client,
  params: {
    stationId: number;
    numPorts: number;
    connectorCodes: readonly ConnectorCode[];
    connectorIdByCode: Record<string, number>;
  },
): Promise<void> {
  const codes = params.connectorCodes.length > 0 ? params.connectorCodes : ["TYPE_2"] as const;

  for (let p = 1; p <= params.numPorts; p++) {
    const cat = codes[(p - 1) % codes.length]!;
    const ctId = params.connectorIdByCode[cat] ?? params.connectorIdByCode["TYPE_2"] ?? 0;

    const maxPowerKw = randomPortMaxPowerKw();
    const status = portStatusForCsvSeed(params.stationId, p);

    await client.query(
      `
      INSERT INTO port (station_id, port_number, max_power, connector_type_id, status)
      VALUES ($1, $2, $3, $4, $5::port_status)
      ON CONFLICT (station_id, port_number) DO UPDATE SET
        max_power = EXCLUDED.max_power,
        connector_type_id = EXCLUDED.connector_type_id,
        status = EXCLUDED.status,
        updated_at = now()
    `,
      [params.stationId, p, maxPowerKw, ctId, status],
    );
  }
}
