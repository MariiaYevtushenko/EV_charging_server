import { buildStationsListWhere, stationRepository } from "../db/stationRepository.js";
import { randomDefaultPortMaxPowerKw } from "../utils/defaultPortMaxPowerKw.js";
import type { ParsedStationListSort } from "../lib/stationListSort.js";
import { rethrowIfStationStatusBlockedByActiveSession } from "../lib/stationStatusDbConflict.js";
import type { Prisma, Station, StationStatus } from "../../generated/prisma/index.js";

/** GET /api/stations/:id/upcoming-bookings */
export type StationUpcomingBookingDto = {
  id: string;
  portNumber: number;
  connectorName: string | null;
  start: string;
  end: string;
  userDisplayName: string | null;
  userEmail: string | null;
  vehicleLicensePlate: string | null;
};

/** GET /api/stations/:id/available-booking-slots — рядки з SQL GetAvailableBookingSlots. */
export type AvailableBookingSlotDto = {
  start: string;
  end: string;
};

/** GET /api/stations/:id/analytics-energy */
export type StationEnergyPeriod = "1d" | "7d" | "30d";

export type StationEnergyAnalyticsPointDto = {
  bucketStart: string;
  kwh: number;
  /** Кількість сесій, що почалися в цьому інтервалі. */
  sessions: number;
  /** Сума `bill.calculated_amount` по сесіях у відрі (грн). */
  revenueUah: number;
};

export type StationEnergyAnalyticsDto = {
  period: StationEnergyPeriod;
  bucket: "hour" | "day";
  points: StationEnergyAnalyticsPointDto[];
  totalKwh: number;
  sessionCount: number;
  totalRevenueUah: number;
};

function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

function buildStationEnergyAnalytics(
  sessions: {
    startTime: Date;
    kwhConsumed: unknown;
    bill: { calculatedAmount: unknown } | null;
  }[],
  from: Date,
  to: Date,
  bucketCount: number,
  period: StationEnergyPeriod,
  bucket: "hour" | "day"
): StationEnergyAnalyticsDto {
  const ms = to.getTime() - from.getTime();
  const bucketMs = ms / bucketCount;
  const kwhArr = Array.from({ length: bucketCount }, () => 0);
  const sessArr = Array.from({ length: bucketCount }, () => 0);
  const revArr = Array.from({ length: bucketCount }, () => 0);
  for (const s of sessions) {
    const t = s.startTime.getTime();
    if (t < from.getTime() || t > to.getTime()) continue;
    let idx = Math.floor((t - from.getTime()) / bucketMs);
    if (idx >= bucketCount) idx = bucketCount - 1;
    if (idx < 0) continue;
    kwhArr[idx] = (kwhArr[idx] ?? 0) + Number(s.kwhConsumed);
    sessArr[idx] = (sessArr[idx] ?? 0) + 1;
    const raw = s.bill?.calculatedAmount;
    const amt = raw != null ? Number(raw) : 0;
    revArr[idx] = (revArr[idx] ?? 0) + (Number.isFinite(amt) ? amt : 0);
  }
  const points: StationEnergyAnalyticsPointDto[] = kwhArr.map((kwh, i) => ({
    bucketStart: new Date(from.getTime() + i * bucketMs).toISOString(),
    kwh: Math.round(kwh * 1000) / 1000,
    sessions: sessArr[i] ?? 0,
    revenueUah: Math.round((revArr[i] ?? 0) * 100) / 100,
  }));
  const totalKwh = Math.round(kwhArr.reduce((a, b) => a + b, 0) * 1000) / 1000;
  const totalRevenueUah = Math.round(revArr.reduce((a, b) => a + b, 0) * 100) / 100;
  return {
    period,
    bucket,
    points,
    totalKwh,
    sessionCount: sessions.length,
    totalRevenueUah,
  };
}

