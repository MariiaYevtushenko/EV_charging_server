import { parseStringPromise } from "xml2js";
import { envFallbackDayNight } from "../../utils/tariffEnv.js";

/** ENTSO-E Transparency Platform (XML A44), не JSON. */
export function isEntsoeTariffMode(url: string | undefined): boolean {
  if (!url) return false;
  if (process.env["TARIFF_API_ENTSOE"] === "true") return true;
  return /entsoe\.eu/i.test(url);
}

function formatEntsoeDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}`;
}

/** Доба 00:00–24:00 UTC для локального календарного дня (як у демо-скрипті A44). */
function periodUtcForLocalCalendarDay(day: Date): { start: Date; end: Date } {
  const year = day.getFullYear();
  const month = day.getMonth();
  const dayOfMonth = day.getDate();
  const start = new Date(Date.UTC(year, month, dayOfMonth, 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function entsoeApiBaseUrl(): string {
  const tariffUrlFromEnv = process.env["TARIFF_API_URL"]?.trim();
  if (!tariffUrlFromEnv) return "https://web-api.tp.entsoe.eu/api";
  try {
    const parsedBase = new URL(tariffUrlFromEnv);
    return `${parsedBase.origin}${parsedBase.pathname.replace(/\/$/, "") || "/api"}`;
  } catch {
    return "https://web-api.tp.entsoe.eu/api";
  }
}

/** Від’ємні €/kWh з A44 → додатні (|x|). Сирі ринкові значення: ENTSOE_CLAMP_NEGATIVE_PRICES=false */
function normalizeEntsoeKwhForTariff(eurPerKwh: number): number {
  if (process.env["ENTSOE_CLAMP_NEGATIVE_PRICES"] === "false") return eurPerKwh;
  return eurPerKwh < 0 ? Math.abs(eurPerKwh) : eurPerKwh;
}

/** A44: середні €/kWh за день (07–23) і ніч (23–07), локальні години як у 96 інтервалах. */
async function parseEntsoeA44XmlToDayNightKwh(
  xml: string,
  fallbackKwh: { day: number; night: number }
): Promise<{ day: number; night: number }> {
  const parsed: unknown = await parseStringPromise(xml);
  const root = parsed as Record<string, unknown>;
  if (root["Acknowledgement_MarketDocument"]) {
    const ack = root["Acknowledgement_MarketDocument"] as Record<string, unknown>;
    const reasonRaw = ack["Reason"];
    const firstReason = Array.isArray(reasonRaw) ? reasonRaw[0] : reasonRaw;
    const reasonEntry =
      firstReason && typeof firstReason === "object"
        ? (firstReason as Record<string, unknown>)
        : undefined;
    const codeEl = reasonEntry?.["code"];
    const textEl = reasonEntry?.["text"];
    const code = Array.isArray(codeEl) ? codeEl[0] : codeEl;
    const text = Array.isArray(textEl) ? textEl[0] : textEl;
    throw new Error(
      `ENTSO-E Acknowledgement${code != null ? `: ${String(code)}` : ""}${text != null ? ` — ${String(text)}` : ""}`
    );
  }
  const pmd = root["Publication_MarketDocument"] as Record<string, unknown> | undefined;
  if (!pmd) {
    throw new Error("ENTSO-E: очікувався Publication_MarketDocument у відповіді");
  }
  const tsRaw = pmd["TimeSeries"];
  const firstSeries = Array.isArray(tsRaw) ? tsRaw[0] : tsRaw;
  if (!firstSeries || typeof firstSeries !== "object") {
    throw new Error("ENTSO-E: немає TimeSeries у документі");
  }
  const series = firstSeries as Record<string, unknown>;
  const periodRaw = series["Period"];
  const firstPeriod = Array.isArray(periodRaw) ? periodRaw[0] : periodRaw;
  if (!firstPeriod || typeof firstPeriod !== "object") {
    throw new Error("ENTSO-E: немає Period у TimeSeries");
  }
  const period = firstPeriod as Record<string, unknown>;
  const pointRaw = period["Point"];
  const xmlPoints: Record<string, unknown>[] = Array.isArray(pointRaw)
    ? pointRaw
    : pointRaw
      ? [pointRaw as Record<string, unknown>]
      : [];

  const pricesEurMwh: number[] = [];
  for (const point of xmlPoints) {
    const amount = point["price.amount"];
    const rawAmount = Array.isArray(amount) ? amount[0] : amount;
    const priceEurMwh =
      rawAmount != null ? Number.parseFloat(String(rawAmount)) : NaN;
    if (Number.isFinite(priceEurMwh)) pricesEurMwh.push(priceEurMwh);
  }
  if (pricesEurMwh.length === 0) {
    throw new Error("ENTSO-E: немає жодної ціни в Point");
  }

  const dayPricesEurMwh: number[] = [];
  const nightPricesEurMwh: number[] = [];
  pricesEurMwh.forEach((priceEurMwh, index) => {
    const intervalIndex = index + 1;
    const hour = Math.floor((intervalIndex - 1) / 4);
    if (hour >= 7 && hour < 23) dayPricesEurMwh.push(priceEurMwh);
    else nightPricesEurMwh.push(priceEurMwh);
  });

  const avgDayEurMwh = dayPricesEurMwh.length
    ? dayPricesEurMwh.reduce((sum, x) => sum + x, 0) / dayPricesEurMwh.length
    : null;
  const avgNightEurMwh = nightPricesEurMwh.length
    ? nightPricesEurMwh.reduce((sum, x) => sum + x, 0) / nightPricesEurMwh.length
    : null;

  const dayPricePerKwh =
    avgDayEurMwh != null ? avgDayEurMwh / 1000 : fallbackKwh.day;
  const nightPricePerKwh =
    avgNightEurMwh != null ? avgNightEurMwh / 1000 : fallbackKwh.night;
  return {
    day: normalizeEntsoeKwhForTariff(dayPricePerKwh),
    night: normalizeEntsoeKwhForTariff(nightPricePerKwh),
  };
}

export async function fetchEntsoeDayNightKwh(
  calendarDay: Date
): Promise<{ day: number; night: number }> {
  const fallbackKwh = envFallbackDayNight();
  const token =
    process.env["TARIFF_API_TOKEN"]?.trim() ||
    process.env["ENTSOE_SECURITY_TOKEN"]?.trim() ||
    process.env["TOKEN"]?.trim();
  if (!token) {
    throw new Error("Для ENTSO-E потрібен TOKEN (або TARIFF_API_TOKEN) у .env");
  }
  const inDomain = process.env["ENTSOE_IN_DOMAIN"] ?? "10YPL-AREA-----S";
  const outDomain = process.env["ENTSOE_OUT_DOMAIN"] ?? inDomain;
  const documentType = process.env["ENTSOE_DOCUMENT_TYPE"] ?? "A44";
  const { start, end } = periodUtcForLocalCalendarDay(calendarDay);
  const base = entsoeApiBaseUrl();
  const params = new URLSearchParams({
    securityToken: token,
    documentType,
    in_Domain: inDomain,
    out_Domain: outDomain,
    periodStart: formatEntsoeDate(start),
    periodEnd: formatEntsoeDate(end),
  });
  const url = `${base}?${params.toString()}`;
  const maxRetries = Math.max(
    1,
    Math.min(30, Number(process.env["ENTSOE_HTTP_MAX_RETRIES"] ?? "10")),
  );
  const backoffMs = Math.max(
    500,
    Number(process.env["ENTSOE_429_BACKOFF_MS"] ?? "6000"),
  );

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (response.status === 429) {
      const ra = response.headers.get("retry-after");
      const sec =
        ra != null && /^\d+$/.test(ra.trim()) ? Number(ra.trim()) : null;
      const waitMs = Math.min(
        120_000,
        sec != null && sec > 0 ? sec * 1000 : backoffMs * (attempt + 1),
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!response.ok) {
      throw new Error(`ENTSO-E HTTP ${response.status}`);
    }
    const xml = await response.text();
    return parseEntsoeA44XmlToDayNightKwh(xml, fallbackKwh);
  }
  /**
   * Після усіх спроб 429 — за замовчуванням не валимо сид: підставляємо €/кВт·год (як у відповіді A44),
   * далі `tariffIngestService` переведе в грн через НБУ, якщо `TARIFF_API_PRICES_IN_EUR=true`.
   * Вимкнути: `ENTSOE_429_USE_FALLBACK=false`.
   */
  if (String(process.env["ENTSOE_429_USE_FALLBACK"] ?? "true").toLowerCase() !== "false") {
    const day = Number(process.env["ENTSOE_FALLBACK_EUR_PER_KWH_DAY"] ?? "0.12");
    const night = Number(process.env["ENTSOE_FALLBACK_EUR_PER_KWH_NIGHT"] ?? "0.09");
    console.warn(
      `[ENTSO-E] HTTP 429 після ${maxRetries} спроб для ${calendarDay.toISOString().slice(0, 10)} — fallback €/кВт·год day=${day}, night=${night} (ENTSOE_FALLBACK_EUR_PER_KWH_*).`,
    );
    return {
      day: normalizeEntsoeKwhForTariff(Number.isFinite(day) ? day : 0.12),
      night: normalizeEntsoeKwhForTariff(Number.isFinite(night) ? night : 0.09),
    };
  }
  throw new Error(
    `ENTSO-E HTTP 429 (rate limit): вичерпано ${maxRetries} спроб. Збільшіть ENTSOE_429_BACKOFF_MS або ENTSOE_SEED_DELAY_MS, зменшіть TARIFF_SEED_DAYS, ENTSOE_SEED_SEQUENTIAL=true, або заповніть scripts/seed/data/tariff_seed_snapshot.json (за замовч. сид іде з нього першим).`,
  );
}
