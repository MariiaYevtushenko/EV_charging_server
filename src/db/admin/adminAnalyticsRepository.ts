import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import {
  queryStationAdminAnalyticsSnapshot,
  type StationAdminSnapshot,
} from "./stationAdminAnalyticsRepository.js";
import {
  queryGlobalAdminAnalyticsSnapshot,
  type GlobalAdminSnapshot,
} from "./globalAdminAnalyticsRepository.js";

const db = prisma as unknown as PrismaClient;

/** Імена VIEW у PostgreSQL (`DB_CODE_SQL/View.sql`, нижній регістр). */
const VIEW = {
  adminGlobalDashboard: "view_adminglobaldashboard",
  adminSessionStatisticByPortType30: "view_admin_sessionstatisticbyporttype_30",
} as const;

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

async function selectFromView(viewName: string, limit: number): Promise<Record<string, unknown>[]> {
  const lim = Math.min(100_000, Math.max(1, Math.floor(limit)));
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM ${viewName} LIMIT ${lim}`
  );
  return rows.map(serializeRow);
}

export type AdminAnalyticsViewsPayload = {
  globalDashboard: Record<string, unknown> | null;
  /** VIEW View_Admin_SessionStatisticByPortType_30 — мережа, останні 30 днів. */
  sessionStatsByPortType30d: Record<string, unknown>[];
  /** Функції з `Functions_Analitics.sql` + VIEW з `View.sql` (мережа + опційно stationId). */
  stationAdminSnapshot: StationAdminSnapshot;
  /** Функції з `Functions_Analitics.sql` (мережа за період). */
  globalAdminSnapshot: GlobalAdminSnapshot;
  /** Якщо true — хоча б один запит повернув порожньо через помилку (view може бути не застосовано). */
  partial: boolean;
};

/** Параметри зрізу `stationAdminSnapshot` (GET /api/admin/analytics/views). */
export type AdminStationViewsQuery = Partial<{
  stationId: number;
  period: string;
  topPeriod: string;
  fewestPeriod: string;
  sessionStatsPage: number;
  sessionStatsPageSize: number;
  /** Параметри з клієнта; сортування таблиці сесій може бути додано в SQL-пагінацію пізніше. */
  sessionStatsSortBy?: string;
  sessionStatsSortDir?: string;
  peakStationId: number;
  peakPeriod: string;
  portStatsPage?: number;
  portStatsPageSize?: number;
  /** Кількість днів для `globalAdminSnapshot` (функції Global_admin_analytics.sql), 1–365. */
  globalPeriodDays: number;
}>;

export async function queryAllAnalyticsViews(stationQuery?: AdminStationViewsQuery): Promise<AdminAnalyticsViewsPayload> {
  let partial = false;
  const globalPeriodDays = stationQuery?.globalPeriodDays ?? 30;

  const run = async (name: string, limit: number) => {
    try {
      return await selectFromView(name, limit);
    } catch (e) {
      console.error(`[adminAnalyticsRepository] VIEW ${name}:`, e);
      partial = true;
      return [];
    }
  };

  const [globalRows, sessionStatsByPortType30d, stationSnap, globalSnap] = await Promise.all([
    run(VIEW.adminGlobalDashboard, 2),
    run(VIEW.adminSessionStatisticByPortType30, 200),
    queryStationAdminAnalyticsSnapshot(stationQuery),
    queryGlobalAdminAnalyticsSnapshot(globalPeriodDays),
  ]);

  const globalDashboard = globalRows[0] ?? null;

  return {
    globalDashboard,
    sessionStatsByPortType30d,
    stationAdminSnapshot: stationSnap,
    globalAdminSnapshot: globalSnap,
    partial: partial || stationSnap.partial || globalSnap.partial,
  };
}