/** DTO для REST — відповідає таблицям station + location + port (DB_script.MD) */
export type StationDashboardDto = {
  id: number;
  name: string;
  status: string;
  locationId: number;
  country: string;
  city: string;
  addressLine: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  updatedAt: string;
  /** Виручка за поточну календарну добу (грн), з рахунків SUCCESS як у мережевій аналітиці. */
  todayRevenue: number;
  /** Кількість сесій з початком у поточну добу. */
  todaySessions: number;
  ports: Array<{
    id: number;
    portNumber: number;
    maxPower: number;
    connectorCategory: string | null;
    status: string;
  }>;
};

type StationWithLocationPorts = Prisma.StationGetPayload<{
  include: {
    location: {
      select: { id: true; country: true; city: true; street: true; houseNumber: true };
    };
    ports: { include: { connectorType: true } };
  };
}>;

/** Кількості по статусу для UI (узгоджено з `stationFromDashboardDto`). */
export type StationsPageStatusCounts = {
  working: number;
  offline: number;
  maintenance: number;
  archived: number;
};

function mapDbStatusCounts(db: Record<StationStatus, number>): StationsPageStatusCounts {
  return {
    working: db.WORK,
    offline: db.NOT_WORKING,
    maintenance: db.FIX,
    archived: db.ARCHIVED,
  };
}

function toDashboardDto(
  station: StationWithLocationPorts,
  coords: { lat: number; lng: number } | null | undefined,
  today: { revenue: number; sessions: number } = { revenue: 0, sessions: 0 }
): StationDashboardDto {
  const loc = station.location;
  const addressLine = `${loc.street} ${loc.houseNumber}`.trim();
  return {
    id: station.id,
    name: station.name,
    status: station.status,
    locationId: loc.id,
    country: loc.country,
    city: loc.city,
    addressLine,
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lng : null,
    createdAt: station.createdAt.toISOString(),
    updatedAt: station.updatedAt.toISOString(),
    todayRevenue: today.revenue,
    todaySessions: today.sessions,
    ports: station.ports.map((p) => ({
      // Стабільний числовий id для API: stationId * 10000 + port_number (порт ідентифікується парою station_id + port_number у БД)
      id: station.id * 10000 + p.portNumber,
      portNumber: p.portNumber,
      maxPower: Number(p.maxPower),
      connectorCategory: p.connectorType?.name ?? null,
      status: p.status,
    })),
  };
}

