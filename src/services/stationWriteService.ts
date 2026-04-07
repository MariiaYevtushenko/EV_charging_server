import prisma from "../prisma.config.js";
import type { PrismaClient } from "../../generated/prisma/index.js";
import type { StationStatus } from "../../generated/prisma/index.js";
import { stationRepository } from "../db/stationRepository.js";
import { parseConnectorCategory } from "../utils/connectorCategory.js";
import { parseStationStatus } from "../utils/stationUiStatus.js";
import { stationService } from "./stationService.js";

export type PortInput = {
  portNumber: number;
  maxPower: number;
  connectorCategory: string;
};

export type CreateStationInput = {
  name: string;
  city: string;
  street: string;
  houseNumber: string;
  lat: number;
  lng: number;
  status: StationStatus;
  ports: PortInput[];
};

export type UpdateStationInput = {
  name: string;
  city: string;
  street: string;
  houseNumber: string;
  lat: number;
  lng: number;
  status: StationStatus;
  ports?: PortInput[];
};

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

async function insertLocation(
  tx: Tx,
  lat: number,
  lng: number,
  city: string,
  street: string,
  houseNumber: string
): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
    `INSERT INTO location (coordinates, city, street, house_number)
     VALUES (point($1::float8, $2::float8), $3, $4, $5)
     RETURNING id`,
    lat,
    lng,
    city,
    street,
    houseNumber
  );
  const id = rows[0]?.id;
  if (id == null) throw new Error("location insert failed");
  return id;
}

async function updateLocation(
  tx: Tx,
  locationId: number,
  lat: number,
  lng: number,
  city: string,
  street: string,
  houseNumber: string
): Promise<void> {
  await tx.$executeRawUnsafe(
    `UPDATE location SET coordinates = point($1::float8, $2::float8), city = $3, street = $4, house_number = $5 WHERE id = $6`,
    lat,
    lng,
    city,
    street,
    houseNumber,
    locationId
  );
}

async function syncPorts(tx: Tx, stationId: number, ports: PortInput[]): Promise<void> {
  const existing = await tx.port.findMany({
    where: { stationId },
    select: { portNumber: true },
  });
  const newNums = new Set(ports.map((p) => p.portNumber));
  for (const e of existing) {
    if (!newNums.has(e.portNumber)) {
      await tx.port.delete({
        where: {
          stationId_portNumber: { stationId, portNumber: e.portNumber },
        },
      });
    }
  }
  for (const p of ports) {
    const name = parseConnectorCategory(p.connectorCategory);
    const ct = await tx.connectorType.findUnique({ where: { name } });
    if (!ct) throw new Error(`connector type ${name} not found`);
    await tx.port.upsert({
      where: {
        stationId_portNumber: { stationId, portNumber: p.portNumber },
      },
      create: {
        stationId,
        portNumber: p.portNumber,
        maxPower: p.maxPower,
        connectorTypeId: ct.id,
      },
      update: {
        maxPower: p.maxPower,
        connectorTypeId: ct.id,
      },
    });
  }
}

const db = prisma as unknown as PrismaClient;

export const stationWriteService = {
  async createStation(input: CreateStationInput) {
    const newId = await db.$transaction(async (tx) => {
      const locationId = await insertLocation(
        tx,
        input.lat,
        input.lng,
        input.city,
        input.street,
        input.houseNumber
      );
      const station = await tx.station.create({
        data: {
          locationId,
          name: input.name,
          status: input.status,
        },
      });
      if (input.ports.length > 0) {
        await syncPorts(tx, station.id, input.ports);
      }
      return station.id;
    });
    return stationService.getStationDashboard(newId);
  },

  async updateStation(stationId: number, input: UpdateStationInput) {
    const row = await stationRepository.findByIdWithPorts(stationId);
    if (!row) return null;

    await db.$transaction(async (tx) => {
      await updateLocation(
        tx,
        row.locationId,
        input.lat,
        input.lng,
        input.city,
        input.street,
        input.houseNumber
      );
      await tx.station.update({
        where: { id: stationId },
        data: { name: input.name, status: input.status },
      });
      if (input.ports !== undefined) {
        await syncPorts(tx, stationId, input.ports);
      }
    });

    return stationService.getStationDashboard(stationId);
  },
};

/** Розбір тіла POST / PUT з клієнта */
export function parseCreateStationBody(body: Record<string, unknown>): CreateStationInput {
  const name = String(body["name"] ?? "").trim();
  const city = String(body["city"] ?? "").trim();
  const street = String(body["street"] ?? "").trim();
  const houseNumber = String(body["houseNumber"] ?? "").trim() || "1";
  const lat = Number(body["lat"]);
  const lng = Number(body["lng"]);
  const status = parseStationStatus(body["status"]);
  const portsRaw = body["ports"];
  const ports: PortInput[] = Array.isArray(portsRaw)
    ? portsRaw.map((p, idx) => {
        const o = p as Record<string, unknown>;
        const portNumber = Number(o["portNumber"] ?? idx + 1);
        const maxPower = Number(o["maxPower"]);
        const connectorCategory = String(o["connectorCategory"] ?? "Type 2");
        return {
          portNumber: Number.isFinite(portNumber) ? portNumber : idx + 1,
          maxPower: Number.isFinite(maxPower) ? maxPower : 22,
          connectorCategory,
        };
      })
    : [];

  if (!name) throw new Error("name is required");
  if (!city) throw new Error("city is required");
  if (!street) throw new Error("street is required");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("lat and lng must be numbers");

  return { name, city, street, houseNumber, lat, lng, status, ports };
}

export function parseUpdateStationBody(body: Record<string, unknown>): UpdateStationInput {
  const name = String(body["name"] ?? "").trim();
  const city = String(body["city"] ?? "").trim();
  const street = String(body["street"] ?? "").trim();
  const houseNumber = String(body["houseNumber"] ?? "").trim() || "1";
  const lat = Number(body["lat"]);
  const lng = Number(body["lng"]);
  const status = parseStationStatus(body["status"]);
  if (!name) throw new Error("name is required");
  if (!city) throw new Error("city is required");
  if (!street) throw new Error("street is required");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("lat and lng must be numbers");

  let ports: PortInput[] | undefined;
  if (Object.prototype.hasOwnProperty.call(body, "ports")) {
    const portsRaw = body["ports"];
    ports = Array.isArray(portsRaw)
      ? portsRaw.map((p, idx) => {
          const o = p as Record<string, unknown>;
          const portNumber = Number(o["portNumber"] ?? idx + 1);
          const maxPower = Number(o["maxPower"]);
          const connectorCategory = String(o["connectorCategory"] ?? "Type 2");
          return {
            portNumber: Number.isFinite(portNumber) ? portNumber : idx + 1,
            maxPower: Number.isFinite(maxPower) ? maxPower : 22,
            connectorCategory,
          };
        })
      : [];
  }

  return ports !== undefined
    ? { name, city, street, houseNumber, lat, lng, status, ports }
    : { name, city, street, houseNumber, lat, lng, status };
}
