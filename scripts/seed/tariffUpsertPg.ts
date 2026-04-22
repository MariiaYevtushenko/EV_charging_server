import type pg from "pg";
import { localDateAtNoon } from "../../src/utils/tariffDateUtils.js";
import { sanitizeTariffDayNightUah } from "../../src/utils/tariffPriceSanitize.js";

/**
 * Те саме, що tariffRepository.upsertDayNightForCalendarDay, але через pg.Client
 * (для запису всередині зовнішньої транзакції).
 */
export async function upsertTariffDayNightForCalendarDayPg(
  client: pg.Client,
  calendarDay: Date,
  dayPricePerKwh: number,
  nightPricePerKwh: number,
): Promise<void> {
  const s = sanitizeTariffDayNightUah(dayPricePerKwh, nightPricePerKwh);
  const effectiveDate = localDateAtNoon(calendarDay);

  await client.query(
    `
    INSERT INTO tariff (tariff_type, price_per_kwh, effective_date)
    VALUES ('DAY'::tariff_period, $1::numeric, $2::date)
    ON CONFLICT (tariff_type, effective_date)
    DO UPDATE SET
      price_per_kwh = EXCLUDED.price_per_kwh,
      updated_at = CURRENT_TIMESTAMP
    `,
    [s.day, effectiveDate],
  );

  await client.query(
    `
    INSERT INTO tariff (tariff_type, price_per_kwh, effective_date)
    VALUES ('NIGHT'::tariff_period, $1::numeric, $2::date)
    ON CONFLICT (tariff_type, effective_date)
    DO UPDATE SET
      price_per_kwh = EXCLUDED.price_per_kwh,
      updated_at = CURRENT_TIMESTAMP
    `,
    [s.night, effectiveDate],
  );
}
