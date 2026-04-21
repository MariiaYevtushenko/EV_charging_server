import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import { TariffPeriod } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfTomorrowLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

function addCalendarDays(base: Date, n: number): Date {
  const x = new Date(base);
  x.setDate(x.getDate() + n);
  return x;
}

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Ключ YYYY-MM-DD для дати з БД (PostgreSQL date). */
function dateKeyFromDb(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export type ForecastPredictionPointDto = {
  date: string;
  /** Прогноз SARIMA + корекція bias (як у бронюванні), грн/кВт·год */
  dayUah: number | null;
  nightUah: number | null;
};

export type ForecastPredictionsResponseDto = {
  from: string;
  to: string;
  days: number;
  points: ForecastPredictionPointDto[];
};

/**
 * Наступні `days` календарних днів від завтра: прогнози з tariff_prediction
 * зі зміщенням з forecast_bias (день/ніч окремо).
 */
export async function listTariffPredictionsForAdmin(days: number): Promise<ForecastPredictionsResponseDto> {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  const start = startOfTomorrowLocal();
  const end = addCalendarDays(start, safeDays - 1);

  const [rows, biasDayRow, biasNightRow] = await Promise.all([
    db.tariffPrediction.findMany({
      where: {
        targetDate: { gte: start, lte: end },
      },
    }),
    db.forecastBias.findUnique({ where: { tariffType: TariffPeriod.DAY } }),
    db.forecastBias.findUnique({ where: { tariffType: TariffPeriod.NIGHT } }),
  ]);

  const biasDay = biasDayRow ? Number(biasDayRow.biasValue) : 0;
  const biasNight = biasNightRow ? Number(biasNightRow.biasValue) : 0;

  const byDate = new Map<string, { day?: number; night?: number }>();
  for (const r of rows) {
    const key = dateKeyFromDb(r.targetDate);
    let e = byDate.get(key);
    if (!e) {
      e = {};
      byDate.set(key, e);
    }
    const p = Number(r.predictedPrice);
    if (r.tariffType === TariffPeriod.DAY) {
      e.day = p;
    } else if (r.tariffType === TariffPeriod.NIGHT) {
      e.night = p;
    }
  }

  const points: ForecastPredictionPointDto[] = [];
  for (let i = 0; i < safeDays; i++) {
    const d = addCalendarDays(start, i);
    const key = formatYmdLocal(d);
    const raw = byDate.get(key);
    const dayRaw = raw?.day;
    const nightRaw = raw?.night;
    points.push({
      date: key,
      dayUah: dayRaw != null ? Math.max(0, round2(dayRaw + biasDay)) : null,
      nightUah: nightRaw != null ? Math.max(0, round2(nightRaw + biasNight)) : null,
    });
  }

  return {
    from: points[0]?.date ?? formatYmdLocal(start),
    to: points[points.length - 1]?.date ?? formatYmdLocal(end),
    days: safeDays,
    points,
  };
}
