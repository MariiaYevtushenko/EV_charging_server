import { tariffRepository } from "../../db/tariffRepository.js";
import { dateKeyLocal, localDateAtNoon } from "../../utils/tariffDateUtils.js";
import { envFallbackDayNight } from "../../utils/tariffEnv.js";
import { fetchNbuEurRateUah } from "../fx/nbuEurService.js";
import { buildTariffApiUrl } from "./tariffHttpUtils.js";
import { parseTariffApiPayload } from "./tariffApiParser.js";
import {
  fetchEntsoeDayNightKwh,
  isEntsoeTariffMode,
} from "./entsoeTariffClient.js";

export { parseTariffApiPayload } from "./tariffApiParser.js";
export type { ParsedTariffPayload } from "./tariffApiParser.js";

/**
 * Запис історичних тарифів за день (upsert по tariff_type + effective_date).
 */
export async function saveHistoricalTariff(
  date: Date,
  dayPrice: number,
  nightPrice: number
): Promise<void> {
  await tariffRepository.upsertDayNightForCalendarDay(date, dayPrice, nightPrice);
}

/**
 * Якщо зовнішній API віддає ціни в EUR, перед записом у БД (грн/кВт·год) множимо на курс НБУ.
 * Вимкнути: `TARIFF_API_PRICES_IN_EUR=false` (наприклад, API вже в гривнях).
 * За замовчуванням — конвертація увімкнена.
 */
function tariffApiPricesInEur(): boolean {
  const v = process.env["TARIFF_API_PRICES_IN_EUR"];
  if (v === "false" || v === "0") return false;
  return true;
}

/** Пара денної/нічної ціни з API (€) → грн для `tariff.price_per_kwh`. */
async function convertApiEurPairToUahIfNeeded(
  day: number,
  night: number,
  rateCache: { v: number | null }
): Promise<{ day: number; night: number }> {
  if (!tariffApiPricesInEur()) {
    return { day, night };
  }
  if (rateCache.v == null) {
    rateCache.v = (await fetchNbuEurRateUah()).rateUahPerEur;
  }
  const r = rateCache.v;
  return { day: day * r, night: night * r };
}

async function fetchTariffsFromApi(
  forDate: Date = new Date()
): Promise<{
  dayPricePerKwh: number | undefined;
  nightPricePerKwh: number | undefined;
}> {
  const url = process.env["TARIFF_API_URL"];
  if (!url) {
    return { dayPricePerKwh: undefined, nightPricePerKwh: undefined };
  }
  if (isEntsoeTariffMode(url)) {
    const { day, night } = await fetchEntsoeDayNightKwh(forDate);
    return { dayPricePerKwh: day, nightPricePerKwh: night };
  }
  const response = await fetch(buildTariffApiUrl(url), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`TARIFF_API_URL HTTP ${response.status}`);
  }
  const data = await response.json();
  try {
    const parsedPayload = parseTariffApiPayload(data);
    if (parsedPayload.kind === "single") {
      return {
        dayPricePerKwh: parsedPayload.day,
        nightPricePerKwh: parsedPayload.night,
      };
    }
    const todayKey = dateKeyLocal(new Date());
    const rowForToday = parsedPayload.points.get(todayKey);
    if (rowForToday) {
      return {
        dayPricePerKwh: rowForToday.day,
        nightPricePerKwh: rowForToday.night,
      };
    }
    const firstSeriesRow = [...parsedPayload.points.values()][0];
    if (firstSeriesRow) {
      return {
        dayPricePerKwh: firstSeriesRow.day,
        nightPricePerKwh: firstSeriesRow.night,
      };
    }
    return { dayPricePerKwh: undefined, nightPricePerKwh: undefined };
  } catch {
    const record = data as Record<string, unknown>;
    const dayRaw = record["dayPricePerKwh"] ?? record["day"] ?? record["DAY"];
    const nightRaw =
      record["nightPricePerKwh"] ?? record["night"] ?? record["NIGHT"];
    return {
      dayPricePerKwh: dayRaw != null ? Number(dayRaw) : undefined,
      nightPricePerKwh: nightRaw != null ? Number(nightRaw) : undefined,
    };
  }
}

