import prisma from "../prisma.config.js";
import type { PrismaClient, Station, StationStatus } from "../../generated/prisma/index.js";


const db = prisma as unknown as PrismaClient;

const locationSelect = {
  id: true,
  country: true,
  city: true,
  street: true,
  houseNumber: true,
} as const;

const stationInclude = {
  location: {
    select: locationSelect,
  },
  ports: {
    include: { connectorType: true },
    orderBy: { portNumber: "asc" as const },
  },
} as const;

const stationMapInclude = {
  location: {
    select: locationSelect,
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

  /** Усі станції з локацією, без портів — для карти (десятки тисяч рядків). */
  async findAllWithLocationOnly() {
    return db.station.findMany({
      include: stationMapInclude,
      orderBy: { id: "asc" },
    });
  },

  async countStations(): Promise<number> {
    return db.station.count();
  },

  async findManyPaginated(skip: number, take: number) {
    return db.station.findMany({
      include: stationInclude,
      orderBy: { id: "asc" },
      skip,
      take,
    });
  },

  /** Міста з локацій, де є хоча б одна станція (для фільтрів у UI). */
  async getDistinctCitiesForStations(): Promise<string[]> {
    const rows = await db.$queryRaw<Array<{ city: string }>>`
      SELECT DISTINCT l.city AS city
      FROM location l
      INNER JOIN station s ON s.location_id = l.id
      ORDER BY l.city ASC
    `;
    return rows.map((r) => r.city);
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

  /** Станції в прямокутнику lat/lng (point у БД: [0]=lat, [1]=lng). Обмеження limit — захист від «світу» на одному зумі. */
  async findIdsWithLocationInBounds(
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
    limit: number,
  ): Promise<
    Array<{
      id: number;
      name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
      location_id: number;
      country: string;
      city: string;
      street: string;
      house_number: string;
      lat: number;
      lng: number;
      connector_codes: string[] | null;
    }>
  > {
    const rows = await db.$queryRawUnsafe<
      Array<{
        id: number;
        name: string;
        status: string;
        created_at: Date;
        updated_at: Date;
        location_id: number;
        country: string;
        city: string;
        street: string;
        house_number: string;
        lat: number;
        lng: number;
        connector_codes: string[] | null;
      }>
    >(
      `SELECT
        s.id,
        s.name,
        s.status::text AS status,
        s.created_at,
        s.updated_at,
        l.id AS location_id,
        l.country,
        l.city,
        l.street,
        l.house_number,
        (l.coordinates)[0]::float8 AS lat,
        (l.coordinates)[1]::float8 AS lng,
        (
          SELECT COALESCE(array_agg(DISTINCT ct.name::text), ARRAY[]::text[])
          FROM port p
          INNER JOIN connector_type ct ON ct.id = p.connector_type_id
          WHERE p.station_id = s.id
        ) AS connector_codes
      FROM station s
      INNER JOIN location l ON s.location_id = l.id
      WHERE (l.coordinates)[0]::double precision >= $1
        AND (l.coordinates)[0]::double precision <= $2
        AND (l.coordinates)[1]::double precision >= $3
        AND (l.coordinates)[1]::double precision <= $4
      ORDER BY s.id
      LIMIT $5`,
      minLat,
      maxLat,
      minLng,
      maxLng,
      limit,
    );
    return rows;
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
