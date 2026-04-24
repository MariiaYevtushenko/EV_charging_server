import { tariffRepository } from "../../db/tariffRepository.js";
import { dateKeyLocal, localDateAtNoon } from "../../utils/tariffDateUtils.js";
import { envFallbackDayNight } from "../../utils/tariffEnv.js";
import { sanitizeTariffDayNightUah } from "../../utils/tariffPriceSanitize.js";
import { fetchNbuEurRateUah } from "../fx/nbuEurService.js";
import { buildTariffApiUrl } from "./tariffHttpUtils.js";
import { parseTariffApiPayload } from "./tariffApiParser.js";
import {
  fetchEntsoeDayNightKwh,
  isEntsoeTariffMode,
} from "./entsoeTariffClient.js";
import {
  calendarDayFromDateKeyLocal,
  isTariffSeedUseSnapshotFirst,
  isTariffSeedWriteSnapshot,
  readTariffSeedSnapshotFile,
  resolveTariffSeedSnapshotPathForIO,
  validateTariffSeedSnapshotFile,
  writeTariffSeedSnapshotFile,
  type TariffSeedSnapshotFileV1,
  type TariffSeedSnapshotRowV1,
} from "../../../scripts/seed/tariffSeedSnapshot.js";

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
  let pair: { day: number; night: number };
  if (!tariffApiPricesInEur()) {
    pair = { day, night };
  } else {
    if (rateCache.v == null) {
      rateCache.v = (await fetchNbuEurRateUah()).rateUahPerEur;
    }
    const r = rateCache.v;
    pair = { day: day * r, night: night * r };
  }
  return pair;
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

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  const results = new Array<R>(n);
  let next = 0;
  async function runWorker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= n) return;
      results[i] = await worker(items[i]!, i);
    }
  }
  const w = Math.max(1, Math.min(concurrency, Math.max(1, n)));
  await Promise.all(Array.from({ length: w }, () => runWorker()));
  return results;
}

function getTariffSeedFetchConcurrency(): number {
  const c = Number(process.env["TARIFF_SEED_FETCH_CONCURRENCY"] ?? "6");
  if (!Number.isFinite(c)) return 6;
  return Math.max(1, Math.min(32, Math.floor(c)));
}

function calendarDayAtOffset(rangeStartDate: Date, dayOffset: number): Date {
  return new Date(
    rangeStartDate.getFullYear(),
    rangeStartDate.getMonth(),
    rangeStartDate.getDate() + dayOffset,
    12,
    0,
    0,
    0,
  );
}

export type TariffSeedRangeAnchor = "start" | "end";

/** Режим сиду тарифів (з чого брались ціни). */
export type TariffSeedMode =
  | "no_api"
  | "api_per_day"
  | "api_single"
  | "api_series"
  | "entsoe"
  | "snapshot";

async function prefetchNbuIfEurTariffSeed(
  url: string | undefined,
  nbuRateCache: { v: number | null },
): Promise<void> {
  if (!url) return;
  if (!tariffApiPricesInEur()) return;
  if (nbuRateCache.v != null) return;
  nbuRateCache.v = (await fetchNbuEurRateUah()).rateUahPerEur;
}