export type TariffSeedRangeAnchor = "start" | "end";

/** Режим сиду тарифів (з чого брались ціни). */
export type TariffSeedMode =
  | "no_api"
  | "api_per_day"
  | "api_single"
  | "api_series"
  | "entsoe";

export type SeedTariffsFromApiResult = {
  daysWritten: number;
  mode: TariffSeedMode;
};

/**
 * Запис у `tariff` на кожен календарний день: денний (07:00–23:00) та нічний (23:00–07:00)
 * відповідають TariffPeriod DAY/NIGHT у додатку (див. NIGHT_TARIFF_START_HOUR / NIGHT_TARIFF_END_HOUR).
 *
 * `anchor`: `start` — від `rangeDate` вперед на `days` днів; `end` — **останні** `days` календарних днів,
 * що закінчуються `rangeDate` (типово сьогодні), тобто від (end − days + 1) до end включно.
 *
 * Джерело цін:
 * - без `TARIFF_API_URL` — одна й та сама пара з env (TARIFF_DAY_PRICE / TARIFF_NIGHT_PRICE) на всі дні;
 * - один запит до API: об'єкт { day, night } — та сама пара на всі дні; масив по датах — ціна на день з мапи, інакше fallback з env;
 * - `TARIFF_API_PER_DAY=true` — для кожного дня GET `TARIFF_API_URL?date=YYYY-MM-DD` (очікується один об'єкт day/night).
 * - ENTSO-E: від’ємні €/kWh за замовчуванням стають додатними (`|x|`), якщо не `ENTSOE_CLAMP_NEGATIVE_PRICES=false`.
 * - Якщо `TARIFF_API_PRICES_IN_EUR` увімкнено (за замовчуванням так), значення з API трактуються як €/кВт·год і перед записом у БД множаться на курс НБУ (грн/€).
 */
