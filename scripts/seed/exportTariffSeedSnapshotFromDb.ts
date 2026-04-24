import type pg from "pg";
import { dateKeyLocal, localDateAtNoon } from "../../src/utils/tariffDateUtils.js";
import {
  listExpectedTariffSeedDateKeys,
  resolveTariffSeedSnapshotPathForIO,
  writeTariffSeedSnapshotFile,
  type TariffSeedRangeAnchor,
  type TariffSeedSnapshotFileV1,
  type TariffSeedSnapshotRowV1,
} from "./tariffSeedSnapshot.js";

/**
 * Після успішного сиду: перезаписує `tariff_seed_snapshot.json` з фактичних рядків `public.tariff`
 * (DAY/NIGHT на кожен календарний день діапазону), щоб наступний запуск з `TARIFF_SEED_USE_SNAPSHOT_FIRST`
 * бачив актуальні дані без повторного API.
 */
export async function exportTariffSeedSnapshotFromDbAfterSeed(
  client: pg.Client,
  params: { days: number; anchor: TariffSeedRangeAnchor; rangeDate: Date },
): Promise<{ path: string; rows: number }> {
  const { days, anchor, rangeDate } = params;
  const expectedKeys = listExpectedTariffSeedDateKeys(days, anchor, rangeDate);
  if (expectedKeys.length === 0) {
    throw new Error("tariff snapshot export: порожній діапазон дат");
  }
  const startKey = expectedKeys[0]!;
  const endKey = expectedKeys[expectedKeys.length - 1]!;

  const { rows: dbRows } = await client.query<{
    d: string;
    day_price: string | null;
    night_price: string | null;
  }>(
    `
    SELECT
      effective_date::text AS d,
      MAX(CASE WHEN tariff_type = 'DAY'::tariff_period THEN price_per_kwh END)::text AS day_price,
      MAX(CASE WHEN tariff_type = 'NIGHT'::tariff_period THEN price_per_kwh END)::text AS night_price
    FROM public.tariff
    WHERE effective_date >= $1::date AND effective_date <= $2::date
    GROUP BY effective_date
    ORDER BY effective_date
    `,
    [startKey, endKey],
  );

  const byDate = new Map<string, { day: number; night: number }>();
  for (const r of dbRows) {
    const key = r.d.length >= 10 ? r.d.slice(0, 10) : r.d;
    const day = r.day_price != null ? Number(r.day_price) : NaN;
    const night = r.night_price != null ? Number(r.night_price) : NaN;
    if (!Number.isFinite(day) || !Number.isFinite(night)) continue;
    byDate.set(key, { day, night });
  }

  const outRows: TariffSeedSnapshotRowV1[] = [];
  for (const key of expectedKeys) {
    const v = byDate.get(key);
    if (v == null) {
      throw new Error(
        `tariff snapshot export: у БД немає пари DAY+NIGHT для дати ${key} (очікувано ${startKey}…${endKey})`,
      );
    }
    outRows.push({ date: key, day: v.day, night: v.night });
  }

  const rangeAnchorDate = localDateAtNoon(rangeDate);
  const payload: TariffSeedSnapshotFileV1 = {
    version: 1,
    writtenAt: new Date().toISOString(),
    mode: "post_seed_db",
    anchor,
    days,
    rangeEndDate: dateKeyLocal(rangeAnchorDate),
    currencyNote: "UAH_per_kwh",
    nbuEurRateUahUsed: null,
    rows: outRows,
  };
  const path = resolveTariffSeedSnapshotPathForIO();
  await writeTariffSeedSnapshotFile(path, payload);
  return { path, rows: outRows.length };
}
