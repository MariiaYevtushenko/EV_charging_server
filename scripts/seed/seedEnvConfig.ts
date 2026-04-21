// Налаштування SEED 

export const SEED_ENV = {
  MASSIVE_USER_COUNT: "SEED_MASSIVE_USER_COUNT",
  DEMO_BOOKINGS_COUNT: "SEED_DEMO_BOOKINGS_COUNT",
  /** Цільова кількість рядків `session`; якщо не задано — як `SEED_DEMO_BOOKINGS_COUNT`. */
  DEMO_SESSIONS_COUNT: "SEED_DEMO_SESSIONS_COUNT",
  
  SESSION_FROM_BOOKING_SHARE: "SEED_SESSION_FROM_BOOKING_SHARE",
  TARIFF_SEED_DAYS: "TARIFF_SEED_DAYS",
  OPTIONAL_SQL_PROCEDURES: "SEED_OPTIONAL_SQL_PROCEDURES",
} as const;


export const SEED_ENV_DEFAULTS = {
  MASSIVE_USER_COUNT: 1700,
  DEMO_BOOKINGS_COUNT: 3200,
  SESSION_FROM_BOOKING_SHARE: 0.5,
  /** Має покривати горизонт дат сесій/броней у сиді (~200 днів у минуле). */
  TARIFF_SEED_DAYS: 220,
} as const;

const TARIFF_DAYS_MIN = 1;
const TARIFF_DAYS_MAX = 366;

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
