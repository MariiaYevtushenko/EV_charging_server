import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

const RANK_LIMIT = 10;

/** Узгоджено з `userAnalyticsRepository.ts` — [from, to) за start_time сесії / бронювання. */
export type StationAdminAnalyticsPeriod = "today" | "7d" | "30d" | "all";

export function parseStationAdminAnalyticsPeriod(raw: string | undefined): StationAdminAnalyticsPeriod {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "all") return raw;
  return "30d";
}

/** Нормалізований запит після `normalizeStationAdminViewsRequest` (усі періоди та пагінація задані). */
export type StationAdminViewsRequest = {
  period: StationAdminAnalyticsPeriod;
  topPeriod: StationAdminAnalyticsPeriod;
  fewestPeriod: StationAdminAnalyticsPeriod;
  peakPeriod: StationAdminAnalyticsPeriod;
  sessionStatsPage: number;
  sessionStatsPageSize: number;
  portStatsPage: number;
  portStatsPageSize: number;
  stationId?: number;
  peakStationId?: number;
};

function clampInt(n: number | undefined, fallback: number, min: number, max: number): number {
  if (n == null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function normalizeStationAdminViewsRequest(
  raw?: Partial<{
    stationId?: number | null;
    period?: string;
    topPeriod?: string;
    fewestPeriod?: string;
    sessionStatsPage?: number;
    sessionStatsPageSize?: number;
    portStatsPage?: number;
    portStatsPageSize?: number;
    peakStationId?: number | null;
    peakPeriod?: string;
  }>
): StationAdminViewsRequest {
  const period = parseStationAdminAnalyticsPeriod(raw?.period);
  const topPeriod = raw?.topPeriod != null ? parseStationAdminAnalyticsPeriod(String(raw.topPeriod)) : period;
  const fewestPeriod =
    raw?.fewestPeriod != null ? parseStationAdminAnalyticsPeriod(String(raw.fewestPeriod)) : period;
  const peakPeriod =
    raw?.peakPeriod != null ? parseStationAdminAnalyticsPeriod(String(raw.peakPeriod)) : period;
  const sid = raw?.stationId != null && Number.isFinite(raw.stationId) && raw.stationId > 0 ? raw.stationId : undefined;
  const peakSid =
    raw?.peakStationId != null && Number.isFinite(raw.peakStationId) && raw.peakStationId > 0
      ? raw.peakStationId
      : undefined;
  const out: StationAdminViewsRequest = {
    period,
    topPeriod,
    fewestPeriod,
    peakPeriod,
    sessionStatsPage: clampInt(raw?.sessionStatsPage, 1, 1, 50_000),
    sessionStatsPageSize: clampInt(raw?.sessionStatsPageSize, 15, 1, 100),
    portStatsPage: clampInt(raw?.portStatsPage, 1, 1, 50_000),
    portStatsPageSize: clampInt(raw?.portStatsPageSize, 15, 1, 200),
  };
  if (sid !== undefined) out.stationId = sid;
  if (peakSid !== undefined) out.peakStationId = peakSid;
  return out;
}

function stationAdminAnalyticsWindows(period: StationAdminAnalyticsPeriod): { from: Date; to: Date } {
  const anchor = new Date();
  const to = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1, 0, 0, 0, 0);
  if (period === "today") {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0);
    return { from, to };
  }
  if (period === "7d") {
    const from = new Date(to.getTime() - 7 * 86400000);
    return { from, to };
  }
  if (period === "30d") {
    const from = new Date(to.getTime() - 30 * 86400000);
    return { from, to };
  }
  return { from: new Date(0), to };
}

function serializeCell(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const anyV = v as { toNumber?: () => number; toString?: () => string; constructor?: { name?: string } };
    if (typeof anyV.toNumber === "function") {
      try {
        return anyV.toNumber();
      } catch {
        /* fallthrough */
      }
    }
    if (anyV.constructor?.name === "Decimal" && typeof anyV.toString === "function") {
      const n = Number(anyV.toString());
      return Number.isFinite(n) ? n : anyV.toString();
    }
  }
  return v;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    o[k] = serializeCell(v);
  }
  return o;
}

