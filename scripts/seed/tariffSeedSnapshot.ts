/**
 * JSON-снапшот тарифів: за замовчуванням сид спочатку з файлу (`TARIFF_SEED_USE_SNAPSHOT_FIRST` не false).
 * Після збору з API — повний перезапис; після upsert у `tariff` — точкове доповнення рядка дня (див. `tariffSeedSnapshotMerge`).
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

/**
 * Якщо змінна не задана — **true**: спочатку брати рядки з `tariff_seed_snapshot.json` (strict або loose).
 * Вимкнути мережевий пропуск JSON: `TARIFF_SEED_USE_SNAPSHOT_FIRST=false`.
 */
export function isTariffSeedUseSnapshotFirst(): boolean {
  const raw = process.env["TARIFF_SEED_USE_SNAPSHOT_FIRST"];
  if (raw === undefined || raw === "") return true;
  const v = String(raw).toLowerCase();
  if (v === "false" || v === "0") return false;
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

/** Упорядковані ключі дат YYYY-MM-DD для діапазону сиду тарифів (узгоджено з `SeedTariffsFromApi`). */
export function listExpectedTariffSeedDateKeys(
  days: number,
  anchor: TariffSeedRangeAnchor,
  rangeDate: Date,
): string[] {
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
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(
      rangeStartDate.getFullYear(),
      rangeStartDate.getMonth(),
      rangeStartDate.getDate() + i,
      12,
      0,
      0,
      0,
    );
    keys.push(dateKeyLocal(d));
  }
  return keys;
}

function expectedDateKeys(
  days: number,
  anchor: TariffSeedRangeAnchor,
  rangeDate: Date,
): { first: string; last: string } {
  const keys = listExpectedTariffSeedDateKeys(days, anchor, rangeDate);
  return { first: keys[0]!, last: keys[keys.length - 1]! };
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

export type TariffSnapshotLooseRow = {
  dateKey: string;
  day: number;
  night: number;
};

/**
 * Зіставляє очікувані дати сиду з `rows` у JSON (ігнорує `days` / `rangeEndDate` у файлі).
 * Відсутні дати — з `fallbackDay` / `fallbackNight`.
 */
export function buildTariffRowsForSeedFromSnapshotLoose(
  raw: unknown,
  expectedDateKeys: string[],
  fallbackDay: number,
  fallbackNight: number,
): TariffSnapshotLooseRow[] | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o["version"] !== 1) return null;
  const rowsRaw = o["rows"];
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) return null;
  const map = new Map<string, { day: number; night: number }>();
  for (const item of rowsRaw) {
    if (item === null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r["date"] !== "string") continue;
    const day = r["day"];
    const night = r["night"];
    if (typeof day !== "number" || typeof night !== "number") continue;
    if (!Number.isFinite(day) || !Number.isFinite(night)) continue;
    map.set(r["date"], { day, night });
  }
  if (map.size === 0) return null;
  const out: TariffSnapshotLooseRow[] = [];
  for (const dateKey of expectedDateKeys) {
    const hit = map.get(dateKey);
    out.push({
      dateKey,
      day: hit?.day ?? fallbackDay,
      night: hit?.night ?? fallbackNight,
    });
  }
  return out;
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
