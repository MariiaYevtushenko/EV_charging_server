import { TariffPeriod } from "../../../generated/prisma/index.js";
import { tariffRepository } from "../../db/tariffRepository.js";
import { HttpError } from "../../lib/httpError.js";
import { ingestDailyTariff } from "../forecast/tariffIngestService.js";
import { dateKeyLocal, localDateAtNoon } from "../../utils/tariffDateUtils.js";

export type TariffListItemDto = {
  id: number;
  tariffType: "DAY" | "NIGHT";
  pricePerKwh: number;
  /** YYYY-MM-DD (локальний календар, як у upsert). */
  effectiveDate: string;
};

export type TodayTariffsDto = {
  date: string;
  dayPrice: number;
  nightPrice: number;
};

function rowToDto(r: {
  id: number;
  tariffType: TariffPeriod;
  pricePerKwh: unknown;
  effectiveDate: Date;
}): TariffListItemDto {
  return {
    id: r.id,
    tariffType: r.tariffType,
    pricePerKwh: Number(r.pricePerKwh),
    effectiveDate: dateKeyLocal(localDateAtNoon(r.effectiveDate)),
  };
}

export async function listTariffs(): Promise<TariffListItemDto[]> {
  const rows = await tariffRepository.listAll();
  return rows.map(rowToDto);
}

export async function getTodayTariffs(): Promise<TodayTariffsDto> {
  const today = new Date();
  const noon = localDateAtNoon(today);
  const rows = await tariffRepository.findForCalendarDay(today);
  const day = rows.find((x) => x.tariffType === TariffPeriod.DAY);
  const night = rows.find((x) => x.tariffType === TariffPeriod.NIGHT);
  return {
    date: dateKeyLocal(noon),
    dayPrice: day ? Number(day.pricePerKwh) : 0,
    nightPrice: night ? Number(night.pricePerKwh) : 0,
  };
}

/**
 * Оновлює лише тарифи на поточну календарну дату (сьогодні). Минулі дати через API не змінюються.
 */
export async function putTodayTariffs(dayPrice: number, nightPrice: number): Promise<TodayTariffsDto> {
  if (!Number.isFinite(dayPrice) || !Number.isFinite(nightPrice)) {
    throw new Error("dayPrice and nightPrice must be finite numbers");
  }
  if (dayPrice < 0 || nightPrice < 0) {
    throw new Error("Prices must be non-negative");
  }
  await tariffRepository.upsertDayNightForCalendarDay(new Date(), dayPrice, nightPrice);
  return getTodayTariffs();
}

function parseLocalDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error("Invalid date key");
  }
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function nextCalendarDateKey(key: string): string {
  const d = parseLocalDateKey(key);
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0, 0);
  return dateKeyLocal(n);
}

export type SyncMissingTariffsResult = {
  filledDays: number;
  /** YYYY-MM-DD кожного дня, для якого записано тариф з API */
  dates: string[];
  /** У БД не було жодного рядка — додано лише сьогодні через ingest */
  bootstrappedTodayOnly: boolean;
};

/**
 * Якщо останній запис тарифу старіший за сьогодні (або таблиця порожня),
 * для кожної відсутньої календарної дати до сьогодні викликається ingest з API (день/ніч),
 * як у щоденному cron (`ingestDailyTariff`).
 */
export async function syncMissingTariffDaysToToday(): Promise<SyncMissingTariffsResult> {
  const todayNoon = localDateAtNoon(new Date());
  const todayKey = dateKeyLocal(todayNoon);

  const maxRaw = await tariffRepository.maxEffectiveDate();
  const maxGapEnv = process.env["TARIFF_MAX_SYNC_GAP_DAYS"];
  const maxGap = maxGapEnv != null && maxGapEnv !== "" ? Number(maxGapEnv) : 500;
  if (!Number.isFinite(maxGap) || maxGap < 1) {
    throw new HttpError(500, "TARIFF_MAX_SYNC_GAP_DAYS має бути додатним числом.");
  }

  if (maxRaw == null) {
    await ingestDailyTariff(todayNoon);
    return {
      filledDays: 1,
      dates: [todayKey],
      bootstrappedTodayOnly: true,
    };
  }

  const lastKey = dateKeyLocal(localDateAtNoon(maxRaw));
  if (lastKey >= todayKey) {
    return { filledDays: 0, dates: [], bootstrappedTodayOnly: false };
  }

  const missingKeys: string[] = [];
  let k = nextCalendarDateKey(lastKey);
  while (k <= todayKey) {
    missingKeys.push(k);
    k = nextCalendarDateKey(k);
  }

  if (missingKeys.length > maxGap) {
    throw new HttpError(
      400,
      `Пропуск ${missingKeys.length} днів перевищує ліміт ${maxGap}. Збільшіть TARIFF_MAX_SYNC_GAP_DAYS або додайте тарифи вручну.`
    );
  }

  for (const key of missingKeys) {
    await ingestDailyTariff(parseLocalDateKey(key));
  }

  return {
    filledDays: missingKeys.length,
    dates: missingKeys,
    bootstrappedTodayOnly: false,
  };
}