async function tryWriteTariffSeedSnapshot(params: {
  mode: TariffSeedMode;
  anchor: TariffSeedRangeAnchor;
  days: number;
  rangeAnchorDate: Date;
  nbuRateCache: { v: number | null };
  rows: { calendarDay: Date; day: number; night: number }[];
}): Promise<void> {
  if (!isTariffSeedWriteSnapshot()) return;
  const pathAbs = resolveTariffSeedSnapshotPathForIO();
  const rows: TariffSeedSnapshotRowV1[] = params.rows.map((r) => ({
    date: dateKeyLocal(r.calendarDay),
    day: r.day,
    night: r.night,
  }));
  const payload: TariffSeedSnapshotFileV1 = {
    version: 1,
    writtenAt: new Date().toISOString(),
    mode: params.mode,
    anchor: params.anchor,
    days: params.days,
    rangeEndDate: dateKeyLocal(params.rangeAnchorDate),
    currencyNote: "UAH_per_kwh",
    nbuEurRateUahUsed: params.nbuRateCache.v,
    rows,
  };
  await writeTariffSeedSnapshotFile(pathAbs, payload);
}

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
 * - **Швидкий сид ENTSO-E / per-day:** `TARIFF_SEED_FETCH_CONCURRENCY` (деф. 6) — паралельні HTTP; старий послідовний режим: `ENTSOE_SEED_SEQUENTIAL=true` + `ENTSOE_SEED_DELAY_MS`.
 * - **Резервний JSON:** після збору цін пишеться `scripts/seed/data/tariff_seed_snapshot.json` (вимкнути: `TARIFF_SEED_WRITE_SNAPSHOT=false`). Якщо `TARIFF_SEED_USE_SNAPSHOT_FIRST=true` і файл валідний для `days`/`anchor`/дати — HTTP не викликаються.
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

  if (isTariffSeedUseSnapshotFirst()) {
    const snapPath = resolveTariffSeedSnapshotPathForIO();
    const raw = await readTariffSeedSnapshotFile(snapPath);
    if (
      raw != null &&
      validateTariffSeedSnapshotFile(raw, days, anchor, rangeAnchorDate)
    ) {
      for (const row of raw.rows) {
        const calendarDay = calendarDayFromDateKeyLocal(row.date);
        await persist(calendarDay, row.day, row.night);
      }
      return { daysWritten: raw.rows.length, mode: "snapshot" };
    }
  }

  if (!url) {
    const rowsOut: { calendarDay: Date; day: number; night: number }[] = [];
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const calendarDay = calendarDayAtOffset(rangeStartDate, dayOffset);
      rowsOut.push({
        calendarDay,
        day: fallbackPrices.day,
        night: fallbackPrices.night,
      });
    }
    await tryWriteTariffSeedSnapshot({
      mode: "no_api",
      anchor,
      days,
      rangeAnchorDate,
      nbuRateCache,
      rows: rowsOut,
    });
    for (const r of rowsOut) {
      await persist(r.calendarDay, r.day, r.night);
    }
    return { daysWritten: rowsOut.length, mode: "no_api" };
  }

  if (isEntsoeTariffMode(url)) {
    const sequentialEntsoe =
      String(process.env["ENTSOE_SEED_SEQUENTIAL"] ?? "").toLowerCase() ===
        "true" ||
      String(process.env["ENTSOE_SEED_SEQUENTIAL"] ?? "").toLowerCase() === "1";

    if (sequentialEntsoe) {
      const entsoePaceMs = Math.max(
        0,
        Number(process.env["ENTSOE_SEED_DELAY_MS"] ?? "1000"),
      );
      const rowsOut: { calendarDay: Date; day: number; night: number }[] = [];
      for (let dayOffset = 0; dayOffset < days; dayOffset++) {
        if (dayOffset > 0 && entsoePaceMs > 0) {
          await new Promise((r) => setTimeout(r, entsoePaceMs));
        }
        const calendarDay = calendarDayAtOffset(rangeStartDate, dayOffset);
        const { day, night } = await fetchEntsoeDayNightKwh(calendarDay);
        const uah = await convertApiEurPairToUahIfNeeded(
          day,
          night,
          nbuRateCache,
        );
        rowsOut.push({ calendarDay, day: uah.day, night: uah.night });
      }
      await tryWriteTariffSeedSnapshot({
        mode: "entsoe",
        anchor,
        days,
        rangeAnchorDate,
        nbuRateCache,
        rows: rowsOut,
      });
      for (const r of rowsOut) {
        await persist(r.calendarDay, r.day, r.night);
      }
      return { daysWritten: rowsOut.length, mode: "entsoe" };
    }

    await prefetchNbuIfEurTariffSeed(url, nbuRateCache);
    /** ENTSO-E жорстко лімітує запити; без явного `ENTSOE_SEED_MAX_CONCURRENCY` не паралелимо. */
    const entsoeCapRaw = process.env["ENTSOE_SEED_MAX_CONCURRENCY"]?.trim();
    const entsoeCap =
      entsoeCapRaw != null && entsoeCapRaw !== ""
        ? Math.max(1, Math.min(8, Math.floor(Number(entsoeCapRaw))))
        : 1;
    const concurrency = Math.min(getTariffSeedFetchConcurrency(), entsoeCap);
    const entsoePaceMs = Math.max(0, Number(process.env["ENTSOE_SEED_DELAY_MS"] ?? "1000"));
    const calendarDays = Array.from({ length: days }, (_, dayOffset) =>
      calendarDayAtOffset(rangeStartDate, dayOffset),
    );
    const resolved = await mapWithConcurrency(
      calendarDays,
      concurrency,
      async (calendarDay) => {
        if (entsoePaceMs > 0) {
          await new Promise((r) => setTimeout(r, entsoePaceMs));
        }
        const { day, night } = await fetchEntsoeDayNightKwh(calendarDay);
        const uah = await convertApiEurPairToUahIfNeeded(
          day,
          night,
          nbuRateCache,
        );
        return { calendarDay, day: uah.day, night: uah.night };
      },
    );
    resolved.sort(
      (a, b) => a.calendarDay.getTime() - b.calendarDay.getTime(),
    );
    await tryWriteTariffSeedSnapshot({
      mode: "entsoe",
      anchor,
      days,
      rangeAnchorDate,
      nbuRateCache,
      rows: resolved,
    });
    for (const r of resolved) {
      await persist(r.calendarDay, r.day, r.night);
    }
    return { daysWritten: resolved.length, mode: "entsoe" };
  }

  if (process.env["TARIFF_API_PER_DAY"] === "true") {
    await prefetchNbuIfEurTariffSeed(url, nbuRateCache);
    const concurrency = getTariffSeedFetchConcurrency();
    const calendarDays = Array.from({ length: days }, (_, dayOffset) =>
      calendarDayAtOffset(rangeStartDate, dayOffset),
    );
    const resolved = await mapWithConcurrency(
      calendarDays,
      concurrency,
      async (calendarDay) => {
        const dateIso = dateKeyLocal(calendarDay);
        const requestUrl = buildTariffApiUrl(url, { date: dateIso });
        const response = await fetch(requestUrl, {
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          throw new Error(`TARIFF_API_URL HTTP ${response.status} (${dateIso})`);
        }
        const data = await response.json();
        const perDayPayload = parseTariffApiPayload(data);
        if (perDayPayload.kind !== "single") {
          throw new Error(
            `Per-day tariff API must return a single day/night object (${dateIso})`,
          );
        }
        const uah = await convertApiEurPairToUahIfNeeded(
          perDayPayload.day,
          perDayPayload.night,
          nbuRateCache,
        );
        return { calendarDay, day: uah.day, night: uah.night };
      },
    );
    resolved.sort(
      (a, b) => a.calendarDay.getTime() - b.calendarDay.getTime(),
    );
    await tryWriteTariffSeedSnapshot({
      mode: "api_per_day",
      anchor,
      days,
      rangeAnchorDate,
      nbuRateCache,
      rows: resolved,
    });
    for (const r of resolved) {
      await persist(r.calendarDay, r.day, r.night);
    }
    return { daysWritten: resolved.length, mode: "api_per_day" };
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
    await prefetchNbuIfEurTariffSeed(url, nbuRateCache);
    const rowsOut: { calendarDay: Date; day: number; night: number }[] = [];
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const calendarDay = calendarDayAtOffset(rangeStartDate, dayOffset);
      const uah = await convertApiEurPairToUahIfNeeded(
        parsedPayload.day,
        parsedPayload.night,
        nbuRateCache,
      );
      rowsOut.push({ calendarDay, day: uah.day, night: uah.night });
    }
    await tryWriteTariffSeedSnapshot({
      mode: "api_single",
      anchor,
      days,
      rangeAnchorDate,
      nbuRateCache,
      rows: rowsOut,
    });
    for (const r of rowsOut) {
      await persist(r.calendarDay, r.day, r.night);
    }
    return { daysWritten: rowsOut.length, mode: "api_single" };
  }

  await prefetchNbuIfEurTariffSeed(url, nbuRateCache);
  const rowsSeries: { calendarDay: Date; day: number; night: number }[] = [];
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const calendarDay = calendarDayAtOffset(rangeStartDate, dayOffset);
    const dateKey = dateKeyLocal(calendarDay);
    const seriesRow = parsedPayload.points.get(dateKey);
    if (seriesRow) {
      const uah = await convertApiEurPairToUahIfNeeded(
        seriesRow.day,
        seriesRow.night,
        nbuRateCache,
      );
      rowsSeries.push({ calendarDay, day: uah.day, night: uah.night });
    } else {
      rowsSeries.push({
        calendarDay,
        day: fallbackPrices.day,
        night: fallbackPrices.night,
      });
    }
  }
  await tryWriteTariffSeedSnapshot({
    mode: "api_series",
    anchor,
    days,
    rangeAnchorDate,
    nbuRateCache,
    rows: rowsSeries,
  });
  for (const r of rowsSeries) {
    await persist(r.calendarDay, r.day, r.night);
  }
  return { daysWritten: rowsSeries.length, mode: "api_series" };
}

/**
 * Розв’язати денну/нічну ціну (грн/кВт·год) з TARIFF_API_URL або env, без запису в БД.
 * Значення з API за замовчуванням у € → грн (× курс НБУ), див. `tariffApiPricesInEur`.
 */
export async function resolveDayNightPricesUahForDate(date: Date = new Date()): Promise<{
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

  const s = sanitizeTariffDayNightUah(day, night);
  return { day: s.day, night: s.night };
}

/**
 * Щоденне оновлення: з TARIFF_API_URL або з env TARIFF_DAY_PRICE / TARIFF_NIGHT_PRICE.
 * Значення з API за замовчуванням у € → у БД пишемо грн (× курс НБУ), див. `tariffApiPricesInEur`.
 */
export async function ingestDailyTariff(date: Date = new Date()): Promise<{
  day: number;
  night: number;
}> {
  const { day, night } = await resolveDayNightPricesUahForDate(date);
  await saveHistoricalTariff(date, day, night);
  return { day, night };
}
