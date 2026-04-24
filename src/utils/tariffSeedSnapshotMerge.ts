import {
  isTariffSeedWriteSnapshot,
  readTariffSeedSnapshotFile,
  resolveTariffSeedSnapshotPathForIO,
  writeTariffSeedSnapshotFile,
  type TariffSeedSnapshotFileV1,
  type TariffSeedSnapshotRowV1,
} from "../../scripts/seed/tariffSeedSnapshot.js";

/**
 * Оновлює `tariff_seed_snapshot.json`: один календарний день (день + ніч, грн/кВт·год).
 * Не кидає на помилку запису — лише лог, щоб не ламати основний upsert у БД.
 */
export async function mergeDayNightIntoTariffSeedSnapshotFile(
  dateKey: string,
  day: number,
  night: number,
): Promise<void> {
  if (!isTariffSeedWriteSnapshot()) return;
  try {
    const pathAbs = resolveTariffSeedSnapshotPathForIO();
    const existing = await readTariffSeedSnapshotFile(pathAbs);
    const rows: TariffSeedSnapshotRowV1[] = Array.isArray(existing?.rows)
      ? existing!.rows.map((r) => ({ ...r }))
      : [];
    const ix = rows.findIndex((r) => r.date === dateKey);
    const row: TariffSeedSnapshotRowV1 = { date: dateKey, day, night };
    if (ix >= 0) rows[ix] = row;
    else rows.push(row);
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const lastDate = rows.length > 0 ? rows[rows.length - 1]!.date : dateKey;
    const payload: TariffSeedSnapshotFileV1 = {
      version: 1,
      writtenAt: new Date().toISOString(),
      mode: existing?.mode ?? "live_merge",
      anchor: existing?.anchor ?? "end",
      days: rows.length,
      rangeEndDate: lastDate,
      currencyNote: "UAH_per_kwh",
      nbuEurRateUahUsed: existing?.nbuEurRateUahUsed ?? null,
      rows,
    };
    await writeTariffSeedSnapshotFile(pathAbs, payload);
  } catch (e) {
    console.warn("[tariff_seed_snapshot] merge failed:", e);
  }
}