export async function SeedTariffsFromApi(
  days: number = 90,
  rangeDate: Date = new Date(),
  options?: {
    anchor?: TariffSeedRangeAnchor;
    /** Якщо задано — запис тарифів без Prisma (наприклад, у транзакції pg.Client). */
    persistDayNight?: (
      calendarDay: Date,
      dayPricePerKwh: number,
      nightPricePerKwh: number
    ) => Promise<void>;
  }
): Promise<SeedTariffsFromApiResult> {
  const anchor: TariffSeedRangeAnchor = options?.anchor ?? "start";
  const persist =
    options?.persistDayNight ??
    ((d: Date, day: number, night: number) => saveHistoricalTariff(d, day, night));
  const nbuRateCache = { v: null as number | null };
  const url = process.env["TARIFF_API_URL"];
  const rangeAnchorDate = localDateAtNoon(rangeDate);

  const rangeStartDate =
    anchor === "end"
      ? new Date(
          rangeAnchorDate.getFullYear(),
          rangeAnchorDate.getMonth(),
          rangeAnchorDate.getDate() - (days - 1),
          12,
          0,
          0,
          0
        )
      : rangeAnchorDate;
  const fallbackPrices = envFallbackDayNight();

  if (!url) {
    let daysWritten = 0;
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const calendarDay = new Date(
        rangeStartDate.getFullYear(),
        rangeStartDate.getMonth(),
        rangeStartDate.getDate() + dayOffset,
        12,
        0,
        0,
        0
      );
      await persist(
        calendarDay,
        fallbackPrices.day,
        fallbackPrices.night
      );
      daysWritten++;
    }
    return { daysWritten, mode: "no_api" };
  }

  if (isEntsoeTariffMode(url)) {
    let daysWritten = 0;
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const calendarDay = new Date(
        rangeStartDate.getFullYear(),
        rangeStartDate.getMonth(),
        rangeStartDate.getDate() + dayOffset,
        12,
        0,
        0,
        0
      );
      const { day, night } = await fetchEntsoeDayNightKwh(calendarDay);
      const uah = await convertApiEurPairToUahIfNeeded(day, night, nbuRateCache);
      await persist(calendarDay, uah.day, uah.night);
      daysWritten++;
    }
    return { daysWritten, mode: "entsoe" };
  }

  if (process.env["TARIFF_API_PER_DAY"] === "true") {
    let daysWritten = 0;
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const calendarDay = new Date(
        rangeStartDate.getFullYear(),
        rangeStartDate.getMonth(),
        rangeStartDate.getDate() + dayOffset,
        12,
        0,
        0,
        0
      );
      const dateIso = dateKeyLocal(calendarDay);
      const requestUrl = buildTariffApiUrl(url, { date: dateIso });
      const response = await fetch(requestUrl, { signal: AbortSignal.timeout(15_000) });

      if (!response.ok) {
        throw new Error(`TARIFF_API_URL HTTP ${response.status} (${dateIso})`);
      }

      const data = await response.json();
      const perDayPayload = parseTariffApiPayload(data);

      if (perDayPayload.kind !== "single") {
        throw new Error(
          `Per-day tariff API must return a single day/night object (${dateIso})`
        );
      }
      const uah = await convertApiEurPairToUahIfNeeded(
        perDayPayload.day,
        perDayPayload.night,
        nbuRateCache
      );
      await persist(calendarDay, uah.day, uah.night);
      daysWritten++;
    }
    return { daysWritten, mode: "api_per_day" };
  }

  const response = await fetch(buildTariffApiUrl(url), {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`TARIFF_API_URL HTTP ${response.status}`);
  }
  const data = await response.json();
  const parsedPayload = parseTariffApiPayload(data);

  if (parsedPayload.kind === "single") {
    let daysWritten = 0;
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const calendarDay = new Date(
        rangeStartDate.getFullYear(),
        rangeStartDate.getMonth(),
        rangeStartDate.getDate() + dayOffset,
        12,
        0,
        0,
        0
      );
      const uah = await convertApiEurPairToUahIfNeeded(
        parsedPayload.day,
        parsedPayload.night,
        nbuRateCache
      );
      await persist(calendarDay, uah.day, uah.night);
      daysWritten++;
    }
    return { daysWritten, mode: "api_single" };
  }

  let daysWritten = 0;
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const calendarDay = new Date(
      rangeStartDate.getFullYear(),
      rangeStartDate.getMonth(),
      rangeStartDate.getDate() + dayOffset,
      12,
      0,
      0,
      0
    );
    const dateKey = dateKeyLocal(calendarDay);
    const seriesRow = parsedPayload.points.get(dateKey);
    if (seriesRow) {
      const uah = await convertApiEurPairToUahIfNeeded(
        seriesRow.day,
        seriesRow.night,
        nbuRateCache
      );
      await persist(calendarDay, uah.day, uah.night);
    } else {
      await persist(
        calendarDay,
        fallbackPrices.day,
        fallbackPrices.night
      );
    }
    daysWritten++;
  }
  return { daysWritten, mode: "api_series" };
}

/**
 * Щоденне оновлення: з TARIFF_API_URL або з env TARIFF_DAY_PRICE / TARIFF_NIGHT_PRICE.
 * Значення з API за замовчуванням у € → у БД пишемо грн (× курс НБУ), див. `tariffApiPricesInEur`.
 */
export async function ingestDailyTariff(date: Date = new Date()): Promise<{
  day: number;
  night: number;
}> {
  const apiPrices = await fetchTariffsFromApi(date);
  const dayFromApi = apiPrices.dayPricePerKwh;
  const nightFromApi = apiPrices.nightPricePerKwh;

  let day = dayFromApi ?? Number(process.env["TARIFF_DAY_PRICE"] ?? 13.5);
  let night = nightFromApi ?? Number(process.env["TARIFF_NIGHT_PRICE"] ?? 9.2);

  if (tariffApiPricesInEur()) {
    const { rateUahPerEur } = await fetchNbuEurRateUah();
    if (dayFromApi != null) day = dayFromApi * rateUahPerEur;
    if (nightFromApi != null) night = nightFromApi * rateUahPerEur;
  }

  await saveHistoricalTariff(date, day, night);
  return { day, night };
}
