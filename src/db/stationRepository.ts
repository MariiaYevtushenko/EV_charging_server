import prisma from "../prisma.config.js";
import type { PrismaClient, Station, StationStatus } from "../../generated/prisma/index.js";


const db = prisma as unknown as PrismaClient;

const stationInclude = {
  location: {
    select: {
      id: true,
      country: true,
      city: true,
      street: true,
      houseNumber: true,
    },
  },
  ports: {
    include: { connectorType: true },
    orderBy: { portNumber: "asc" as const },
  },
} as const;

export const stationRepository = {
  async findByIdWithPorts(id: number) {
    return db.station.findUnique({
      where: { id },
      include: stationInclude,
    });
  },

  async findAll() {
    return db.station.findMany({
      include: stationInclude,
      orderBy: { id: "asc" },
    });
  },

  /** Координати з `point` (lat, lng у тому ж порядку, що й у INSERT). */
  async getLocationCoords(locationId: number): Promise<{ lat: number; lng: number } | null> {
    const rows = await db.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
      `SELECT (coordinates)[0]::float8 AS lat, (coordinates)[1]::float8 AS lng FROM location WHERE id = $1`,
      locationId
    );
    const r = rows[0];
    if (!r) return null;
    return { lat: Number(r.lat), lng: Number(r.lng) };
  },

  async getLocationCoordsBatch(
    locationIds: number[]
  ): Promise<Map<number, { lat: number; lng: number }>> {
    const ids = [...new Set(locationIds)].filter((id) => Number.isFinite(id));
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRawUnsafe<Array<{ id: number; lat: number; lng: number }>>(
      `SELECT id, (coordinates)[0]::float8 AS lat, (coordinates)[1]::float8 AS lng FROM location WHERE id IN (${ids.join(",")})`
    );
    const m = new Map<number, { lat: number; lng: number }>();
    for (const r of rows) {
      m.set(r.id, { lat: Number(r.lat), lng: Number(r.lng) });
    }
    return m;
  },

  async createStation(station: Station): Promise<Station> {
    return await db.station.create({
      data: station,
    });
  },

  async updateStation(stationId: number, station: Station): Promise<Station> {
    return await db.station.update({
      where: { id: stationId },
      data: station,
    });
  },
  
  async archiveStation(stationId: number): Promise<Station> {
    return await db.station.update({
      where: { id: stationId },
      data: { status: "ARCHIVED" },
    });
  },

  async unarchiveStation(stationId: number): Promise<Station> {
    return await db.station.update({
      where: { id: stationId },
      data: { status: "WORK" },
    });
  },
  
  async updateStationStatus(stationId: number, status: StationStatus): Promise<Station> {
    return await db.station.update({
      where: { id: stationId }, 
      data: { status: status },
    });
  },

};
