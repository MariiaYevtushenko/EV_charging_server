import prisma from "../../prisma.config.js";
import type { PrismaClient } from "../../../generated/prisma/index.js";
import { TariffPeriod } from "../../../generated/prisma/index.js";

const db = prisma as unknown as PrismaClient;

function localDateAtNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

/**
 * Запис історичних тарифів за день (upsert по tariff_type + effective_date).
 */
export async function saveHistoricalTariff(
  date: Date,
  dayPrice: number,
  nightPrice: number
): Promise<void> {
  const effectiveDate = localDateAtNoon(date);
  await db.tariff.upsert({
    where: {
      tariffType_effectiveDate: {
        tariffType: TariffPeriod.DAY,
        effectiveDate,
      },
    },
    create: {
      tariffType: TariffPeriod.DAY,
      pricePerKwh: dayPrice,
      effectiveDate,
    },
    update: { pricePerKwh: dayPrice },
  });
  await db.tariff.upsert({
    where: {
      tariffType_effectiveDate: {
        tariffType: TariffPeriod.NIGHT,
        effectiveDate,
      },
    },
    create: {
      tariffType: TariffPeriod.NIGHT,
      pricePerKwh: nightPrice,
      effectiveDate,
    },
    update: { pricePerKwh: nightPrice },
  });
}

function dateKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type ParsedTariffPayload =
  | { kind: "single"; day: number; night: number }
  | { kind: "series"; points: Map<string, { day: number; night: number }> };

/**
 * Розпізнає JSON з TARIFF_API_URL: одна пара день/ніч або масив по датах
 * (поля date / effectiveDate, dayPricePerKwh / day, nightPricePerKwh / night).
 */
export function parseTariffApiPayload(data: unknown): ParsedTariffPayload {
  if (data == null) {
    throw new Error("Empty tariff API response");
  }

  if (Array.isArray(data)) {
    const points = new Map<string, { day: number; night: number }>();
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const dateRaw = r["date"] ?? r["effectiveDate"] ?? r["targetDate"];
      let ds: string | null = null;
      if (typeof dateRaw === "string") {
        ds = dateRaw.slice(0, 10);
      } else if (dateRaw instanceof Date && !Number.isNaN(dateRaw.getTime())) {
        ds = dateKeyLocal(dateRaw);
      }
      if (!ds) continue;
      const day = Number(r["dayPricePerKwh"] ?? r["day"] ?? r["DAY"]);
      const night = Number(r["nightPricePerKwh"] ?? r["night"] ?? r["NIGHT"]);
      if (!Number.isFinite(day) || !Number.isFinite(night)) continue;
      points.set(ds, { day, night });
    }
    if (points.size > 0) {
      return { kind: "series", points };
    }
  }

  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    const nested = o["series"] ?? o["prices"] ?? o["history"] ?? o["data"] ?? o["days"];
    if (Array.isArray(nested)) {
      return parseTariffApiPayload(nested);
    }
    const day = o["dayPricePerKwh"] ?? o["day"] ?? o["DAY"];
    const night = o["nightPricePerKwh"] ?? o["night"] ?? o["NIGHT"];
    if (day != null && night != null) {
      const d = Number(day);
      const n = Number(night);
      if (Number.isFinite(d) && Number.isFinite(n)) {
        return { kind: "single", day: d, night: n };
      }
    }
  }

  throw new Error("Unrecognized TARIFF_API_URL JSON shape (need day/night or array with dates)");
}

async function fetchTariffsFromApi(): Promise<{
  dayPricePerKwh: number | undefined;
  nightPricePerKwh: number | undefined;
}> {
  const url = process.env["TARIFF_API_URL"];
  if (!url) {
    return { dayPricePerKwh: undefined, nightPricePerKwh: undefined };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`TARIFF_API_URL HTTP ${res.status}`);
  }
  const data = await res.json();
  try {
    const p = parseTariffApiPayload(data);
    if (p.kind === "single") {
      return { dayPricePerKwh: p.day, nightPricePerKwh: p.night };
    }
    const today = dateKeyLocal(new Date());
    const pt = p.points.get(today);
    if (pt) {
      return { dayPricePerKwh: pt.day, nightPricePerKwh: pt.night };
    }
    const first = [...p.points.values()][0];
    if (first) {
      return { dayPricePerKwh: first.day, nightPricePerKwh: first.night };
    }
    return { dayPricePerKwh: undefined, nightPricePerKwh: undefined };
  } catch {
    const rec = data as Record<string, unknown>;
    const day = rec["dayPricePerKwh"] ?? rec["day"] ?? rec["DAY"];
    const night = rec["nightPricePerKwh"] ?? rec["night"] ?? rec["NIGHT"];
    return {
      dayPricePerKwh: day != null ? Number(day) : undefined,
      nightPricePerKwh: night != null ? Number(night) : undefined,
    };
  }
}

