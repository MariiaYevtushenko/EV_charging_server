import { DEFAULT_DAY_FALLBACK, envFallbackDayNight } from "./tariffEnv.js";

/**
 * Після API/конвертації €→грн інколи виходять нереалістичні значення (подвійна конвертація,
 * плутанина €/MWh та €/кВт·год, зайві нулі). Цей модуль підганяє ціни під діапазон
 * «типовий роздріб Укр» і за потреби перераховує через прості евристики або fallback з env.
 *
 * TARIFF_SANITIZE=false — лише округлення (2 знаки), без евристик.
 * TARIFF_UAH_PLAUSIBLE_MIN / TARIFF_UAH_PLAUSIBLE_MAX — межі норми (за замовч. 2…35 грн/кВт·год).
 * TARIFF_SANITIZE_ASSUMED_EUR_RATE — для евристики «зайве множення на курс» (за замовч. 45).
 * TARIFF_SANITIZE_LOG=true — console.warn при підміні значення.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sanitizeEnabled(): boolean {
  const v = process.env["TARIFF_SANITIZE"]?.trim().toLowerCase();
  return v !== "false" && v !== "0";
}

function logEnabled(): boolean {
  const v = process.env["TARIFF_SANITIZE_LOG"]?.trim().toLowerCase();
  return v === "true" || v === "1";
}

function plausibleBounds(): { min: number; max: number } {
  const minRaw = Number(process.env["TARIFF_UAH_PLAUSIBLE_MIN"] ?? "2");
  const maxRaw = Number(process.env["TARIFF_UAH_PLAUSIBLE_MAX"] ?? "35");
  const min = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : 2;
  const max = Number.isFinite(maxRaw) && maxRaw > min ? maxRaw : 35;
  return { min, max };
}

function assumedEurRate(): number {
  const r = Number(process.env["TARIFF_SANITIZE_ASSUMED_EUR_RATE"] ?? "45");
  return Number.isFinite(r) && r > 1 ? r : 45;
}

/** Перший варіант у фіксованому порядку (плутанина MWh/kWh, зайві нулі, зайве ×курс). */
function firstPlausibleRescale(v: number, min: number, max: number): number | null {
  const rate = assumedEurRate();
  const tries = [v / 1000, v / 100, v / 10, v / rate, v * 1000, v * 100];
  for (const x of tries) {
    if (Number.isFinite(x) && x >= min && x <= max) {
      return x;
    }
  }
  return null;
}

function sanitizeOne(v: number, fallback: number): { value: number; adjusted: boolean; reason?: string } {
  const { min, max } = plausibleBounds();

  if (!Number.isFinite(v) || v <= 0) {
    return { value: round2(fallback), adjusted: true, reason: "non-finite or <=0" };
  }

  if (v >= min && v <= max) {
    return { value: round2(v), adjusted: false };
  }

  const rescaled = firstPlausibleRescale(v, min, max);
  if (rescaled != null) {
    return {
      value: round2(rescaled),
      adjusted: true,
      reason: `out of [${min},${max}] → rescale ${v} → ${rescaled}`,
    };
  }

  return {
    value: round2(fallback),
    adjusted: true,
    reason: `out of [${min},${max}] → env fallback (was ${v})`,
  };
}

export type SanitizeTariffDayNightResult = {
  day: number;
  night: number;
  anyAdjusted: boolean;
};

/**
 * Нормалізує пару денна/нічна ціна в грн/кВт·год перед записом у БД.
 */
export function sanitizeTariffDayNightUah(day: number, night: number): SanitizeTariffDayNightResult {
  if (!sanitizeEnabled()) {
    return {
      day: round2(day),
      night: round2(night),
      anyAdjusted: false,
    };
  }

  const fb = envFallbackDayNight();
  const d = sanitizeOne(day, fb.day);
  const n = sanitizeOne(night, fb.night);

  if (logEnabled() && (d.adjusted || n.adjusted)) {
    const parts: string[] = [];
    if (d.adjusted) {
      parts.push(`DAY ${d.reason ?? "adjusted"}`);
    }
    if (n.adjusted) {
      parts.push(`NIGHT ${n.reason ?? "adjusted"}`);
    }
    console.warn(`[tariff sanitize] ${parts.join("; ")}`);
  }

  return {
    day: d.value,
    night: n.value,
    anyAdjusted: d.adjusted || n.adjusted,
  };
}

/** Для випадків, коли потрібен лише один рядок (наприклад тести). */
export function sanitizeTariffSingleUah(
  value: number,
  fallback: number = DEFAULT_DAY_FALLBACK
): number {
  if (!sanitizeEnabled()) {
    return round2(value);
  }
  return sanitizeOne(value, fallback).value;
}
