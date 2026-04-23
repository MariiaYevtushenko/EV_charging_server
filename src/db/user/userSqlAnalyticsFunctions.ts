import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

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

/** Рядок з `GetVehicleReportForPeriod` (04_reports.sql): завершені сесії + bill SUCCESS. */
export async function sqlGetVehicleReportForPeriod(
  vehicleId: number,
  from: Date,
  to: Date
): Promise<{ sessionCount: number; kwhTotal: number; revenueUah: number } | null> {
  try {
    const rows = await db.$queryRawUnsafe<
      { total_sessions: bigint | number | null; total_kwh: unknown; total_revenue: unknown }[]
    >(
      `SELECT * FROM getvehiclereportforperiod($1::int, $2::timestamp, $3::timestamp)`,
      vehicleId,
      from,
      to
    );
    const r = rows[0];
    if (!r) return { sessionCount: 0, kwhTotal: 0, revenueUah: 0 };
    return {
      sessionCount: Number(r.total_sessions ?? 0),
      kwhTotal: Math.round(num(r.total_kwh) * 1000) / 1000,
      revenueUah: Math.round(num(r.total_revenue) * 100) / 100,
    };
  } catch {
    return null;
  }
}

export type SummarySqlRow = {
  total_sessions: bigint | number | null;
  total_kwh: unknown;
  total_revenue: unknown;
  avg_kwh_per_session: unknown;
  avg_revenue_per_session: unknown;
  avg_session_duration_minutes: unknown;
  top_station_id: number | null;
  top_station_name: string | null;
  top_station_visit_count: bigint | number | null;
};

/** Зведення `GetUserSessionEnergySpendSummary` (User_analytics.sql). */
export async function sqlGetUserSessionEnergySpendSummary(
  userId: number,
  from: Date,
  to: Date
): Promise<SummarySqlRow | null> {
  try {
    const rows = await db.$queryRawUnsafe<SummarySqlRow[]>(
      `SELECT total_sessions, total_kwh, total_revenue,
              avg_kwh_per_session, avg_revenue_per_session, avg_session_duration_minutes,
              top_station_id, top_station_name, top_station_visit_count
       FROM getusersessionenergyspendsummary($1::int, $2::timestamp, $3::timestamp)`,
      userId,
      from,
      to
    );
    return rows[0] ?? null;
  } catch (e) {
    console.error("[sqlGetUserSessionEnergySpendSummary]", {
      userId,
      from: from instanceof Date ? from.toISOString() : String(from),
      to: to instanceof Date ? to.toISOString() : String(to),
      error: e,
    });
    return null;
  }
}

export type UserVehicleSpendPeriodRow = {
  vehicle_id: number;
  license_plate: string;
  brand: string;
  model: string;
  session_count: number | bigint | null;
  total_kwh: unknown;
  total_revenue: unknown;
};

export async function sqlGetUserVehicleEnergySpendForPeriod(
  userId: number,
  from: Date,
  to: Date
): Promise<UserVehicleSpendPeriodRow[]> {
  try {
    return await db.$queryRawUnsafe<UserVehicleSpendPeriodRow[]>(
      `SELECT vehicle_id, license_plate, brand, model, session_count, total_kwh, total_revenue
       FROM getuservehicleenergyspendforperiod($1::int, $2::timestamp, $3::timestamp)
       LIMIT 40`,
      userId,
      from,
      to
    );
  } catch {
    return [];
  }
}

export async function sqlGetUserEnergySpendByDay(
  userId: number,
  from: Date,
  to: Date
): Promise<{ day_bucket: Date | string; session_count: bigint | number; total_kwh: unknown; total_revenue: unknown }[]> {
  try {
    return await db.$queryRawUnsafe<
      { day_bucket: Date | string; session_count: bigint | number; total_kwh: unknown; total_revenue: unknown }[]
    >(
      `SELECT day_bucket, session_count, total_kwh, total_revenue FROM getuserenergyspendbyday($1::int, $2::timestamp, $3::timestamp) ORDER BY day_bucket ASC`,
      userId,
      from,
      to
    );
  } catch {
    return [];
  }
}

export async function sqlGetUserEnergySpendByMonth(
  userId: number,
  from: Date,
  to: Date
): Promise<
  { month_start: Date | string; session_count: bigint | number; total_kwh: unknown; total_revenue: unknown }[]
> {
  try {
    return await db.$queryRawUnsafe<
      { month_start: Date | string; session_count: bigint | number; total_kwh: unknown; total_revenue: unknown }[]
    >(
      `SELECT month_start, session_count, total_kwh, total_revenue FROM getuserenergyspendbymonth($1::int, $2::timestamp, $3::timestamp) ORDER BY month_start ASC`,
      userId,
      from,
      to
    );
  } catch {
    return [];
  }
}

export async function sqlGetUserTopStationsByEnergy(
  userId: number,
  from: Date,
  to: Date,
  limit: number
): Promise<
  { station_id: number; station_name: string; session_count: number | bigint; total_kwh: unknown; total_revenue: unknown }[]
> {
  try {
    return await db.$queryRawUnsafe<
      { station_id: number; station_name: string; session_count: number | bigint; total_kwh: unknown; total_revenue: unknown }[]
    >(
      `SELECT station_id, station_name, session_count, total_kwh, total_revenue FROM getusertopstationsbyenergy($1::int, $2::timestamp, $3::timestamp, $4::int)`,
      userId,
      from,
      to,
      limit
    );
  } catch {
    return [];
  }
}

export type UserBookingPeriodStatsRow = {
  total_bookings: bigint | number | null;
  cnt_booked: bigint | number | null;
  cnt_completed: bigint | number | null;
  cnt_missed: bigint | number | null;
  cnt_cancelled: bigint | number | null;
  pct_completed: unknown;
};

export async function sqlGetUserBookingStatsForPeriod(
  userId: number,
  from: Date,
  to: Date
): Promise<UserBookingPeriodStatsRow | null> {
  try {
    const rows = await db.$queryRawUnsafe<UserBookingPeriodStatsRow[]>(
      `SELECT * FROM getuserbookingstatsforperiod($1::int, $2::timestamp, $3::timestamp)`,
      userId,
      from,
      to
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export type UserSpendMonthMomRow = {
  current_month_spend: unknown;
  prev_month_spend: unknown;
  pct_change: unknown;
};

export async function sqlGetUserSpendMonthOverPreviousMonth(userId: number): Promise<UserSpendMonthMomRow | null> {
  try {
    const rows = await db.$queryRawUnsafe<UserSpendMonthMomRow[]>(
      `SELECT * FROM getuserspendmonthoverpreviousmonth($1::int)`,
      userId
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
