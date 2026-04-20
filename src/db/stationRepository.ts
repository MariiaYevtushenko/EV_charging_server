import prisma from "../prisma.config.js";
import { Prisma } from "../../generated/prisma/index.js";
import type { PrismaClient, Station, StationStatus } from "../../generated/prisma/index.js";
import type { ParsedStationListSort } from "../lib/stationListSort.js";

const ALL_STATION_STATUSES: StationStatus[] = ["WORK", "NO_CONNECTION", "FIX", "ARCHIVED"];

function buildStationListOrderBy(sort: ParsedStationListSort): Prisma.StationOrderByWithRelationInput {
  const dir = sort.dir;
  switch (sort.key) {
    case "name":
      return { name: dir };
    case "status":
      return { status: dir };
    case "city":
      return { location: { city: dir } };
    case "country":
      return { location: { country: dir } };
    case "todayRevenue":
    case "todaySessions":
      return { name: "asc" };
    default:
      return { name: "asc" };
  }
}

const db = prisma as unknown as PrismaClient;

// Межі «сьогодні» для списку станцій 
export function getStationListTodayBounds(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Фільтр списку станцій
export function buildStationsListWhere(
  statusFilter?: StationStatus | null,
  search?: string | null
): Prisma.StationWhereInput | undefined {
  const q = (search ?? "").trim();
  const searchWhere: Prisma.StationWhereInput | undefined =
    q.length === 0
      ? undefined
      : {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { location: { city: { contains: q, mode: "insensitive" } } },
          ],
        };
  const statusWhere: Prisma.StationWhereInput | undefined =
    statusFilter != null ? { status: statusFilter } : undefined;
  if (!statusWhere && !searchWhere) return undefined;
  if (statusWhere && !searchWhere) return statusWhere;
  if (!statusWhere && searchWhere) return searchWhere;
  return { AND: [statusWhere!, searchWhere!] };
}

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

  // Усі станції з локацією
  async findAllWithLocationOnly() {
    return db.station.findMany({
      include: stationMapInclude,
      orderBy: { id: "asc" },
    });
  },

  async countStations(where?: Prisma.StationWhereInput): Promise<number> {
    return db.station.count({ where: where ?? {} });
  },

  // Отримання кількості станцій по кожному статусу
  async countByStatus(): Promise<Record<StationStatus, number>> {
    const rows = await db.station.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const out = Object.fromEntries(ALL_STATION_STATUSES.map((s) => [s, 0])) as Record<
      StationStatus,
      number
    >;
    for (const r of rows) {
      out[r.status] = r._count._all;
    }
    return out;
  },

  // Отримання списку станцій з пагінацією
  async findManyPaginated(
    skip: number,
    take: number,
    sort: ParsedStationListSort,
    where?: Prisma.StationWhereInput
  ) {
    return db.station.findMany({
      where: where ?? {},
      include: stationInclude,
      orderBy: buildStationListOrderBy(sort),
      skip,
      take,
    });
  },

  // Отримання статистики за поточну добу по кожній станції зі списку
  async getTodayStatsByStationIds(
    ids: number[]
  ): Promise<Map<number, { sessions: number; revenue: number }>> {
    const map = new Map<number, { sessions: number; revenue: number }>();
    if (ids.length === 0) return map;
    const { start, end } = getStationListTodayBounds();
    for (const id of ids) {
      map.set(id, { sessions: 0, revenue: 0 });
    }
    const [sessionGroups, revenueRows] = await Promise.all([
      db.session.groupBy({
        by: ["stationId"],
        where: {
          stationId: { in: ids },
          startTime: { gte: start, lte: end },
        },
        _count: { _all: true },
      }),
      db.$queryRaw<Array<{ station_id: number; r: unknown }>>`
        SELECT s.station_id AS station_id, COALESCE(SUM(bi.calculated_amount), 0) AS r
        FROM bill bi
        INNER JOIN session s ON s.id = bi.session_id
        WHERE bi.payment_status = 'SUCCESS'::payment_status
        AND (
          (bi.paid_at >= ${start} AND bi.paid_at <= ${end})
          OR (bi.paid_at IS NULL AND bi.created_at >= ${start} AND bi.created_at <= ${end})
        )
        AND s.station_id IN (${Prisma.join(ids)})
        GROUP BY s.station_id
      `,
    ]);
    for (const row of sessionGroups) {
      const cur = map.get(row.stationId);
      if (cur) cur.sessions = row._count._all;
    }
    for (const row of revenueRows) {
      const cur = map.get(row.station_id);
      if (cur) cur.revenue = Number(row.r);
    }
    return map;
  },


  // Пагінація списку станцій із сортуванням за метриками «сьогодні»
  async listStationIdsPaginatedByTodayMetric(params: {
    skip: number;
    take: number;
    sortKey: "todayRevenue" | "todaySessions";
    dir: "asc" | "desc";
    statusFilter?: StationStatus | null;
    search?: string | null;
  }): Promise<number[]> {
    const { start, end } = getStationListTodayBounds();
    const q = (params.search ?? "").trim();
    const pattern = q.length > 0 ? `%${q}%` : null;

    const statusSql =
      params.statusFilter != null
        ? Prisma.sql`AND s.status = ${params.statusFilter}::station_status`
        : Prisma.empty;

    const searchSql =
      pattern != null
        ? Prisma.sql`AND (s.name ILIKE ${pattern} OR l.city ILIKE ${pattern})`
        : Prisma.empty;

    const orderSessions =
      params.dir === "asc"
        ? Prisma.sql`COALESCE(sc.c, 0) ASC`
        : Prisma.sql`COALESCE(sc.c, 0) DESC`;
    const orderRevenue =
      params.dir === "asc"
        ? Prisma.sql`COALESCE(rt.r, 0) ASC`
        : Prisma.sql`COALESCE(rt.r, 0) DESC`;
    const orderSql = params.sortKey === "todaySessions" ? orderSessions : orderRevenue;

    const rows = await db.$queryRaw<Array<{ id: number }>>`
      WITH bounds AS (
        SELECT ${start}::timestamptz AS t0, ${end}::timestamptz AS t1
      ),
      sess_counts AS (
        SELECT sess.station_id, COUNT(*)::int AS c
        FROM session sess
        CROSS JOIN bounds bd
        WHERE sess.start_time >= bd.t0 AND sess.start_time <= bd.t1
        GROUP BY sess.station_id
      ),
      rev_totals AS (
        SELECT s.station_id, COALESCE(SUM(bi.calculated_amount), 0)::numeric AS r
        FROM bill bi
        INNER JOIN session s ON s.id = bi.session_id
        CROSS JOIN bounds bd
        WHERE bi.payment_status = 'SUCCESS'::payment_status
        AND (
          (bi.paid_at >= bd.t0 AND bi.paid_at <= bd.t1)
          OR (bi.paid_at IS NULL AND bi.created_at >= bd.t0 AND bi.created_at <= bd.t1)
        )
        GROUP BY s.station_id
      )
      SELECT s.id
      FROM station s
      INNER JOIN location l ON l.id = s.location_id
      LEFT JOIN sess_counts sc ON sc.station_id = s.id
      LEFT JOIN rev_totals rt ON rt.station_id = s.id
      WHERE TRUE
      ${statusSql}
      ${searchSql}
      ORDER BY ${orderSql}, s.name ASC
      OFFSET ${params.skip}
      LIMIT ${params.take}
    `;
    return rows.map((r) => r.id);
  },

  // Отримання списку станцій по ID з портів
  async findManyByIdsWithPortsOrdered(ids: number[]) {
    if (ids.length === 0) return [];
    const rows = await db.station.findMany({
      where: { id: { in: ids } },
      include: stationInclude,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => row != null);
  },

  // Отримання списку міст зі станціями
  async getDistinctCitiesForStations(): Promise<string[]> {
    const rows = await db.$queryRaw<Array<{ city: string }>>`
      SELECT DISTINCT l.city AS city
      FROM location l
      INNER JOIN station s ON s.location_id = l.id
      ORDER BY l.city ASC
    `;
    return rows.map((r) => r.city);
  },

  // Отримання координат з `point`
  async getLocationCoords(locationId: number): Promise<{ lat: number; lng: number } | null> {
    const rows = await db.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
      `SELECT (coordinates)[0]::float8 AS lat, (coordinates)[1]::float8 AS lng FROM location WHERE id = $1`,
      locationId
    );
    const r = rows[0];
    if (!r) return null;
    return { lat: Number(r.lat), lng: Number(r.lng) };
  },

  // Отримання списку станцій з локаціями в прямокутнику
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

  // Отримання координат з `point`
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

  // Створення станції
  async createStation(station: Station): Promise<Station> {
    return await db.station.create({
      data: station,
    });
  },

  // Оновлення станції
  async updateStation(stationId: number, station: Station): Promise<Station> {
    return await db.station.update({
      where: { id: stationId },
      data: station,
    });
  },
  
  // Архівування станції
  async archiveStation(stationId: number): Promise<Station> {
    return await db.station.update({
      where: { id: stationId },
      data: { status: "ARCHIVED" },
    });
  },

  // Відновлення станції з архіву
  async unarchiveStation(stationId: number): Promise<Station> {
    return await db.station.update({
      where: { id: stationId },
      data: { status: "WORK" },
    });
  },
  
  // Оновлення статусу станції
  async updateStationStatus(stationId: number, status: StationStatus): Promise<Station> {
    return await db.station.update({
      where: { id: stationId }, 
      data: { status: status },
    });
  },

  // Видалення станції
  async deleteStationById(stationId: number): Promise<void> {
    await db.$transaction(async (tx) => {
      const row = await tx.station.findUnique({
        where: { id: stationId },
        select: { locationId: true },
      });
      if (!row) return;

      await tx.session.deleteMany({ where: { stationId } });
      await tx.booking.deleteMany({ where: { stationId } });
      await tx.station.delete({ where: { id: stationId } });

      const remainingAtLocation = await tx.station.count({
        where: { locationId: row.locationId },
      });
      if (remainingAtLocation === 0) {
        await tx.location.delete({ where: { id: row.locationId } });
      }
    });
  },

  // Отримання сесій станції з початком у [from, to]
  async findSessionsForStationInRange(stationId: number, from: Date, to: Date) {
    return db.session.findMany({
      where: {
        stationId,
        startTime: { gte: from, lte: to },
      },
      select: {
        startTime: true,
        kwhConsumed: true,
      },
    });
  },


  // Отримання майбутніх бронювань станції
  async listUpcomingBookingsForStation(stationId: number, take = 200) {
    return db.booking.findMany({
      where: {
        stationId,
        status: "BOOKED",
        startTime: { gt: new Date() },
      },
      orderBy: { startTime: "asc" },
      take,
      include: {
        user: { select: { name: true, surname: true, email: true } },
        vehicle: { select: { licensePlate: true } },
        port: { include: { connectorType: { select: { name: true } } } },
      },
    });
  },

};
