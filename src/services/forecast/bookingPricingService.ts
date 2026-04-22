import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import { TariffPeriod } from "../../../generated/prisma/index.js";
import { HttpError } from "../../lib/httpError.js";
import { stationRepository } from "../../db/stationRepository.js";

const db = prisma as unknown as PrismaClient;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Локальна календарна дата (без часових поясів UTC). */
function sameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function localDateAtNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function parseNightWindow(): { start: number; endExclusive: number } {
  const start = Number(process.env["NIGHT_TARIFF_START_HOUR"] ?? 23);
  const endExclusive = Number(process.env["NIGHT_TARIFF_END_HOUR"] ?? 7);
  return { start, endExclusive };
}

/** Денний тариф поза вікном [nightStart .. nightEnd) — нічний. */
export function tariffPeriodForInstant(d: Date): TariffPeriod {
  const h = d.getHours();
  const { start, endExclusive } = parseNightWindow();
  if (start > endExclusive) {
    const night = h >= start || h < endExclusive;
    return night ? TariffPeriod.NIGHT : TariffPeriod.DAY;
  }
  const night = h >= start && h < endExclusive;
  return night ? TariffPeriod.NIGHT : TariffPeriod.DAY;
}

async function getBias(period: TariffPeriod): Promise<number> {
  const row = await db.forecastBias.findUnique({
    where: { tariffType: period },
  });
  return row ? Number(row.biasValue) : 0;
}

/** Остання ціна з tariff для типу періоду на дату target (effective_date ≤ день target). */
async function getHistoricalPrice(
  period: TariffPeriod,
  onDay: Date
): Promise<number> {
  const day = localDateAtNoon(onDay);
  const row = await db.tariff.findFirst({
    where: {
      tariffType: period,
      effectiveDate: { lte: day },
    },
    orderBy: { effectiveDate: "desc" },
  });
  if (row) {
    return Number(row.pricePerKwh);
  }
  const any = await db.tariff.findFirst({
    where: { tariffType: period },
    orderBy: { effectiveDate: "desc" },
  });
  if (!any) {
    throw new HttpError(
      503,
      "Немає записів у tariff. Заповніть історію або запустіть ingest."
    );
  }
  return Number(any.pricePerKwh);
}

async function getForecastPrice(
  period: TariffPeriod,
  bookingLocalDay: Date
): Promise<number> {
  const targetDate = localDateAtNoon(bookingLocalDay);
  const pred = await db.tariffPrediction.findUnique({
    where: {
      targetDate_tariffType: { targetDate, tariffType: period },
    },
  });
  const bias = await getBias(period);
  if (pred) {
    return Math.max(0, roundMoney(Number(pred.predictedPrice) + bias));
  }
  return roundMoney(await getHistoricalPrice(period, bookingLocalDay));
}

/**
 * Ціна ₴/кВт·год для моменту початку бронювання:
 * сьогодні — з tariff; інша дата — з tariff_prediction (+ bias), інакше fallback на історію.
 */
export async function getPricePerKwhForInstant(startTime: Date): Promise<number> {
  const now = new Date();
  const period = tariffPeriodForInstant(startTime);
  if (sameLocalCalendarDay(startTime, now)) {
    return roundMoney(await getHistoricalPrice(period, startTime));
  }
  return await getForecastPrice(period, startTime);
}

function assumedChargeKwFromEnv(): number {
  const n = Number(process.env["CHARGE_KW_ASSUMED"] ?? 7);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

function localYmdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Передплата CALC: мінімум з (тривалість × орієнтовна кВт зарядки) і ємності акумулятора, × ₴/кВт·год.
 * До прогнозу тарифу додається надбавка за завантаженістю станції в календарний день початку бронювання.
 */
export async function computePrepaymentForCalcBooking(
  userId: number,
  vehicleId: number,
  stationId: number,
  startTime: Date,
  durationMinutes: number
): Promise<number> {
  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, userId },
  });
  if (!vehicle) {
    throw new HttpError(404, "Автомобіль не знайдено або не ваш");
  }
  const hours = Math.max(0, durationMinutes) / 60;
  const capKwh = Number(vehicle.batteryCapacity);
  if (!Number.isFinite(capKwh) || capKwh <= 0) {
    throw new HttpError(400, "У авто не задано коректну ємність акумулятора (batteryCapacity)");
  }
  const chargeKw = assumedChargeKwFromEnv();
  const rawKwh = hours * chargeKw;
  const kwh = Math.min(rawKwh, capKwh);
  const price = await getPricePerKwhForInstant(startTime);
  const load = await stationRepository.getStationBookingDayLoad(
    stationId,
    localYmdFromDate(startTime)
  );
  const surcharge = load?.surchargeUahPerKwh ?? 0;
  const effectivePrice = roundMoney(price + surcharge);
  return roundMoney(kwh * effectivePrice);
}
