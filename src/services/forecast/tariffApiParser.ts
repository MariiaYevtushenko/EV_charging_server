import { dateKeyLocal } from "../../utils/tariffDateUtils.js";

export type ParsedTariffPayload =
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
    const pricesByDateKey = new Map<string, { day: number; night: number }>();

    for (const row of data) {
      if (!row || typeof row !== "object") continue;

      const rowRecord = row as Record<string, unknown>;
      const dateRaw =
        rowRecord["date"] ?? rowRecord["effectiveDate"] ?? rowRecord["targetDate"];

      let dateKey: string | null = null;
      if (typeof dateRaw === "string") {
        dateKey = dateRaw.slice(0, 10);
      } else if (dateRaw instanceof Date && !Number.isNaN(dateRaw.getTime())) {
        dateKey = dateKeyLocal(dateRaw);
      }
      if (!dateKey) continue;

      const dayPrice = Number(
        rowRecord["dayPricePerKwh"] ?? rowRecord["day"] ?? rowRecord["DAY"]
      );
      const nightPrice = Number(
        rowRecord["nightPricePerKwh"] ?? rowRecord["night"] ?? rowRecord["NIGHT"]
      );

      if (!Number.isFinite(dayPrice) || !Number.isFinite(nightPrice)) continue;

      pricesByDateKey.set(dateKey, { day: dayPrice, night: nightPrice });
    }
    if (pricesByDateKey.size > 0) {
      return { kind: "series", points: pricesByDateKey };
    }
  }

  if (typeof data === "object") {
    const rootObject = data as Record<string, unknown>;
    const nested =
      rootObject["series"] ??
      rootObject["prices"] ??
      rootObject["history"] ??
      rootObject["data"] ??
      rootObject["days"];

    if (Array.isArray(nested)) {
      return parseTariffApiPayload(nested);
    }
    const dayRaw = rootObject["dayPricePerKwh"] ?? rootObject["day"] ?? rootObject["DAY"];
    const nightRaw =
      rootObject["nightPricePerKwh"] ?? rootObject["night"] ?? rootObject["NIGHT"];
    if (dayRaw != null && nightRaw != null) {
      const dayPrice = Number(dayRaw);
      const nightPrice = Number(nightRaw);
      if (Number.isFinite(dayPrice) && Number.isFinite(nightPrice)) {
        return { kind: "single", day: dayPrice, night: nightPrice };
      }
    }
  }

  throw new Error("Unrecognized TARIFF_API_URL JSON shape (need day/night or array with dates)");
}