export type StationOverviewCounts = {
  total: number;
  work: number;
  notWorking: number;
  fix: number;
  archived: number;
};

export type PaginatedViewBlock = {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
};

export type StationAdminPeakBlock = {
  stationId: number;
  period: StationAdminAnalyticsPeriod;
  periodFrom: string;
  periodTo: string;
  buckets: Record<string, unknown>[];
};

export type StationAdminStationDetail = {
  sessionStats: Record<string, unknown> | null;
  bookingStats: Record<string, unknown> | null;
  utilization: Record<string, unknown> | null;
  connectors: Record<string, unknown>[];
  peakHours: Record<string, unknown>[];
};

export type StationAdminSnapshot = {
  period: StationAdminAnalyticsPeriod;
  periodDays: number | null;
  periodFrom: string;
  periodTo: string;
  topPeriod: StationAdminAnalyticsPeriod;
  topPeriodFrom: string;
  topPeriodTo: string;
  fewestPeriod: StationAdminAnalyticsPeriod;
  fewestPeriodFrom: string;
  fewestPeriodTo: string;
  partial: boolean;
  overview: StationOverviewCounts | null;
  networkBookingKpis: Record<string, unknown> | null;
  /** GetStationAdminMonthComparison — уся мережа: поточний місяць (1–сьогодні) vs повний попередній. */
  networkMonthComparison: Record<string, unknown> | null;
  networkTopStations: Record<string, unknown>[];
  networkBottomStations: Record<string, unknown>[];
  sessionStatsViewPage: PaginatedViewBlock;
  portStatsViewPage: PaginatedViewBlock;
  peakForStation: StationAdminPeakBlock | null;
  stationId: number | null;
  stationDetail: StationAdminStationDetail | null;
};

async function safeQuery<T extends Record<string, unknown>>(
  label: string,
  fn: () => Promise<T[]>,
  onError: () => void
): Promise<Record<string, unknown>[]> {
  try {
    const rows = await fn();
    return rows.map(serializeRow);
  } catch (e) {
    console.error(`[stationAdminAnalyticsRepository] ${label}:`, e);
    onError();
    return [];
  }
}

async function safeQueryOne(
  label: string,
  fn: () => Promise<Record<string, unknown>[]>,
  onError: () => void
): Promise<Record<string, unknown> | null> {
  const rows = await safeQuery(label, fn, onError);
  return rows[0] ?? null;
}

