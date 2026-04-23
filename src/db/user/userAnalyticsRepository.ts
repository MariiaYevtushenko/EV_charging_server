import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import {
  sqlGetUserBookingStatsForPeriod,
  sqlGetUserEnergySpendByDay,
  sqlGetUserEnergySpendByMonth,
  sqlGetUserSessionEnergySpendSummary,
  sqlGetUserSpendMonthOverPreviousMonth,
  sqlGetUserTopStationsByEnergy,
  sqlGetUserVehicleEnergySpendForPeriod,
  type SummarySqlRow,
  type UserBookingPeriodStatsRow,
  type UserSpendMonthMomRow,
} from "./userSqlAnalyticsFunctions.js";

const db = prisma as unknown as PrismaClient;

const VIEW = {
  userAnalyticsComparison: "view_useranalyticscomparison",
  userStationLoyalty: "view_userstationloyalty",
  activeSessions: "view_activesessions",
  upcomingBookings: "view_upcomingbookings",
} as const;

export type UserAnalyticsPeriod = "today" | "7d" | "30d" | "all";

export function parseUserAnalyticsPeriod(raw: string | undefined): UserAnalyticsPeriod {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "all") return raw;
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

async function selectFromViewWhereUser(
  viewKey: keyof typeof VIEW,
  userId: number,
  limit: number
): Promise<Record<string, unknown>[]> {
  const viewName = VIEW[viewKey];
  const lim = Math.min(10_000, Math.max(1, Math.floor(limit)));
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM ${viewName} WHERE user_id = $1 ORDER BY 1 LIMIT $2`,
    userId,
    lim
  );
  return rows.map(serializeRow);
}

/** Вікна [from, to) для підсумків / графіків, узгоджено з SQL у User_analytics.sql */
function analyticsPeriodWindows(period: UserAnalyticsPeriod): {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date } | null;
} {
  const anchor = new Date();
  const to = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1, 0, 0, 0, 0);
  if (period === "today") {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0);
    return {
      current: { from, to },
      previous: null,
    };
  }
  if (period === "7d") {
    const from = new Date(to.getTime() - 7 * 86400000);
    return {
      current: { from, to },
      previous: {
        from: new Date(from.getTime() - 7 * 86400000),
        to: from,
      },
    };
  }
  if (period === "30d") {
    const from = new Date(to.getTime() - 30 * 86400000);
    return {
      current: { from, to },
      previous: {
        from: new Date(from.getTime() - 30 * 86400000),
        to: from,
      },
    };
  }
  return {
    current: { from: new Date(0), to },
    previous: null,
  };
}

/** Поточний календарний місяць vs повний попередній — для % під KPI. */
function calendarMonthVsPreviousLocal(): {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
} {
  const now = new Date();
  const curStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  return {
    current: { from: curStart, to: now },
    previous: { from: prevStart, to: curStart },
  };
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (v != null && typeof v === "object" && "toString" in v) {
    const n = Number(String(v));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toSummary(row: SummarySqlRow | null): { sessionCount: number; totalKwh: number; totalSpent: number } {
  if (!row) {
    return { sessionCount: 0, totalKwh: 0, totalSpent: 0 };
  }
  return {
    sessionCount: Number(row.total_sessions ?? 0),
    totalKwh: num(row.total_kwh),
    totalSpent: num(row.total_revenue),
  };
}

function buildPeriodDetail(row: SummarySqlRow | null): {
  avgKwhPerSession: number;
  avgRevenuePerSession: number;
  avgSessionDurationMinutes: number;
  topStation: { id: number; name: string; visitCount: number } | null;
} {
  if (!row) {
    return {
      avgKwhPerSession: 0,
      avgRevenuePerSession: 0,
      avgSessionDurationMinutes: 0,
      topStation: null,
    };
  }
  const tid = row.top_station_id;
  const tname = row.top_station_name;
  return {
    avgKwhPerSession: row.avg_kwh_per_session != null ? num(row.avg_kwh_per_session) : 0,
    avgRevenuePerSession: row.avg_revenue_per_session != null ? num(row.avg_revenue_per_session) : 0,
    avgSessionDurationMinutes:
      row.avg_session_duration_minutes != null ? num(row.avg_session_duration_minutes) : 0,
    topStation:
      tid != null && tname
        ? { id: tid, name: String(tname), visitCount: Number(row.top_station_visit_count ?? 0) }
        : null,
  };
}

function pctMom(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  const p = ((curr - prev) / prev) * 100;
  return Number.isFinite(p) ? Math.round(p * 10) / 10 : null;
}

function mapBooking(row: UserBookingPeriodStatsRow | null) {
  if (!row) return null;
  const total = Number(row.total_bookings ?? 0);
  const out = {
    totalBookings: total,
    cntBooked: Number(row.cnt_booked ?? 0),
    cntCompleted: Number(row.cnt_completed ?? 0),
    cntMissed: Number(row.cnt_missed ?? 0),
    cntCancelled: Number(row.cnt_cancelled ?? 0),
    pctCompleted: row.pct_completed != null ? num(row.pct_completed) : null,
  };
  return total > 0 ? out : null;
}

function mapSmartInsights(row: UserSpendMonthMomRow | null): {
  spendVsPrevMonthPct: number | null;
  currentMonthSpendUah: number;
  prevMonthSpendUah: number;
} {
  if (!row) {
    return { spendVsPrevMonthPct: null, currentMonthSpendUah: 0, prevMonthSpendUah: 0 };
  }
  return {
    spendVsPrevMonthPct: row.pct_change != null ? num(row.pct_change) : null,
    currentMonthSpendUah: num(row.current_month_spend),
    prevMonthSpendUah: num(row.prev_month_spend),
  };
}

export type UserAnalyticsPayload = {
  period: UserAnalyticsPeriod;
  comparison: Record<string, unknown> | null;
  stationLoyalty: Record<string, unknown>[];
  activeSessions: Record<string, unknown>[];
  upcomingBookings: Record<string, unknown>[];
  periodSummary: { sessionCount: number; totalKwh: number; totalSpent: number };
  periodSessionDetail: {
    avgKwhPerSession: number;
    avgRevenuePerSession: number;
    avgSessionDurationMinutes: number;
    topStation: { id: number; name: string; visitCount: number } | null;
  };
  kpiVsPrevCalendarMonth: { sessionsPct: number | null; kwhPct: number | null; spentPct: number | null };
  /** Поточний календарний місяць (з 1-го до «зараз») vs повний попередній — ті самі вікна, що й для % MoM. */
  calendarMonthKpis: {
    current: { sessionCount: number; totalKwh: number; totalSpentUah: number };
    previous: { sessionCount: number; totalKwh: number; totalSpentUah: number };
  };
  /** Динаміка графіків: `month` = GetUserEnergySpendByMonth (лише «Увесь час»), `day` = GetUserEnergySpendByDay (сьогодні / 7 / 30 днів). */
  trendGranularity: "day" | "month";
  trend: { bucket: string; label: string; kwh: number; spend: number }[];
  stationsInPeriod: { stationId: number; stationName: string; sessionCount: number; kwh: number; spent: number }[];
  vehicleSpendInPeriod: {
    vehicleId: number;
    licensePlate: string;
    carLabel: string;
    sessionCount: number;
    totalKwh: number;
    totalRevenue: number;
  }[];
  bookingPeriod: ReturnType<typeof mapBooking>;
  smartInsights: ReturnType<typeof mapSmartInsights>;
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
  const cal = calendarMonthVsPreviousLocal();

  const [
    comparisonRows,
    stationLoyalty,
    activeSessions,
    upcomingBookings,
    periodAggRow,
    trendRows,
    stationRows,
    vehicleSpendRows,
    bookingRow,
    spendMom,
    calCurrRow,
    calPrevRow,
  ] = await Promise.all([
    safe("comparison", () => selectFromViewWhereUser("userAnalyticsComparison", userId, 5), []),
    safe("stationLoyalty", () => selectFromViewWhereUser("userStationLoyalty", userId, 50), []),
    safe("activeSessions", () => selectFromViewWhereUser("activeSessions", userId, 100), []),
    safe("upcomingBookings", () => selectFromViewWhereUser("upcomingBookings", userId, 200), []),
    safe("periodAgg", () => sqlGetUserSessionEnergySpendSummary(userId, wins.current.from, wins.current.to), null),
    safe(
      "trend",
      async () => {
        // «Увесь час» — місячні відрами (GetUserEnergySpendByMonth). Інакше — по добі (GetUserEnergySpendByDay): сьогодні, 7, 30 днів.
        if (period === "all") {
          const raw = await sqlGetUserEnergySpendByMonth(userId, wins.current.from, wins.current.to);
          return raw.map((r) => {
            const ms = r.month_start instanceof Date ? r.month_start : new Date(String(r.month_start));
            const bucket = ms.toISOString().slice(0, 7);
            const label = ms.toLocaleDateString("uk-UA", { month: "short", year: "numeric" });
            return {
              bucket,
              label,
              kwh: num(r.total_kwh),
              spend: num(r.total_revenue),
            };
          });
        }
        const raw = await sqlGetUserEnergySpendByDay(userId, wins.current.from, wins.current.to);
        return raw.map((r) => {
          const dayStr =
            r.day_bucket instanceof Date
              ? r.day_bucket.toISOString().slice(0, 10)
              : String(r.day_bucket).slice(0, 10);
          const d = new Date(`${dayStr}T12:00:00`);
          const label = Number.isNaN(d.getTime())
            ? dayStr
            : d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
          return {
            bucket: dayStr,
            label,
            kwh: num(r.total_kwh),
            spend: num(r.total_revenue),
          };
        });
      },
      []
    ),
    safe("stationsInPeriod", () => sqlGetUserTopStationsByEnergy(userId, wins.current.from, wins.current.to, 20), []),
    safe("vehicleSpendInPeriod", () => sqlGetUserVehicleEnergySpendForPeriod(userId, wins.current.from, wins.current.to), []),
    safe("bookingPeriod", () => sqlGetUserBookingStatsForPeriod(userId, wins.current.from, wins.current.to), null),
    safe("spendMom", () => sqlGetUserSpendMonthOverPreviousMonth(userId), null),
    safe("calCurr", () => sqlGetUserSessionEnergySpendSummary(userId, cal.current.from, cal.current.to), null),
    safe("calPrev", () => sqlGetUserSessionEnergySpendSummary(userId, cal.previous.from, cal.previous.to), null),
  ]);

  const periodSummary = toSummary(periodAggRow);
  const periodSessionDetail = buildPeriodDetail(periodAggRow);

  if (process.env.DEBUG_USER_ANALYTICS === "1") {
    console.log("[userAnalytics]", {
      userId,
      period,
      windowFrom: wins.current.from.toISOString(),
      windowTo: wins.current.to.toISOString(),
      rawGetUserSessionEnergySpendSummary: periodAggRow,
      periodSummary,
      periodSessionDetail,
      trendPoints: trendRows.length,
      stationsInPeriod: stationRows.length,
      vehicleSpendRows: vehicleSpendRows.length,
      partial,
    });
  }
  const currCal = toSummary(calCurrRow);
  const prevCal = toSummary(calPrevRow);
  const kpiVsPrevCalendarMonth = {
    sessionsPct: pctMom(currCal.sessionCount, prevCal.sessionCount),
    kwhPct: pctMom(currCal.totalKwh, prevCal.totalKwh),
    spentPct: pctMom(currCal.totalSpent, prevCal.totalSpent),
  };

  const calendarMonthKpis = {
    current: {
      sessionCount: currCal.sessionCount,
      totalKwh: currCal.totalKwh,
      totalSpentUah: currCal.totalSpent,
    },
    previous: {
      sessionCount: prevCal.sessionCount,
      totalKwh: prevCal.totalKwh,
      totalSpentUah: prevCal.totalSpent,
    },
  };

  const stationsInPeriod = stationRows.map((r) => ({
    stationId: r.station_id,
    stationName: r.station_name,
    sessionCount: Number(r.session_count ?? 0),
    kwh: num(r.total_kwh),
    spent: num(r.total_revenue),
  }));

  const vehicleSpendInPeriod = vehicleSpendRows.map((r) => {
    const brand = String(r.brand ?? "").trim();
    const model = String(r.model ?? "").trim();
    const carLabel = [brand, model].filter(Boolean).join(" ") || "—";
    return {
      vehicleId: r.vehicle_id,
      licensePlate: String(r.license_plate ?? ""),
      carLabel,
      sessionCount: Number(r.session_count ?? 0),
      totalKwh: num(r.total_kwh),
      totalRevenue: num(r.total_revenue),
    };
  });

  const trendGranularity: "day" | "month" = period === "all" ? "month" : "day";

  return {
    period,
    comparison: comparisonRows[0] ?? null,
    stationLoyalty,
    activeSessions,
    upcomingBookings,
    periodSummary,
    periodSessionDetail,
    kpiVsPrevCalendarMonth,
    calendarMonthKpis,
    trendGranularity,
    trend: trendRows,
    stationsInPeriod,
    vehicleSpendInPeriod,
    bookingPeriod: mapBooking(bookingRow),
    smartInsights: mapSmartInsights(spendMom),
    partial,
  };
}
