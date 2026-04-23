import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

const RANK_LIMIT = 10;

/** Узгоджено з `analyticsPeriodWindows` у `userAnalyticsRepository.ts` — [from, to) за start_time сесії / бронювання. */
export type StationAdminAnalyticsPeriod = "today" | "7d" | "30d" | "all";

export function parseStationAdminAnalyticsPeriod(raw: string | undefined): StationAdminAnalyticsPeriod {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "all") return raw;
  return "30d";
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

export type StationAdminStationDetail = {
  sessionStats: Record<string, unknown> | null;
  bookingStats: Record<string, unknown> | null;
  utilization: Record<string, unknown> | null;
  ports: Record<string, unknown>[];
  connectors: Record<string, unknown>[];
  peakHours: Record<string, unknown>[];
};

export type StationAdminSnapshot = {
  period: StationAdminAnalyticsPeriod;
  /** Днів у вікні [periodFrom, periodTo); для `all` — null. */
  periodDays: number | null;
  periodFrom: string;
  periodTo: string;
  partial: boolean;
  networkBookingKpis: Record<string, unknown> | null;
  networkTopStations: Record<string, unknown>[];
  networkBottomStations: Record<string, unknown>[];
  /** Станція, для якої зібрано stationDetail (якщо є). */
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

export async function queryStationAdminAnalyticsSnapshot(
  stationId?: number,
  period: StationAdminAnalyticsPeriod = "30d"
): Promise<StationAdminSnapshot> {
  let partial = false;
  const mark = () => {
    partial = true;
  };

  const { from, to } = stationAdminAnalyticsWindows(period);
  const periodDaysValue =
    period === "all" ? null : Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));

  const [networkBookingKpis, networkTopStations, networkBottomStations] = await Promise.all([
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
    safeQuery(
      "networkTopStations",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getnetworkstationsmostsessions($1::timestamptz, $2::timestamptz, $3::int)`,
          from,
          to,
          RANK_LIMIT
        ),
      mark
    ),
    safeQuery(
      "networkBottomStations",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getnetworkstationsfewestsessions($1::timestamptz, $2::timestamptz, $3::int)`,
          from,
          to,
          RANK_LIMIT
        ),
      mark
    ),
  ]);

  let stationDetail: StationAdminStationDetail | null = null;
  let resolvedStationId: number | null = null;

  if (stationId != null && Number.isFinite(stationId) && stationId > 0) {
    const exists = await db.station.findFirst({ where: { id: stationId }, select: { id: true } });
    if (exists) {
      resolvedStationId = stationId;
      const [sessionStats, bookingStats, utilization, ports, connectors, peakHours] = await Promise.all([
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
          "stationPorts",
          () =>
            db.$queryRawUnsafe<Record<string, unknown>[]>(
              `SELECT * FROM getstationportmetricsforperiod($1::int, $2::timestamptz, $3::timestamptz) ORDER BY port_number`,
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
        ports,
        connectors,
        peakHours,
      };
    }
  }

  return {
    period,
    periodDays: periodDaysValue,
    periodFrom: from.toISOString(),
    periodTo: to.toISOString(),
    partial,
    networkBookingKpis,
    networkTopStations,
    networkBottomStations,
    stationId: resolvedStationId,
    stationDetail,
  };
}
