import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import {
  sqlGetUserBookingStatsForPeriod,
  sqlGetUserEnergySpendByDay,
  sqlGetUserEnergySpendByMonth,
  sqlGetUserSessionEnergySpendSummary,
  sqlGetUserTopStationsByEnergy,
  type UserBookingPeriodStatsRow,
  type SummarySqlRow,
} from "./userSqlAnalyticsFunctions.js";

const db = prisma as unknown as PrismaClient;

const VIEW = {
  userAnalyticsComparison: "view_useranalyticscomparison",
  userVehicleStats: "view_uservehiclestats",
  userStationLoyalty: "view_userstationloyalty",
  activeSessions: "view_activesessions",
  upcomingBookings: "view_upcomingbookings",
} as const;

/** Лише константи — для ORDER BY у динамічному запиті до VIEW. */
const VIEW_ORDER_SQL: Record<keyof typeof VIEW, string> = {
  userAnalyticsComparison: "user_id",
  userVehicleStats: "total_kwh DESC NULLS LAST",
  userStationLoyalty: "preference_rank ASC",
  activeSessions: "start_time DESC",
  upcomingBookings: "start_time ASC",
};

export type UserAnalyticsPeriod = "7d" | "30d" | "all";

export function parseUserAnalyticsPeriod(raw: string | undefined): UserAnalyticsPeriod {
  if (raw === "7d" || raw === "30d" || raw === "all") return raw;
  return "30d";
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

/** Вікна [from, to) для підсумків / графіків, узгоджено з SQL-функціями в User_analytics.sql */
function analyticsPeriodWindows(period: UserAnalyticsPeriod): {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date } | null;
} {
  const anchor = new Date();
  if (period === "7d") {
    return {
      current: {
        from: new Date(anchor.getTime() - 7 * 86400000),
        to: anchor,
      },
      previous: {
        from: new Date(anchor.getTime() - 14 * 86400000),
        to: new Date(anchor.getTime() - 7 * 86400000),
      },
    };
  }
  if (period === "30d") {
    return {
      current: {
        from: new Date(anchor.getTime() - 30 * 86400000),
        to: anchor,
      },
      previous: {
        from: new Date(anchor.getTime() - 60 * 86400000),
        to: new Date(anchor.getTime() - 30 * 86400000),
      },
    };
  }
  return {
    current: { from: new Date(0), to: new Date(anchor.getTime() + 86400000) },
    previous: null,
  };
}

function summaryFromSqlRow(r: SummarySqlRow | null | undefined): SummaryRow | undefined {
  if (!r) return undefined;
  return {
    session_count: r.total_sessions,
    total_kwh: r.total_kwh,
    total_spent: r.total_revenue,
  };
}

