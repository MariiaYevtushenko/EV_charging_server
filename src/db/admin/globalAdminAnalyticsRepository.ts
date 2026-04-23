import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

const DEFAULT_PERIOD_DAYS = 30;
const CITY_HOTSPOT_LIMIT = 15;
const PORT_ROW_LIMIT = 500;

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

function periodWindow(days: number): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - Math.max(1, Math.min(365, days)) * 86400000);
  return { from, to };
}

export type GlobalAdminSnapshot = {
  periodDays: number;
  periodFrom: string;
  periodTo: string;
  partial: boolean;
  networkSessionStats: Record<string, unknown> | null;
  networkRevenueByStation: Record<string, unknown>[];
  networkRevenueByPort: Record<string, unknown>[];
  networkPeakHours: Record<string, unknown>[];
  networkRevenueTrendDaily: Record<string, unknown>[];
  networkDayNightRevenue: Record<string, unknown>[];
  networkCityHotspots: Record<string, unknown>[];
  networkBookingSessionMetrics: Record<string, unknown> | null;
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
    console.error(`[globalAdminAnalyticsRepository] ${label}:`, e);
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

export async function queryGlobalAdminAnalyticsSnapshot(): Promise<GlobalAdminSnapshot> {
  let partial = false;
  const mark = () => {
    partial = true;
  };

  const { from, to } = periodWindow(DEFAULT_PERIOD_DAYS);

  const [
    networkSessionStats,
    networkRevenueByStation,
    networkRevenueByPort,
    networkPeakHours,
    networkRevenueTrendDaily,
    networkDayNightRevenue,
    networkCityHotspots,
    networkBookingSessionMetrics,
  ] = await Promise.all([
    safeQueryOne(
      "networkSessionStats",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminnetworksessionstatsforperiod($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQuery(
      "networkRevenueByStation",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminnetworkrevenuebystationforperiod($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQuery(
      "networkRevenueByPort",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminnetworkrevenuebyportforperiod($1::timestamptz, $2::timestamptz, $3::int)`,
          from,
          to,
          PORT_ROW_LIMIT
        ),
      mark
    ),
    safeQuery(
      "networkPeakHours",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminnetworkpeakhourbuckets($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQuery(
      "networkRevenueTrendDaily",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminnetworkrevenuetrenddailyforperiod($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQuery(
      "networkDayNightRevenue",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminnetworkdaynightrevenueproxyforperiod($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQuery(
      "networkCityHotspots",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminnetworkcityhotspotsforperiod($1::timestamptz, $2::timestamptz, $3::int)`,
          from,
          to,
          CITY_HOTSPOT_LIMIT
        ),
      mark
    ),
    safeQueryOne(
      "networkBookingSessionMetrics",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminnetworkbookingsessionmetricsforperiod($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
  ]);

  return {
    periodDays: DEFAULT_PERIOD_DAYS,
    periodFrom: from.toISOString(),
    periodTo: to.toISOString(),
    partial,
    networkSessionStats,
    networkRevenueByStation,
    networkRevenueByPort,
    networkPeakHours,
    networkRevenueTrendDaily,
    networkDayNightRevenue,
    networkCityHotspots,
    networkBookingSessionMetrics,
  };
}