export const stationService = {
  async getStationDashboard(stationId: number): Promise<StationDashboardDto | null> {
    const station = await stationRepository.findByIdWithPorts(stationId);
    if (!station) {
      return null;
    }
    const coords = await stationRepository.getLocationCoords(station.locationId);
    const statsMap = await stationRepository.getTodayStatsByStationIds([stationId]);
    const st = statsMap.get(stationId) ?? { sessions: 0, revenue: 0 };
    return toDashboardDto(station, coords, { revenue: st.revenue, sessions: st.sessions });
  },

  async getAllStations(): Promise<StationDashboardDto[]> {
    const stations = await stationRepository.findAll();
    const coordMap = await stationRepository.getLocationCoordsBatch(
      stations.map((s) => s.locationId)
    );
    const statsMap = await stationRepository.getTodayStatsByStationIds(stations.map((s) => s.id));
    return stations.map((s) => {
      const st = statsMap.get(s.id) ?? { sessions: 0, revenue: 0 };
      return toDashboardDto(s, coordMap.get(s.locationId) ?? null, {
        revenue: st.revenue,
        sessions: st.sessions,
      });
    });
  },

  /** Усі станції для карти (без портів) — лише для адмін-утиліт; для UI карти краще `getStationsForMapInBounds`. */
  async getStationsForMap(): Promise<StationDashboardDto[]> {
    const stations = await stationRepository.findAllWithLocationOnly();
    const coordMap = await stationRepository.getLocationCoordsBatch(
      stations.map((s) => s.locationId)
    );
    return stations.map((s) =>
      toDashboardDto(
        { ...s, ports: [] } as StationWithLocationPorts,
        coordMap.get(s.locationId) ?? null
      )
    );
  },

  /** Станції у прямокутнику видимої області карти (bbox), без портів. */
  async getStationsForMapInBounds(
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
    limit: number
  ): Promise<StationDashboardDto[]> {
    const rows = await stationRepository.findIdsWithLocationInBounds(
      minLat,
      maxLat,
      minLng,
      maxLng,
      limit
    );
    return rows.map((r) => {
      const addressLine = `${r.street} ${r.house_number}`.trim();
      const codes = r.connector_codes ?? [];
      const ports =
        codes.length > 0
          ? codes.map((name, idx) => ({
              id: r.id * 10000 + idx + 1,
              portNumber: idx + 1,
              maxPower: randomDefaultPortMaxPowerKw(),
              connectorCategory: name,
              status: "FREE",
            }))
          : [];
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        locationId: r.location_id,
        country: r.country,
        city: r.city,
        addressLine,
        lat: r.lat,
        lng: r.lng,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        todayRevenue: 0,
        todaySessions: 0,
        ports,
      };
    });
  },

  
  async getStationsPage(
    skip: number,
    take: number,
    page: number,
    pageSize: number,
    sort: ParsedStationListSort,
    statusFilter?: StationStatus,
    search?: string | null
  ): Promise<{
    items: StationDashboardDto[];
    total: number;
    page: number;
    pageSize: number;
    cities: string[];
    statusCounts: StationsPageStatusCounts;
  }> {
    const listWhere = buildStationsListWhere(statusFilter ?? null, search);
    const [total, cities, byStatus] = await Promise.all([
      stationRepository.countStations(listWhere),
      stationRepository.getDistinctCitiesForStations(),
      stationRepository.countByStatus(),
    ]);

    let stations: Awaited<ReturnType<typeof stationRepository.findManyPaginated>>;
    if (sort.key === "todayRevenue" || sort.key === "todaySessions") {
      const ids = await stationRepository.listStationIdsPaginatedByTodayMetric({
        skip,
        take,
        sortKey: sort.key,
        dir: sort.dir,
        statusFilter: statusFilter ?? null,
        search: search ?? null,
      });
      stations = await stationRepository.findManyByIdsWithPortsOrdered(ids);
    } else {
      stations = await stationRepository.findManyPaginated(skip, take, sort, listWhere);
    }

    const coordMap = await stationRepository.getLocationCoordsBatch(
      stations.map((s) => s.locationId)
    );
    const statsMap = await stationRepository.getTodayStatsByStationIds(stations.map((s) => s.id));
    const items = stations.map((s) => {
      const st = statsMap.get(s.id) ?? { sessions: 0, revenue: 0 };
      return toDashboardDto(s, coordMap.get(s.locationId) ?? null, {
        revenue: st.revenue,
        sessions: st.sessions,
      });
    });
    return {
      items,
      total,
      page,
      pageSize,
      cities,
      statusCounts: mapDbStatusCounts(byStatus),
    };
  },


  async createStation(station: Station): Promise<Station> {
    return await stationRepository.createStation(station);
  },

  async updateStation(stationId: number, station: Station): Promise<Station> {
    try {
      return await stationRepository.updateStation(stationId, station);
    } catch (e) {
      rethrowIfStationStatusBlockedByActiveSession(e);
    }
  },

  async archiveStation(stationId: number): Promise<Station> {
    try {
      return await stationRepository.archiveStation(stationId);
    } catch (e) {
      rethrowIfStationStatusBlockedByActiveSession(e);
    }
  },

  async unarchiveStation(stationId: number): Promise<Station> {
    return await stationRepository.unarchiveStation(stationId);
  },

  async updateStationStatus(stationId: number, status: StationStatus): Promise<Station> {
    try {
      return await stationRepository.updateStationStatus(stationId, status);
    } catch (e) {
      rethrowIfStationStatusBlockedByActiveSession(e);
    }
  },

  /** Повертає false, якщо станції немає. */
  async deleteStation(stationId: number): Promise<boolean> {
    const existing = await stationRepository.findByIdWithPorts(stationId);
    if (!existing) return false;
    await stationRepository.deleteStationById(stationId);
    return true;
  },

  /**
   * Вільні стартові інтервали бронювання на порту за календарним днем (функція БД).
   * NOT_FOUND — немає станції; BAD_PORT — порт не з цієї станції.
   */
  async getAvailableBookingSlots(
    stationId: number,
    portNumber: number,
    bookingDate: string,
    slotMinutes: number,
    durationMinutes: number
  ): Promise<
    | { kind: "NOT_FOUND" }
    | { kind: "BAD_PORT" }
    | { kind: "OK"; slots: AvailableBookingSlotDto[] }
  > {
    const station = await stationRepository.findByIdWithPorts(stationId);
    if (!station) return { kind: "NOT_FOUND" };
    if (!station.ports.some((p) => p.portNumber === portNumber)) {
      return { kind: "BAD_PORT" };
    }
    const rows = await stationRepository.getAvailableBookingSlots(
      stationId,
      portNumber,
      bookingDate,
      slotMinutes,
      durationMinutes
    );
    return {
      kind: "OK",
      slots: rows.map((r) => ({
        start: r.available_start.toISOString(),
        end: r.available_end.toISOString(),
      })),
    };
  },

  async getStationUpcomingBookings(stationId: number): Promise<StationUpcomingBookingDto[] | null> {
    const exists = await stationRepository.findByIdWithPorts(stationId);
    if (!exists) return null;
    const rows = await stationRepository.listUpcomingBookingsForStation(stationId);
    return rows.map((b) => {
      const u = b.user;
      const userDisplayName =
        u != null ? `${u.name} ${u.surname}`.trim() || null : null;
      return {
        id: String(b.id),
        portNumber: b.portNumber,
        connectorName: b.port.connectorType?.name ?? null,
        start: b.startTime.toISOString(),
        end: b.endTime.toISOString(),
        userDisplayName,
        userEmail: u?.email ?? null,
        vehicleLicensePlate: b.vehicle?.licensePlate ?? null,
      };
    });
  },

  async getStationEnergyAnalytics(
    stationId: number,
    period: StationEnergyPeriod
  ): Promise<StationEnergyAnalyticsDto | null> {
    const exists = await stationRepository.findByIdWithPorts(stationId);
    if (!exists) return null;
    const to = new Date();
    let from: Date;
    let bucketCount: number;
    let bucket: "hour" | "day";
    if (period === "1d") {
      from = addMs(to, -24 * 60 * 60 * 1000);
      bucketCount = 24;
      bucket = "hour";
    } else if (period === "7d") {
      from = addMs(to, -7 * 24 * 60 * 60 * 1000);
      bucketCount = 7;
      bucket = "day";
    } else {
      from = addMs(to, -30 * 24 * 60 * 60 * 1000);
      bucketCount = 30;
      bucket = "day";
    }
    const sessions = await stationRepository.findSessionsForStationInRange(stationId, from, to);
    return buildStationEnergyAnalytics(sessions, from, to, bucketCount, period, bucket);
  },

  /** Завантаженість за днем бронювання + надбавка ₴/кВт·год (для динамічної ціни). */
  async getStationBookingDayLoad(
    stationId: number,
    dateYmd: string
  ): Promise<{
    loadPct: number;
    bookedMinutes: number;
    capacityMinutes: number;
    surchargeUahPerKwh: number;
  } | null> {
    const exists = await stationRepository.findByIdWithPorts(stationId);
    if (!exists) return null;
    return stationRepository.getStationBookingDayLoad(stationId, dateYmd);
  },
};
