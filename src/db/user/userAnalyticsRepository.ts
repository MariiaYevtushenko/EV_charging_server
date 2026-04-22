import { Prisma } from "../../../generated/prisma/index.js";
import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";

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

function periodFilterSql(period: UserAnalyticsPeriod): Prisma.Sql {
  if (period === "all") return Prisma.sql`TRUE`;
  if (period === "7d") return Prisma.sql`s.start_time >= now() - interval '7 days'`;
  return Prisma.sql`s.start_time >= now() - interval '30 days'`;
}

function previousPeriodFilterSql(period: UserAnalyticsPeriod): Prisma.Sql | null {
  if (period === "7d") {
    return Prisma.sql`s.start_time >= now() - interval '14 days' AND s.start_time < now() - interval '7 days'`;
  }
  if (period === "30d") {
    return Prisma.sql`s.start_time >= now() - interval '60 days' AND s.start_time < now() - interval '30 days'`;
  }
  return null;
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

  const timeFilter = periodFilterSql(period);
  const prevFilter = previousPeriodFilterSql(period);

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
  ] = await Promise.all([
    safe("comparison", () => selectFromViewWhereUser("userAnalyticsComparison", userId, 5), []),
    safe("vehicleStats", () => selectFromViewWhereUser("userVehicleStats", userId, 500), []),
    safe("stationLoyalty", () => selectFromViewWhereUser("userStationLoyalty", userId, 50), []),
    safe("activeSessions", () => selectFromViewWhereUser("activeSessions", userId, 100), []),
    safe("upcomingBookings", () => selectFromViewWhereUser("upcomingBookings", userId, 200), []),
    safe(
      "periodAgg",
      async () => {
        const rows = await db.$queryRaw<SummaryRow[]>(Prisma.sql`
          SELECT
            COUNT(s.id)::bigint AS session_count,
            COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
            COALESCE(SUM(b.calculated_amount), 0) AS total_spent
          FROM session s
          LEFT JOIN bill b ON b.session_id = s.id
          WHERE s.user_id = ${userId} AND ${timeFilter}
        `);
        return rows[0];
      },
      undefined
    ),
    safe(
      "prevAgg",
      async () => {
        if (!prevFilter) return undefined;
        const rows = await db.$queryRaw<SummaryRow[]>(Prisma.sql`
          SELECT
            COUNT(s.id)::bigint AS session_count,
            COALESCE(SUM(s.kwh_consumed), 0) AS total_kwh,
            COALESCE(SUM(b.calculated_amount), 0) AS total_spent
          FROM session s
          LEFT JOIN bill b ON b.session_id = s.id
          WHERE s.user_id = ${userId} AND ${prevFilter}
        `);
        return rows[0];
      },
      undefined
    ),
    safe(
      "trend",
      async () => {
        if (period === "all") {
          const raw = await db.$queryRaw<{ bucket: string; kwh: unknown; spend: unknown }[]>(Prisma.sql`
            SELECT
              to_char(date_trunc('month', s.start_time), 'YYYY-MM') AS bucket,
              COALESCE(SUM(s.kwh_consumed), 0) AS kwh,
              COALESCE(SUM(b.calculated_amount), 0) AS spend
            FROM session s
            LEFT JOIN bill b ON b.session_id = s.id
            WHERE s.user_id = ${userId}
            GROUP BY date_trunc('month', s.start_time), to_char(date_trunc('month', s.start_time), 'YYYY-MM')
            ORDER BY date_trunc('month', s.start_time)
            LIMIT 48
          `);
          return raw.map((r) => {
            const parts = r.bucket.split("-").map(Number);
            const y = parts[0] ?? 1970;
            const mo = parts[1] ?? 1;
            const label = new Date(y, mo - 1, 1).toLocaleDateString("uk-UA", { month: "short", year: "numeric" });
            return {
              bucket: r.bucket,
              label,
              kwh: Number(serializeCell(r.kwh) ?? 0) || 0,
              spend: Number(serializeCell(r.spend) ?? 0) || 0,
            };
          });
        }
        const raw = await db.$queryRaw<{ bucket: string; kwh: unknown; spend: unknown }[]>(Prisma.sql`
          SELECT
            to_char(date_trunc('day', s.start_time), 'YYYY-MM-DD') AS bucket,
            COALESCE(SUM(s.kwh_consumed), 0) AS kwh,
            COALESCE(SUM(b.calculated_amount), 0) AS spend
          FROM session s
          LEFT JOIN bill b ON b.session_id = s.id
          WHERE s.user_id = ${userId} AND ${timeFilter}
          GROUP BY date_trunc('day', s.start_time), to_char(date_trunc('day', s.start_time), 'YYYY-MM-DD')
          ORDER BY date_trunc('day', s.start_time)
        `);
        return raw.map((r) => {
          const d = new Date(`${r.bucket}T12:00:00`);
          const label = Number.isNaN(d.getTime())
            ? r.bucket
            : d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
          return {
            bucket: r.bucket,
            label,
            kwh: Number(serializeCell(r.kwh) ?? 0) || 0,
            spend: Number(serializeCell(r.spend) ?? 0) || 0,
          };
        });
      },
      []
    ),
    safe(
      "stationsInPeriod",
      async () => {
        const raw = await db.$queryRaw<
          { station_id: number; station_name: string; kwh: unknown; spent: unknown }[]
        >(Prisma.sql`
          SELECT
            st.id AS station_id,
            st.name AS station_name,
            COALESCE(SUM(s.kwh_consumed), 0) AS kwh,
            COALESCE(SUM(b.calculated_amount), 0) AS spent
          FROM session s
          JOIN station st ON st.id = s.station_id
          LEFT JOIN bill b ON b.session_id = s.id
          WHERE s.user_id = ${userId} AND ${timeFilter}
          GROUP BY st.id, st.name
          ORDER BY SUM(s.kwh_consumed) DESC NULLS LAST
          LIMIT 20
        `);
        return raw.map((r) => ({
          stationId: r.station_id,
          stationName: r.station_name,
          kwh: Number(serializeCell(r.kwh) ?? 0) || 0,
          spent: Number(serializeCell(r.spent) ?? 0) || 0,
        }));
      },
      []
    ),
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
    previousPeriodSummary: prevFilter ? toSummary(prevAgg) : null,
    trend: trendSeries,
    stationsInPeriod: stationsBreakdown,
    partial,
  };
}
