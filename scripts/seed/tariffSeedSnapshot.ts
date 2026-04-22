/**
 * JSON-снапшот тарифів для сиду: резерв, коли API недоступне (`TARIFF_SEED_USE_SNAPSHOT_FIRST`).
 * Записується після успішного збору цін (до persist у БД у `SeedTariffsFromApi`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dateKeyLocal, localDateAtNoon } from "../../src/utils/tariffDateUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type TariffSeedRangeAnchor = "start" | "end";

export type TariffSeedSnapshotRowV1 = {
  date: string;
  day: number;
  night: number;
};

export type TariffSeedSnapshotFileV1 = {
  version: 1;
  writtenAt: string;
  /** Режим збору даних до знімка (`entsoe`, `api_per_day`, …). */
  mode: string;
  anchor: TariffSeedRangeAnchor;
  days: number;
  /** `dateKeyLocal(localDateAtNoon(rangeDate))` — кінець/якір діапазону при сиді. */
  rangeEndDate: string;
  /** Ціни в грн/кВт·год так само, як у таблиці `tariff` після конвертації. */
  currencyNote: "UAH_per_kwh";
  nbuEurRateUahUsed: number | null;
  rows: TariffSeedSnapshotRowV1[];
};

export function getDefaultTariffSeedSnapshotPath(): string {
  return path.join(__dirname, "data", "tariff_seed_snapshot.json");
}

/** Явний шлях з env або дефолтний файл у `scripts/seed/data/`. */
export function resolveTariffSeedSnapshotPathForIO(): string {
  const raw = process.env["TARIFF_SEED_SNAPSHOT_PATH"]?.trim();
  if (!raw) return getDefaultTariffSeedSnapshotPath();
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export function isTariffSeedUseSnapshotFirst(): boolean {
  const v = String(process.env["TARIFF_SEED_USE_SNAPSHOT_FIRST"] ?? "").toLowerCase();
  return v === "true" || v === "1";
}

export function isTariffSeedWriteSnapshot(): boolean {
  const v = String(process.env["TARIFF_SEED_WRITE_SNAPSHOT"] ?? "true").toLowerCase();
  return v !== "false" && v !== "0";
}

export function calendarDayFromDateKeyLocal(dateKey: string): Date {
  const parts = dateKey.split("-").map((x) => Number.parseInt(x, 10));
  const y = parts[0];
  const mo = parts[1];
  const d = parts[2];
  if (
    y === undefined ||
    mo === undefined ||
    d === undefined ||
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(d)
  ) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

function expectedDateKeys(
  days: number,
  anchor: TariffSeedRangeAnchor,
  rangeDate: Date,
): { first: string; last: string } {
  const rangeAnchorDate = localDateAtNoon(rangeDate);
  const rangeStartDate =
    anchor === "end"
      ? new Date(
          rangeAnchorDate.getFullYear(),
          rangeAnchorDate.getMonth(),
          rangeAnchorDate.getDate() - (days - 1),
          12,
          0,
          0,
          0,
        )
      : rangeAnchorDate;
  const lastDay = new Date(
    rangeStartDate.getFullYear(),
    rangeStartDate.getMonth(),
    rangeStartDate.getDate() + (days - 1),
    12,
    0,
    0,
    0,
  );
  return {
    first: dateKeyLocal(rangeStartDate),
    last: dateKeyLocal(lastDay),
  };
}

export function validateTariffSeedSnapshotFile(
  raw: unknown,
  days: number,
  anchor: TariffSeedRangeAnchor,
  rangeDate: Date,
): raw is TariffSeedSnapshotFileV1 {
  if (raw === null || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o["version"] !== 1) return false;
  if (typeof o["writtenAt"] !== "string") return false;
  if (typeof o["mode"] !== "string") return false;
  if (o["anchor"] !== "start" && o["anchor"] !== "end") return false;
  if (typeof o["days"] !== "number" || o["days"] !== days) return false;
  if (typeof o["rangeEndDate"] !== "string") return false;
  const endKey = dateKeyLocal(localDateAtNoon(rangeDate));
  if (o["rangeEndDate"] !== endKey) return false;
  const rows = o["rows"];
  if (!Array.isArray(rows) || rows.length !== days) return false;
  const { first, last } = expectedDateKeys(days, anchor, rangeDate);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === null || typeof r !== "object") return false;
    const row = r as Record<string, unknown>;
    if (typeof row["date"] !== "string") return false;
    if (typeof row["day"] !== "number" || typeof row["night"] !== "number")
      return false;
  }
  const firstRow = rows[0] as Record<string, unknown>;
  const lastRow = rows[rows.length - 1] as Record<string, unknown>;
  if (firstRow["date"] !== first || lastRow["date"] !== last) return false;
  return true;
}

export async function readTariffSeedSnapshotFile(
  absPath: string,
): Promise<TariffSeedSnapshotFileV1 | null> {
  try {
    const buf = await fs.readFile(absPath, "utf8");
    const parsed: unknown = JSON.parse(buf) as unknown;
    return parsed as TariffSeedSnapshotFileV1;
  } catch {
    return null;
  }
}

export async function writeTariffSeedSnapshotFile(
  absPath: string,
  payload: TariffSeedSnapshotFileV1,
): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
