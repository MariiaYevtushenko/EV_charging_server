import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import {
  parseStationAdminAnalyticsPeriod,
  queryStationAdminAnalyticsSnapshot,
  type StationAdminAnalyticsPeriod,
  type StationAdminSnapshot,
} from "./stationAdminAnalyticsRepository.js";
import {
  queryGlobalAdminAnalyticsSnapshot,
  type GlobalAdminSnapshot,
} from "./globalAdminAnalyticsRepository.js";

const db = prisma as unknown as PrismaClient;

/** Імена VIEW у PostgreSQL (незліплені ідентифікатори → нижній регістр). */
const VIEW = {
  adminGlobalDashboard: "view_adminglobaldashboard",
  stationPerformance: "view_stationperformance",
  userAnalyticsComparison: "view_useranalyticscomparison",
  userVehicleStats: "view_uservehiclestats",
  userStationLoyalty: "view_userstationloyalty",
  adminCityPerformance: "view_admin_city_performance",
  adminUserSegments: "view_admin_user_segments",
  activeSessions: "view_activesessions",
  upcomingBookings: "view_upcomingbookings",
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
  stationPerformance: Record<string, unknown>[];
  userAnalyticsComparison: Record<string, unknown>[];
  userVehicleStats: Record<string, unknown>[];
  userStationLoyalty: Record<string, unknown>[];
  cityPerformance: Record<string, unknown>[];
  userSegments: Record<string, unknown>[];
  activeSessions: Record<string, unknown>[];
  upcomingBookings: Record<string, unknown>[];
  /** Функції з Station_admin_analytics.sql (мережа + опційно stationId). */
  stationAdminSnapshot: StationAdminSnapshot;
  /** Функції з Global_admin_analytics.sql (мережа за період). */
  globalAdminSnapshot: GlobalAdminSnapshot;
  /** Якщо true — хоча б один запит повернув порожньо через помилку (view може бути не застосовано). */
  partial: boolean;
};

export async function queryAllAnalyticsViews(
  stationId?: number,
  stationPeriodRaw?: string
): Promise<AdminAnalyticsViewsPayload> {
  const stationPeriod: StationAdminAnalyticsPeriod = parseStationAdminAnalyticsPeriod(stationPeriodRaw);
  let partial = false;

  const run = async (name: string, limit: number) => {
    try {
      return await selectFromView(name, limit);
    } catch (e) {
      console.error(`[adminAnalyticsRepository] VIEW ${name}:`, e);
      partial = true;
      return [];
    }
  };

  const [
    globalRows,
    stationPerformance,
    userAnalyticsComparison,
    userVehicleStats,
    userStationLoyalty,
    cityPerformance,
    userSegments,
    activeSessions,
    upcomingBookings,
    stationSnap,
    globalSnap,
  ] = await Promise.all([
    run(VIEW.adminGlobalDashboard, 2),
    run(VIEW.stationPerformance, 3000),
    run(VIEW.userAnalyticsComparison, 8000),
    run(VIEW.userVehicleStats, 8000),
    run(VIEW.userStationLoyalty, 800),
    run(VIEW.adminCityPerformance, 500),
    run(VIEW.adminUserSegments, 3000),
    run(VIEW.activeSessions, 500),
    run(VIEW.upcomingBookings, 500),
    queryStationAdminAnalyticsSnapshot(stationId, stationPeriod),
    queryGlobalAdminAnalyticsSnapshot(),
  ]);

  const globalDashboard = globalRows[0] ?? null;

  return {
    globalDashboard,
    stationPerformance,
    userAnalyticsComparison,
    userVehicleStats,
    userStationLoyalty,
    cityPerformance,
    userSegments,
    activeSessions,
    upcomingBookings,
    stationAdminSnapshot: stationSnap,
    globalAdminSnapshot: globalSnap,
    partial: partial || stationSnap.partial || globalSnap.partial,
  };
}