const DEFAULT_DAY_FALLBACK = 13.5;
const DEFAULT_NIGHT_FALLBACK = 9.2;

function envFallbackDayNight(): { day: number; night: number } {
  return {
    day: Number(process.env["TARIFF_DAY_PRICE"] ?? DEFAULT_DAY_FALLBACK),
    night: Number(process.env["TARIFF_NIGHT_PRICE"] ?? DEFAULT_NIGHT_FALLBACK),
  };
}

export type TariffSeedRangeAnchor = "start" | "end";

/** Режим сиду тарифів (з чого брались ціни). */
export type TariffSeedMode =
  | "no_api"
  | "api_per_day"
  | "api_single"
  | "api_series";

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
 */
export async function SeedTariffsFromApi(
  days: number = 60,
  rangeDate: Date = new Date(),
  options?: { anchor?: TariffSeedRangeAnchor }
): Promise<SeedTariffsFromApiResult> {
  const anchor: TariffSeedRangeAnchor = options?.anchor ?? "start";
  const url = process.env["TARIFF_API_URL"];
  const endOrStart = localDateAtNoon(rangeDate);
  const start =
    anchor === "end"
      ? new Date(
          endOrStart.getFullYear(),
          endOrStart.getMonth(),
          endOrStart.getDate() - (days - 1),
          12,
          0,
          0,
          0
        )
      : endOrStart;
  const fb = envFallbackDayNight();

  if (!url) {
    let written = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12, 0, 0, 0);
      await saveHistoricalTariff(d, fb.day, fb.night);
      written++;
    }
    return { daysWritten: written, mode: "no_api" };
  }

  if (process.env["TARIFF_API_PER_DAY"] === "true") {
    let written = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12, 0, 0, 0);
      const iso = dateKeyLocal(d);
      const sep = url.includes("?") ? "&" : "?";
      const requestUrl = `${url}${sep}date=${iso}`;
      const res = await fetch(requestUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        throw new Error(`TARIFF_API_URL HTTP ${res.status} (${iso})`);
      }
      const data = await res.json();
      const p = parseTariffApiPayload(data);
      if (p.kind !== "single") {
        throw new Error(`Per-day tariff API must return a single day/night object (${iso})`);
      }
      await saveHistoricalTariff(d, p.day, p.night);
      written++;
    }
    return { daysWritten: written, mode: "api_per_day" };
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`TARIFF_API_URL HTTP ${res.status}`);
  }
  const data = await res.json();
  const parsed = parseTariffApiPayload(data);

  if (parsed.kind === "single") {
    let written = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12, 0, 0, 0);
      await saveHistoricalTariff(d, parsed.day, parsed.night);
      written++;
    }
    return { daysWritten: written, mode: "api_single" };
  }

  let written = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12, 0, 0, 0);
    const k = dateKeyLocal(d);
    const pt = parsed.points.get(k);
    const dayP = pt?.day ?? fb.day;
    const nightP = pt?.night ?? fb.night;
    await saveHistoricalTariff(d, dayP, nightP);
    written++;
  }
  return { daysWritten: written, mode: "api_series" };
}

/**
 * Щоденне оновлення: з TARIFF_API_URL або з env TARIFF_DAY_PRICE / TARIFF_NIGHT_PRICE.
 */
export async function ingestDailyTariff(date: Date = new Date()): Promise<{
  day: number;
  night: number;
}> {
  const fromApi = await fetchTariffsFromApi();
  const day =
    fromApi.dayPricePerKwh ??
    Number(process.env["TARIFF_DAY_PRICE"] ?? 13.5);
  const night =
    fromApi.nightPricePerKwh ??
    Number(process.env["TARIFF_NIGHT_PRICE"] ?? 9.2);
  await saveHistoricalTariff(date, day, night);
  return { day, night };
}
