import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

const DEFAULT_PERIOD_DAYS = 30;
const MIN_PERIOD_DAYS = 1;
const MAX_PERIOD_DAYS = 365;
function clampPeriodDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_PERIOD_DAYS;
  return Math.min(MAX_PERIOD_DAYS, Math.max(MIN_PERIOD_DAYS, Math.floor(days)));
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

function periodWindow(days: number): { from: Date; to: Date } {
  const d = clampPeriodDays(days);
  const anchor = new Date();
  if (d === 1) {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0);
    const to = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1, 0, 0, 0, 0);
    return { from, to };
  }
  const to = new Date();
  const from = new Date(to.getTime() - d * 86400000);
  return { from, to };
}

export type GlobalAdminSnapshot = {
  periodDays: number;
  periodFrom: string;
  periodTo: string;
  partial: boolean;
  /** GetSummarySessionStatisticByPeriod — сесії, kWh, прибуток, середні показники, середній чек. */
  networkSessionStats: Record<string, unknown> | null;
  networkRevenueTrendDaily: Record<string, unknown>[];
  /** GetAdminSessionStatsByBookingKindForPeriod — без броні / CALC / DEPOSIT. */
  networkSessionStatsByBookingKind: Record<string, unknown>[];
  /** View_Admin_SessionStatisticByPortType_30 (останні 30 днів, не залежить від повзунка періоду). */
  networkPortTypeStats: Record<string, unknown>[];
  /** `view_admin_top10mostprofitablecountries_30` у PostgreSQL (View.sql). */
  networkTopCountries: Record<string, unknown>[];
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

export async function queryGlobalAdminAnalyticsSnapshot(periodDays: number = DEFAULT_PERIOD_DAYS): Promise<GlobalAdminSnapshot> {
  let partial = false;
  const mark = () => {
    partial = true;
  };

  const days = clampPeriodDays(periodDays);
  const { from, to } = periodWindow(days);

  const [networkSessionStats, networkRevenueTrendDaily, networkSessionStatsByBookingKind, networkPortTypeStats, networkTopCountries] =
    await Promise.all([
    safeQueryOne(
      "networkSessionStats",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getsummarysessionstatisticbyperiod($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQuery(
      "networkRevenueTrendDaily",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminrevenuetrendbydays($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQuery(
      "networkSessionStatsByBookingKind",
      () =>
        db.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM getadminsessionstatsbybookingkindforperiod($1::timestamptz, $2::timestamptz)`,
          from,
          to
        ),
      mark
    ),
    safeQuery(
      "networkPortTypeStats",
      () => db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM view_admin_sessionstatisticbyporttype_30`),
      mark
    ),
    safeQuery(
      "networkTopCountries",
      () => db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM view_admin_top10mostprofitablecountries_30`),
      mark
    ),
  ]);

  return {
    periodDays: days,
    periodFrom: from.toISOString(),
    periodTo: to.toISOString(),
    partial,
    networkSessionStats,
    networkRevenueTrendDaily,
    networkSessionStatsByBookingKind,
    networkPortTypeStats,
    networkTopCountries,
  };
}
