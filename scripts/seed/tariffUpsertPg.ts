import type pg from "pg";
import { localDateAtNoon } from "../../src/utils/tariffDateUtils.js";

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
    [dayPricePerKwh, effectiveDate],
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
    [nightPricePerKwh, effectiveDate],
  );
}