async function selectFromViewWhereUser(
  viewKey: keyof typeof VIEW,
  userId: number,
  limit: number
): Promise<Record<string, unknown>[]> {
  const viewName = VIEW[viewKey];
  const orderSql = VIEW_ORDER_SQL[viewKey];
  const lim = Math.min(10_000, Math.max(1, Math.floor(limit)));
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM ${viewName} WHERE user_id = $1 ORDER BY ${orderSql} LIMIT $2`,
    userId,
    lim
  );
  return rows.map(serializeRow);
}

type SummaryRow = {
  session_count: bigint | number | null;
  total_kwh: unknown;
  total_spent: unknown;
};

function toSummary(row: SummaryRow | undefined): { sessionCount: number; totalKwh: number; totalSpent: number } {
  if (!row) {
    return { sessionCount: 0, totalKwh: 0, totalSpent: 0 };
  }
  const sessionCount = Number(row.session_count ?? 0);
  return {
    sessionCount: Number.isFinite(sessionCount) ? sessionCount : 0,
    totalKwh: Number(serializeCell(row.total_kwh) ?? 0) || 0,
    totalSpent: Number(serializeCell(row.total_spent) ?? 0) || 0,
  };
}

export type UserBookingPeriodPayload = {
  totalBookings: number;
  cntBooked: number;
  cntCompleted: number;
  cntMissed: number;
  cntCancelled: number;
  pctCompleted: number | null;
};

function mapBookingPeriodStats(row: UserBookingPeriodStatsRow | null): UserBookingPeriodPayload | null {
  if (!row) return null;
  const pct = row.pct_completed;
  const pctNum =
    pct == null || pct === ""
      ? null
      : typeof pct === "number"
        ? pct
        : Number(String(pct));
  return {
    totalBookings: Number(row.total_bookings ?? 0),
    cntBooked: Number(row.cnt_booked ?? 0),
    cntCompleted: Number(row.cnt_completed ?? 0),
    cntMissed: Number(row.cnt_missed ?? 0),
    cntCancelled: Number(row.cnt_cancelled ?? 0),
    pctCompleted: pctNum != null && Number.isFinite(pctNum) ? pctNum : null,
  };
}

export type UserAnalyticsPayload = {
  period: UserAnalyticsPeriod;
  comparison: Record<string, unknown> | null;
  vehicleStats: Record<string, unknown>[];
  stationLoyalty: Record<string, unknown>[];
  activeSessions: Record<string, unknown>[];
  upcomingBookings: Record<string, unknown>[];
  periodSummary: { sessionCount: number; totalKwh: number; totalSpent: number };
  previousPeriodSummary: { sessionCount: number; totalKwh: number; totalSpent: number } | null;
  trend: { bucket: string; label: string; kwh: number; spend: number }[];
  stationsInPeriod: { stationId: number; stationName: string; kwh: number; spent: number }[];
  /** Бронювання за той самий інтервал, що й periodSummary (`GetUserBookingStatsForPeriod`). */
  bookingPeriod: UserBookingPeriodPayload | null;
  partial: boolean;
};

export async function queryUserAnalytics(userId: number, period: UserAnalyticsPeriod): Promise<UserAnalyticsPayload> {
  let partial = false;
  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      console.error(`[userAnalyticsRepository] ${label}:`, e);
      partial = true;
      return fallback;
    }
  };

  const wins = analyticsPeriodWindows(period);

  const [
    comparisonRows,
    vehicleStats,
    stationLoyalty,
    activeSessions,
    upcomingBookings,
    periodAgg,
    prevAgg,
    trendSeries,
    stationsBreakdown,
    bookingPeriodRow,
  ] = await Promise.all([
    safe("comparison", () => selectFromViewWhereUser("userAnalyticsComparison", userId, 5), []),
    safe("vehicleStats", () => selectFromViewWhereUser("userVehicleStats", userId, 500), []),
    safe("stationLoyalty", () => selectFromViewWhereUser("userStationLoyalty", userId, 50), []),
    safe("activeSessions", () => selectFromViewWhereUser("activeSessions", userId, 100), []),
    safe("upcomingBookings", () => selectFromViewWhereUser("upcomingBookings", userId, 200), []),
    safe(
      "periodAgg",
      async () =>
        summaryFromSqlRow(
          await sqlGetUserSessionEnergySpendSummary(userId, wins.current.from, wins.current.to)
        ),
      undefined
    ),
    safe(
      "prevAgg",
      async () => {
        if (!wins.previous) return undefined;
        return summaryFromSqlRow(
          await sqlGetUserSessionEnergySpendSummary(userId, wins.previous.from, wins.previous.to)
        );
      },
      undefined
    ),
    safe(
      "trend",
      async () => {
        if (period === "all") {
          const raw = await sqlGetUserEnergySpendByMonth(userId, wins.current.from, wins.current.to);
          const sliced = raw.slice(-48);
          return sliced.map((r) => {
            const ms = r.month_start instanceof Date ? r.month_start : new Date(String(r.month_start));
            const bucket = `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, "0")}`;
            const label = Number.isNaN(ms.getTime())
              ? bucket
              : ms.toLocaleDateString("uk-UA", { month: "short", year: "numeric" });
            return {
              bucket,
              label,
              kwh: Number(serializeCell(r.total_kwh) ?? 0) || 0,
              spend: Number(serializeCell(r.total_revenue) ?? 0) || 0,
            };
          });
        }
        const raw = await sqlGetUserEnergySpendByDay(userId, wins.current.from, wins.current.to);
        return raw.map((r) => {
          const bucket =
            r.day_bucket instanceof Date
              ? r.day_bucket.toISOString().slice(0, 10)
              : String(r.day_bucket).slice(0, 10);
          const d = new Date(`${bucket}T12:00:00`);
          const label = Number.isNaN(d.getTime())
            ? bucket
            : d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
          return {
            bucket,
            label,
            kwh: Number(serializeCell(r.total_kwh) ?? 0) || 0,
            spend: Number(serializeCell(r.total_revenue) ?? 0) || 0,
          };
        });
      },
      []
    ),
    safe(
      "stationsInPeriod",
      async () => {
        const raw = await sqlGetUserTopStationsByEnergy(userId, wins.current.from, wins.current.to, 20);
        return raw.map((r) => ({
          stationId: r.station_id,
          stationName: r.station_name,
          kwh: Number(serializeCell(r.total_kwh) ?? 0) || 0,
          spent: Number(serializeCell(r.total_revenue) ?? 0) || 0,
        }));
      },
      []
    ),
    safe("bookingPeriod", async () => sqlGetUserBookingStatsForPeriod(userId, wins.current.from, wins.current.to), null),
  ]);

  const comparison = comparisonRows[0] ?? null;

  return {
    period,
    comparison,
    vehicleStats,
    stationLoyalty,
    activeSessions,
    upcomingBookings,
    periodSummary: toSummary(periodAgg),
    previousPeriodSummary: wins.previous ? toSummary(prevAgg) : null,
    trend: trendSeries,
    stationsInPeriod: stationsBreakdown,
    bookingPeriod: mapBookingPeriodStats(bookingPeriodRow),
    partial,
  };
}