function numCell(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (v != null && typeof v === "object" && "toString" in v) {
    const n = Number(String(v));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function queryStationOverviewCounts(mark: () => void): Promise<StationOverviewCounts | null> {
  try {
    const grouped = await db.station.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const out: StationOverviewCounts = { total: 0, work: 0, notWorking: 0, fix: 0, archived: 0 };
    for (const r of grouped) {
      const c = r._count._all;
      out.total += c;
      if (r.status === "WORK") out.work = c;
      else if (r.status === "NOT_WORKING") out.notWorking = c;
      else if (r.status === "FIX") out.fix = c;
      else if (r.status === "ARCHIVED") out.archived = c;
    }
    return out;
  } catch (e) {
    console.error(`[stationAdminAnalyticsRepository] overview:`, e);
    mark();
    return null;
  }
}

export async function queryStationAdminAnalyticsSnapshot(
  rawReq?: Partial<{
    stationId?: number | null;
    period?: string;
    topPeriod?: string;
    fewestPeriod?: string;
    sessionStatsPage?: number;
    sessionStatsPageSize?: number;
    portStatsPage?: number;
    portStatsPageSize?: number;
    peakStationId?: number | null;
    peakPeriod?: string;
  }>
): Promise<StationAdminSnapshot> {
  const req = normalizeStationAdminViewsRequest(rawReq);
  let partial = false;
  const mark = () => {
    partial = true;
  };

  const { from, to } = stationAdminAnalyticsWindows(req.period);
  const topWin = stationAdminAnalyticsWindows(req.topPeriod);
  const fewWin = stationAdminAnalyticsWindows(req.fewestPeriod);
  const peakWin = stationAdminAnalyticsWindows(req.peakPeriod);

  const periodDaysValue =
    req.period === "all" ? null : Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));

  const sessionPage = req.sessionStatsPage;
  const sessionSize = req.sessionStatsPageSize;
  const sessionOffset = (sessionPage - 1) * sessionSize;

  const portPage = req.portStatsPage;
  const portSize = req.portStatsPageSize;
  const portOffset = (portPage - 1) * portSize;

  const monthCompareStationId =
    req.stationId != null && Number.isFinite(req.stationId) && req.stationId > 0 ? Math.floor(req.stationId) : null;

  const [
    overview,
    networkBookingKpis,
    networkMonthComparison,
    networkTopStations,
    networkBottomStations,
    sessionCountRow,
    sessionPageRows,
    portCountRow,
    portPageRows,
  ] = await Promise.all([
    queryStationOverviewCounts(mark),
    safeQueryOne(
      "networkBookingKpis",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getnetworkbookingstatsforperiod($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQueryOne(
      "networkMonthComparison",
      () => db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM getstationadminmonthcomparison()`),
      mark
    ),
    safeQuery(
      "networkTopStations",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getnetworkstationsmostsessions($1::timestamptz, $2::timestamptz, $3::int)`,
          topWin.from,
          topWin.to,
          RANK_LIMIT
        ),
      mark
    ),
    safeQuery(
      "networkBottomStations",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getnetworkstationsfewestsessions($1::timestamptz, $2::timestamptz, $3::int)`,
          fewWin.from,
          fewWin.to,
          RANK_LIMIT
        ),
      mark
    ),
    safeQueryOne(
      "sessionViewCount",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT COUNT(*)::bigint AS c FROM view_stationsessionstatslast30days`
        ),
      mark
    ),
    safeQuery(
      "sessionViewPage",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM view_stationsessionstatslast30days
           ORDER BY station_id
           LIMIT $1::int OFFSET $2::int`,
          sessionSize,
          sessionOffset
        ),
      mark
    ),
    safeQueryOne(
      "portViewCount",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT COUNT(*)::bigint AS c FROM view_stationportstatslast30days`
        ),
      mark
    ),
    safeQuery(
      "portViewPage",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM view_stationportstatslast30days
           ORDER BY station_id, port_number
           LIMIT $1::int OFFSET $2::int`,
          portSize,
          portOffset
        ),
      mark
    ),
  ]);

  const sessionTotal = numCell(sessionCountRow?.c);
  const portTotal = numCell(portCountRow?.c);

  let peakForStation: StationAdminPeakBlock | null = null;
  if (req.peakStationId != null) {
    const exists = await db.station.findFirst({ where: { id: req.peakStationId }, select: { id: true } });
    if (exists) {
      const buckets = await safeQuery(
        "peakForStation",
        () =>
          db.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT * FROM getstationpeakhourbuckets($1::int, $2::timestamptz, $3::timestamptz)`,
            req.peakStationId,
            peakWin.from,
            peakWin.to
          ),
        mark
      );
      peakForStation = {
        stationId: req.peakStationId,
        period: req.peakPeriod,
        periodFrom: peakWin.from.toISOString(),
        periodTo: peakWin.to.toISOString(),
        buckets,
      };
    }
  }

  let stationDetail: StationAdminStationDetail | null = null;
  let resolvedStationId: number | null = null;
  const stationId = req.stationId;

  if (stationId != null && Number.isFinite(stationId) && stationId > 0) {
    const exists = await db.station.findFirst({ where: { id: stationId }, select: { id: true } });
    if (exists) {
      resolvedStationId = stationId;
      const [sessionStats, bookingStats, utilization, connectors, peakHours] = await Promise.all([
        safeQueryOne(
          "stationSessionStats",
          () =>
            db.$queryRawUnsafe<Record<string, unknown>[]>(
              `SELECT * FROM getstationsessionstatsforperiod($1::int, $2::timestamptz, $3::timestamptz)`,
              stationId,
              from,
              to
            ),
          mark
        ),
        safeQueryOne(
          "stationBookingStats",
          () =>
            db.$queryRawUnsafe<Record<string, unknown>[]>(
              `SELECT * FROM getstationbookingstatsforperiod($1::int, $2::timestamptz, $3::timestamptz)`,
              stationId,
              from,
              to
            ),
          mark
        ),
        safeQueryOne(
          "stationUtilization",
          () =>
            db.$queryRawUnsafe<Record<string, unknown>[]>(
              `SELECT * FROM getstationutilizationproxyforperiod($1::int, $2::timestamptz, $3::timestamptz)`,
              stationId,
              from,
              to
            ),
          mark
        ),
        safeQuery(
          "stationConnectors",
          () =>
            db.$queryRawUnsafe<Record<string, unknown>[]>(
              `SELECT port_number, connector_name,
                      total_sessions AS session_count,
                      total_energy AS total_kwh,
                      total_revenue
               FROM view_stationportstatslast30days
               WHERE station_id = $1::int
               ORDER BY port_number`,
              stationId
            ),
          mark
        ),
        safeQuery(
          "stationPeakHours",
          () =>
            db.$queryRawUnsafe<Record<string, unknown>[]>(
              `SELECT * FROM getstationpeakhourbuckets($1::int, $2::timestamptz, $3::timestamptz)`,
              stationId,
              from,
              to
            ),
          mark
        ),
      ]);
      stationDetail = {
        sessionStats,
        bookingStats,
        utilization,
        connectors,
        peakHours,
      };
    }
  }

  return {
    period: req.period,
    periodDays: periodDaysValue,
    periodFrom: from.toISOString(),
    periodTo: to.toISOString(),
    topPeriod: req.topPeriod,
    topPeriodFrom: topWin.from.toISOString(),
    topPeriodTo: topWin.to.toISOString(),
    fewestPeriod: req.fewestPeriod,
    fewestPeriodFrom: fewWin.from.toISOString(),
    fewestPeriodTo: fewWin.to.toISOString(),
    partial,
    overview,
    networkBookingKpis,
    networkMonthComparison,
    networkTopStations,
    networkBottomStations,
    sessionStatsViewPage: {
      items: sessionPageRows,
      total: sessionTotal,
      page: sessionPage,
      pageSize: sessionSize,
    },
    portStatsViewPage: {
      items: portPageRows,
      total: portTotal,
      page: portPage,
      pageSize: portSize,
    },
    peakForStation,
    stationId: resolvedStationId,
    stationDetail,
  };
}

/** Один рядок з `GetStationSessionStatsForPeriod` для REST деталей станції. */
export async function queryGetStationSessionStatsForPeriod(
  stationId: number,
  period: StationAdminAnalyticsPeriod
): Promise<{
  row: Record<string, unknown> | null;
  partial: boolean;
  periodFrom: string;
  periodTo: string;
}> {
  let partial = false;
  const mark = () => {
    partial = true;
  };
  const { from, to } = stationAdminAnalyticsWindows(period);
  const row = await safeQueryOne(
    "getStationSessionStatsForPeriod",
    () =>
      db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM getstationsessionstatsforperiod($1::int, $2::timestamptz, $3::timestamptz)`,
        stationId,
        from,
        to
      ),
    mark
  );
  return {
    row,
    partial,
    periodFrom: from.toISOString(),
    periodTo: to.toISOString(),
  };
}
