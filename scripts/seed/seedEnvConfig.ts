// Налаштування SEED 

export const SEED_ENV = {
  MASSIVE_USER_COUNT: "SEED_MASSIVE_USER_COUNT",
  DEMO_BOOKINGS_COUNT: "SEED_DEMO_BOOKINGS_COUNT",
  /** Максимальна глибина в минуле (календарних днів) для дат минулих бронювань у SeedBookings. */
  DEMO_BOOKINGS_DAYS_BACK: "SEED_DEMO_BOOKINGS_DAYS_BACK",
  /** Цільова кількість рядків `session`; якщо не задано — як `SEED_DEMO_BOOKINGS_COUNT`. */
  DEMO_SESSIONS_COUNT: "SEED_DEMO_SESSIONS_COUNT",
  
  SESSION_FROM_BOOKING_SHARE: "SEED_SESSION_FROM_BOOKING_SHARE",
  TARIFF_SEED_DAYS: "TARIFF_SEED_DAYS",
  OPTIONAL_SQL_PROCEDURES: "SEED_OPTIONAL_SQL_PROCEDURES",
} as const;


export const SEED_ENV_DEFAULTS = {
  MASSIVE_USER_COUNT: 1700,
  DEMO_BOOKINGS_COUNT: 3200,
  DEMO_BOOKINGS_DAYS_BACK: 120,
  SESSION_FROM_BOOKING_SHARE: 0.5,
  /**
   * Скільки календарних днів тарифів підтягувати з API (anchor=end).
   * Має бути ≥ `SEED_DEMO_BOOKINGS_DAYS_BACK` (і глибини дат у SQL-сиді).
   * Для ENTSO-E великі значення (сотні+) дають HTTP 429 — тоді `ENTSOE_SEED_SEQUENTIAL=true`,
   * зменшіть `TARIFF_SEED_FETCH_CONCURRENCY`, увімкніть `TARIFF_SEED_USE_SNAPSHOT_FIRST=true`
   * або збільшіть паузи (`ENTSOE_SEED_DELAY_MS`, `ENTSOE_429_BACKOFF_MS`).
   */
  TARIFF_SEED_DAYS: 210,
} as const;

const TARIFF_DAYS_MIN = 1;
/** Верхня межа для `TARIFF_SEED_DAYS` (довга історія для прогнозу). */
const TARIFF_DAYS_MAX = 1200;

function parseIntWithFallback(
  key: string,
  fallback: number,
  bounds?: { min?: number; max?: number },
): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  let v = n;
  if (bounds?.min !== undefined) {
    v = Math.max(bounds.min, v);
  }
  if (bounds?.max !== undefined) {
    v = Math.min(bounds.max, v);
  }
  return v;
}

function parseNumberWithFallback(
  key: string,
  fallback: number,
  bounds?: { min?: number; max?: number },
): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number.parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) {
    return fallback;
  }
  let v = n;
  if (bounds?.min !== undefined) {
    v = Math.max(bounds.min, v);
  }
  if (bounds?.max !== undefined) {
    v = Math.min(bounds.max, v);
  }
  return v;
}

// Кількість випадкових юзерів для SeedMassiveUsers (≥ 0).
export function getSeedMassiveUserCount(): number {
  return parseIntWithFallback(
    SEED_ENV.MASSIVE_USER_COUNT,
    SEED_ENV_DEFAULTS.MASSIVE_USER_COUNT,
    { min: 0 },
  );
}


export function getSeedDemoBookingsCount(): number {
  return parseIntWithFallback(
    SEED_ENV.DEMO_BOOKINGS_COUNT,
    SEED_ENV_DEFAULTS.DEMO_BOOKINGS_COUNT,
    { min: 1 },
  );
}

/** Глибина в минуле для дат минулих бронювань (1…1200 календарних днів). */
export function getSeedDemoBookingsDaysBack(): number {
  return parseIntWithFallback(
    SEED_ENV.DEMO_BOOKINGS_DAYS_BACK,
    SEED_ENV_DEFAULTS.DEMO_BOOKINGS_DAYS_BACK,
    { min: 1, max: 1200 },
  );
}

/** Цільова кількість сесій у `SeedSessions` (≥ 2). Якщо env порожній — як `getSeedDemoBookingsCount()`. */
export function getSeedDemoSessionsCount(): number {
  const raw = process.env[SEED_ENV.DEMO_SESSIONS_COUNT];
  if (raw === undefined || raw === "") {
    return getSeedDemoBookingsCount();
  }
  return parseIntWithFallback(
    SEED_ENV.DEMO_SESSIONS_COUNT,
    getSeedDemoBookingsCount(),
    { min: 2 },
  );
}

/** Частка сесій з минулих бронювань; решта — walk-in. */
export function getSeedSessionFromBookingShare(): number {
  return parseNumberWithFallback(
    SEED_ENV.SESSION_FROM_BOOKING_SHARE,
    SEED_ENV_DEFAULTS.SESSION_FROM_BOOKING_SHARE,
    { min: 0, max: 1 },
  );
}

export function getTariffSeedDays(): number {
  return parseIntWithFallback(
    SEED_ENV.TARIFF_SEED_DAYS,
    SEED_ENV_DEFAULTS.TARIFF_SEED_DAYS,
    { min: TARIFF_DAYS_MIN, max: TARIFF_DAYS_MAX },
  );
}


export function isSeedOptionalSqlProcedures(): boolean {
  const v = String(process.env[SEED_ENV.OPTIONAL_SQL_PROCEDURES] ?? "").toLowerCase();
  return v === "true" || v === "1";
}
