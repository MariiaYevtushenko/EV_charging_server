export const DEFAULT_DAY_FALLBACK = 13.5;
export const DEFAULT_NIGHT_FALLBACK = 9.2;

export function envFallbackDayNight(): { day: number; night: number } {
  return {
    day: Number(process.env["TARIFF_DAY_PRICE"] ?? DEFAULT_DAY_FALLBACK),
    night: Number(process.env["TARIFF_NIGHT_PRICE"] ?? DEFAULT_NIGHT_FALLBACK),
  };
}
